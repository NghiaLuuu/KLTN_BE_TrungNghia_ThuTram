/**
 * 🧠 AI Query Engine (with self-retry logic)
 * 
 * Allows AI chatbot to automatically generate, validate, and execute MongoDB queries
 * based on natural language input (Vietnamese).
 */

const { openai } = require('../config/openai.config');
const mongoose = require('mongoose');
const { createSchemaAwarePrompt } = require('../utils/schemaExtractor');
const { registerAllModels } = require('../models');
const { getConnectionForCollection } = require('../config/databaseConnections');

// Ensure models are registered
let modelsRegistered = false;
async function ensureModelsRegistered() {
  if (!modelsRegistered) {
    await registerAllModels();
    modelsRegistered = true;
  }
}

// Configuration
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;
const WHITELISTED_COLLECTIONS = ['slots', 'rooms', 'services', 'users'];
const DANGEROUS_OPERATORS = ['$where', 'delete', 'update', 'drop', 'insert', 'remove', '$function'];

/**
 * 1️⃣ Call LLM to generate MongoDB query from natural language
 * Now with REAL SCHEMA AWARENESS!
 */
async function callLLMToGenerateQuery(userPrompt, lastError = null) {
  // Generate schema-aware system prompt with actual database schemas
  let systemPrompt = createSchemaAwarePrompt(WHITELISTED_COLLECTIONS);
  
  // Add error feedback if this is a retry
  if (lastError) {
    systemPrompt += `\n\n⚠️ LẦN TRƯỚC BỊ LỖI: ${lastError}\nHãy sửa lại query cho đúng dựa trên schema ở trên.`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1, // Low temperature for consistent output
      max_tokens: 500
    });

    const content = response.choices[0].message.content.trim();
    
    // Extract JSON from response (in case GPT adds markdown code blocks)
    let jsonString = content;
    if (content.includes('```json')) {
      jsonString = content.split('```json')[1].split('```')[0].trim();
    } else if (content.includes('```')) {
      jsonString = content.split('```')[1].split('```')[0].trim();
    }

    const query = JSON.parse(jsonString);
    
    // Validate structure
    if (!query.collection || !query.filter) {
      throw new Error('Query phải có "collection" và "filter"');
    }

    return query;
  } catch (error) {
    console.error('❌ LLM generation error:', error.message);
    throw new Error(`Không thể generate query: ${error.message}`);
  }
}

/**
 * 2️⃣ Validate query safety
 */
function isQuerySafe(query) {
  try {
    // Check if query has required fields
    if (!query || typeof query !== 'object') {
      return { safe: false, reason: 'Query phải là object' };
    }

    if (!query.collection || !query.filter) {
      return { safe: false, reason: 'Query thiếu "collection" hoặc "filter"' };
    }

    // Check if collection is whitelisted
    if (!WHITELISTED_COLLECTIONS.includes(query.collection)) {
      return { 
        safe: false, 
        reason: `Collection "${query.collection}" không được phép. Chỉ cho phép: ${WHITELISTED_COLLECTIONS.join(', ')}` 
      };
    }

    // Check if filter contains dangerous operators
    const filterString = JSON.stringify(query.filter);
    for (const dangerousOp of DANGEROUS_OPERATORS) {
      if (filterString.includes(dangerousOp)) {
        return { 
          safe: false, 
          reason: `Phát hiện toán tử nguy hiểm: ${dangerousOp}` 
        };
      }
    }

    // Check if filter is valid object
    if (typeof query.filter !== 'object' || Array.isArray(query.filter)) {
      return { safe: false, reason: 'Filter phải là object' };
    }

    return { safe: true };
  } catch (error) {
    return { safe: false, reason: `Lỗi validation: ${error.message}` };
  }
}

/**
 * 3️⃣ Execute MongoDB query (read-only)
 * NOW: Query the CORRECT microservice database!
 */
async function executeMongoQuery(query) {
  try {
    // Get connection to the correct microservice database
    const connection = await getConnectionForCollection(query.collection);
    
    if (!connection || !connection.db) {
      throw new Error(`Database connection not established for collection: ${query.collection}`);
    }

    // Execute query on the correct database
    const collection = connection.db.collection(query.collection);
    const results = await collection.find(query.filter).limit(100).toArray();
    
    return {
      success: true,
      data: results,
      count: results.length
    };
  } catch (error) {
    console.error('❌ MongoDB execution error:', error.message);
    throw error;
  }
}

/**
 * 4️⃣ Delay helper for retry logic
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 5️⃣ Main function: Handle Query with self-retry logic
 */
async function handleQuery(userPrompt) {
  // Ensure models are loaded for schema extraction
  await ensureModelsRegistered();
  
  console.log('\n🧠 AI Query Engine Started (Multi-Database Mode)');
  console.log('📝 User Prompt:', userPrompt);
  
  let retries = 0;
  let lastError = null;
  let generatedQuery = null;

  while (retries < MAX_RETRIES) {
    try {
      console.log(`\n🔄 Attempt ${retries + 1}/${MAX_RETRIES}`);

      // Step 1: Generate query from LLM
      console.log('⚙️ Generating MongoDB query...');
      generatedQuery = await callLLMToGenerateQuery(userPrompt, lastError);
      console.log('📋 Generated Query:', JSON.stringify(generatedQuery, null, 2));

      // Step 2: Validate query safety
      console.log('🔒 Validating query safety...');
      const safetyCheck = isQuerySafe(generatedQuery);
      
      if (!safetyCheck.safe) {
        lastError = safetyCheck.reason;
        console.error('❌ Safety check failed:', lastError);
        retries++;
        await delay(RETRY_DELAY_MS * retries); // Exponential backoff
        continue;
      }
      console.log('✅ Query is safe');

      // Step 3: Execute query
      console.log('🚀 Executing MongoDB query...');
      const result = await executeMongoQuery(generatedQuery);
      
      console.log('✅ Query executed successfully');
      console.log('📊 Results count:', result.count);

      return {
        success: true,
        retries: retries,
        query: generatedQuery,
        data: result.data,
        count: result.count
      };

    } catch (error) {
      lastError = error.message;
      console.error(`❌ Attempt ${retries + 1} failed:`, lastError);
      retries++;

      if (retries < MAX_RETRIES) {
        console.log(`⏳ Retrying in ${RETRY_DELAY_MS * retries}ms...`);
        await delay(RETRY_DELAY_MS * retries); // Exponential backoff
      }
    }
  }

  // Failed after all retries
  console.error('💥 All retries exhausted');
  return {
    success: false,
    retries: MAX_RETRIES,
    error: lastError || 'Unknown error after maximum retries',
    query: generatedQuery
  };
}

module.exports = {
  handleQuery,
  callLLMToGenerateQuery,
  isQuerySafe,
  executeMongoQuery
};

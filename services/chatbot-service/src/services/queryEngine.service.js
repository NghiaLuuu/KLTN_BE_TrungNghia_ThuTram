/**
 * 🧠 AI Query Engine (với logic tự động thử lại)
 * 
 * Cho phép AI chatbot tự động tạo, validate và thực thi MongoDB query
 * dựa trên input ngôn ngữ tự nhiên (tiếng Việt).
 */

const { openai } = require('../config/openai.config');
const mongoose = require('mongoose');
const { createSchemaAwarePrompt } = require('../utils/schemaExtractor');
const { registerAllModels } = require('../models');
const { getConnectionForCollection } = require('../config/databaseConnections');

// Đảm bảo các model đã được đăng ký
let modelsRegistered = false;
async function ensureModelsRegistered() {
  if (!modelsRegistered) {
    await registerAllModels();
    modelsRegistered = true;
  }
}

// Cấu hình
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 500;
const WHITELISTED_COLLECTIONS = ['slots', 'rooms', 'services', 'users'];
const DANGEROUS_OPERATORS = ['$where', 'delete', 'update', 'drop', 'insert', 'remove', '$function'];

/**
 * 1️⃣ Gọi LLM để tạo MongoDB query từ ngôn ngữ tự nhiên
 * Giờ đã có KHẢ NĂNG NHẬN BIẾT SCHEMA THẬT!
 */
async function callLLMToGenerateQuery(userPrompt, lastError = null) {
  // Tạo system prompt nhận biết schema với các schema database thực tế
  let systemPrompt = createSchemaAwarePrompt(WHITELISTED_COLLECTIONS);
  
  // Thêm phản hồi lỗi nếu đây là lần thử lại
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
      temperature: 0.1, // Temperature thấp để output nhất quán
      max_tokens: 500
    });

    const content = response.choices[0].message.content.trim();
    
    // Trích xuất JSON từ response (trong trường hợp GPT thêm markdown code blocks)
    let jsonString = content;
    if (content.includes('```json')) {
      jsonString = content.split('```json')[1].split('```')[0].trim();
    } else if (content.includes('```')) {
      jsonString = content.split('```')[1].split('```')[0].trim();
    }

    const query = JSON.parse(jsonString);
    
    // Validate cấu trúc
    if (!query.collection || !query.filter) {
      throw new Error('Query phải có "collection" và "filter"');
    }

    return query;
  } catch (error) {
    console.error('❌ Lỗi tạo query từ LLM:', error.message);
    throw new Error(`Không thể tạo query: ${error.message}`);
  }
}

/**
 * 2️⃣ Validate tính an toàn của query
 */
function isQuerySafe(query) {
  try {
    // Kiểm tra query có các trường bắt buộc không
    if (!query || typeof query !== 'object') {
      return { safe: false, reason: 'Query phải là object' };
    }

    if (!query.collection || !query.filter) {
      return { safe: false, reason: 'Query thiếu "collection" hoặc "filter"' };
    }

    // Kiểm tra collection có trong whitelist không
    if (!WHITELISTED_COLLECTIONS.includes(query.collection)) {
      return { 
        safe: false, 
        reason: `Collection "${query.collection}" không được phép. Chỉ cho phép: ${WHITELISTED_COLLECTIONS.join(', ')}` 
      };
    }

    // Kiểm tra filter có chứa toán tử nguy hiểm không
    const filterString = JSON.stringify(query.filter);
    for (const dangerousOp of DANGEROUS_OPERATORS) {
      if (filterString.includes(dangerousOp)) {
        return { 
          safe: false, 
          reason: `Phát hiện toán tử nguy hiểm: ${dangerousOp}` 
        };
      }
    }

    // Kiểm tra filter có phải là object hợp lệ không
    if (typeof query.filter !== 'object' || Array.isArray(query.filter)) {
      return { safe: false, reason: 'Filter phải là object' };
    }

    return { safe: true };
  } catch (error) {
    return { safe: false, reason: `Lỗi validation: ${error.message}` };
  }
}

/**
 * 3️⃣ Thực thi MongoDB query (chỉ đọc)
 * GIờ: Query ĐÚNG database của microservice tương ứng!
 */
async function executeMongoQuery(query) {
  try {
    // Lấy connection đến đúng database của microservice
    const connection = await getConnectionForCollection(query.collection);
    
    if (!connection || !connection.db) {
      throw new Error(`Chưa thiết lập kết nối database cho collection: ${query.collection}`);
    }

    // Thực thi query trên đúng database
    const collection = connection.db.collection(query.collection);
    const results = await collection.find(query.filter).limit(100).toArray();
    
    return {
      success: true,
      data: results,
      count: results.length
    };
  } catch (error) {
    console.error('❌ Lỗi thực thi MongoDB:', error.message);
    throw error;
  }
}

/**
 * 4️⃣ Hàm hỗ trợ delay cho logic thử lại
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 5️⃣ Hàm chính: Xử lý Query với logic tự động thử lại
 */
async function handleQuery(userPrompt) {
  // Đảm bảo các model đã được load để trích xuất schema
  await ensureModelsRegistered();
  
  console.log('\n🧠 AI Query Engine Bắt đầu (Chế độ Multi-Database)');
  console.log('📝 Yêu cầu User:', userPrompt);
  
  let retries = 0;
  let lastError = null;
  let generatedQuery = null;

  while (retries < MAX_RETRIES) {
    try {
      console.log(`\n🔄 Lần thử ${retries + 1}/${MAX_RETRIES}`);

      // Bước 1: Tạo query từ LLM
      console.log('⚙️ Đang tạo MongoDB query...');
      generatedQuery = await callLLMToGenerateQuery(userPrompt, lastError);
      console.log('📋 Query đã tạo:', JSON.stringify(generatedQuery, null, 2));

      // Bước 2: Validate tính an toàn của query
      console.log('🔒 Đang validate tính an toàn query...');
      const safetyCheck = isQuerySafe(generatedQuery);
      
      if (!safetyCheck.safe) {
        lastError = safetyCheck.reason;
        console.error('❌ Kiểm tra an toàn thất bại:', lastError);
        retries++;
        await delay(RETRY_DELAY_MS * retries); // Exponential backoff
        continue;
      }
      console.log('✅ Query an toàn');

      // Bước 3: Thực thi query
      console.log('🚀 Đang thực thi MongoDB query...');
      const result = await executeMongoQuery(generatedQuery);
      
      console.log('✅ Thực thi query thành công');
      console.log('📊 Số kết quả:', result.count);

      return {
        success: true,
        retries: retries,
        query: generatedQuery,
        data: result.data,
        count: result.count
      };

    } catch (error) {
      lastError = error.message;
      console.error(`❌ Lần thử ${retries + 1} thất bại:`, lastError);
      retries++;

      if (retries < MAX_RETRIES) {
        console.log(`⏳ Thử lại sau ${RETRY_DELAY_MS * retries}ms...`);
        await delay(RETRY_DELAY_MS * retries); // Exponential backoff
      }
    }
  }

  // Thất bại sau tất cả các lần thử
  console.error('💥 Đã hết số lần thử lại');
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

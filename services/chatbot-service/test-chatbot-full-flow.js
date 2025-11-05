/**
 * Test FULL chatbot flow to see if GPT hallucinating
 */
require('dotenv').config();
const mongoose = require('mongoose');
const aiService = require('./src/services/ai.service');

async function testChatbot() {
  try {
    console.log('\n🧪 TEST FULL CHATBOT FLOW\n');
    console.log('Database:', process.env.MONGODB_URI);
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    const userMessage = 'Danh sách dịch vụ hiện có';
    console.log('💬 User:', userMessage);
    console.log('\n⏳ Calling chatbot...\n');

    const response = await aiService.sendMessageToGPT(userMessage, []);

    console.log('============================================================');
    console.log('🤖 CHATBOT RESPONSE:');
    console.log('============================================================\n');
    console.log(response.response);
    console.log('\n============================================================');
    console.log('📊 METADATA:');
    console.log('============================================================');
    console.log('- Used Query:', response.usedQuery);
    console.log('- Query Count:', response.queryCount);
    if (response.query) {
      console.log('- Query:', JSON.stringify(response.query, null, 2));
    }
    if (response.queryData) {
      console.log('- Query Results Count:', response.queryData.count);
      console.log('\n📋 ACTUAL DATA SENT TO GPT:');
      console.log('============================================================');
      response.queryData.data.forEach((service, idx) => {
        console.log(`${idx + 1}. ${service.name} - ${service.basePrice?.toLocaleString()} VND`);
      });
    }
    console.log('\n');

    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

testChatbot();

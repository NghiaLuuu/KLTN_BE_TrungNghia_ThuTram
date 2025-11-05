/**
 * Test to see ACTUAL query results from database
 */
require('dotenv').config();
const mongoose = require('mongoose');
const queryEngineService = require('./src/services/queryEngine.service');

async function testQueryResult() {
  try {
    console.log('\n🧪 TEST: Check actual query results from database\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dental-clinic');
    console.log('✅ Connected to MongoDB\n');

    // Execute query
    console.log('📝 Executing query: "Danh sách dịch vụ hiện có"\n');
    const result = await queryEngineService.handleQuery('Danh sách dịch vụ hiện có');

    if (result.success) {
      console.log('✅ Query successful!');
      console.log('📊 Results count:', result.count);
      console.log('\n📋 ACTUAL DATA FROM DATABASE:');
      console.log('============================================================\n');
      
      result.data.forEach((service, idx) => {
        console.log(`${idx + 1}. ${service.name}`);
        console.log(`   - Giá: ${service.basePrice?.toLocaleString() || 'N/A'} VND`);
        console.log(`   - Thời gian: ${service.duration || 'N/A'} phút`);
        console.log(`   - Category: ${service.category || 'N/A'}`);
        console.log(`   - Mô tả: ${service.description || 'N/A'}`);
        console.log('');
      });

      console.log('============================================================');
      console.log('\n💡 This is the REAL data that should be sent to GPT!');
      console.log('   If GPT returns different services, it means GPT is hallucinating.\n');
    } else {
      console.log('❌ Query failed:', result.error);
    }

    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

testQueryResult();

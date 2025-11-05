/**
 * Test Query for "Danh sách dịch vụ nha khoa"
 */
require('dotenv').config();
const mongoose = require('mongoose');
const queryEngineService = require('./src/services/queryEngine.service');

async function testServicesQuery() {
  try {
    console.log('\n🧪 ========================================');
    console.log('   TEST: Danh sách dịch vụ nha khoa');
    console.log('========================================\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dental-clinic');
    console.log('✅ Connected to MongoDB\n');

    // Test different ways to ask for services list
    const testCases = [
      'Danh sách dịch vụ nha khoa đang hoạt động',
      'Có những dịch vụ gì?',
      'Liệt kê các dịch vụ',
      'Tôi muốn xem dịch vụ của phòng khám',
      'Dịch vụ tẩy trắng răng'
    ];

    for (const testCase of testCases) {
      console.log('============================================================');
      console.log(`📝 Test: "${testCase}"`);
      console.log('============================================================');

      const result = await queryEngineService.handleQuery(testCase);

      if (result.success) {
        console.log('✅ Query executed successfully');
        console.log('📊 Query:', JSON.stringify(result.query, null, 2));
        console.log('📈 Results count:', result.count);
        
        if (result.data && result.data.length > 0) {
          console.log('\n📋 Sample results:');
          result.data.slice(0, 3).forEach((item, idx) => {
            console.log(`   ${idx + 1}. ${item.name || item.fullName || JSON.stringify(item)}`);
          });
        }
      } else {
        console.log('❌ Query failed:', result.error);
      }
      console.log('');
    }

    console.log('\n✅ All tests completed\n');
    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

testServicesQuery();

/**
 * Test Multi-Database Query Engine
 * Query actual microservice databases
 */
require('dotenv').config();
const mongoose = require('mongoose');
const queryEngineService = require('./src/services/queryEngine.service');
const { closeAllConnections } = require('./src/config/databaseConnections');

async function testMultiDatabaseQuery() {
  try {
    console.log('\n🧪 ========================================');
    console.log('   TEST MULTI-DATABASE QUERY ENGINE');
    console.log('========================================\n');

    console.log('📡 Connecting to main chatbot database...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected\n');

    // Test queries that should hit DIFFERENT databases
    const testCases = [
      {
        prompt: 'Danh sách dịch vụ hiện có',
        expectDatabase: 'service-service (dental_clinic_service)',
        expectCollection: 'services'
      },
      {
        prompt: 'Có phòng X-quang không?',
        expectDatabase: 'room-service (dental_clinic_room)',
        expectCollection: 'rooms'
      },
      {
        prompt: 'Bác sĩ chuyên nha chu',
        expectDatabase: 'auth-service (dental_clinic_auth)',
        expectCollection: 'users'
      },
      {
        prompt: 'Lịch trống ngày mai',
        expectDatabase: 'schedule-service (dental_clinic_schedule)',
        expectCollection: 'slots'
      }
    ];

    for (const testCase of testCases) {
      console.log('============================================================');
      console.log(`📝 Test: "${testCase.prompt}"`);
      console.log(`🎯 Expected Database: ${testCase.expectDatabase}`);
      console.log(`🎯 Expected Collection: ${testCase.expectCollection}`);
      console.log('============================================================\n');

      const result = await queryEngineService.handleQuery(testCase.prompt);

      if (result.success) {
        console.log('\n✅ Query executed successfully');
        console.log('📊 Query:', JSON.stringify(result.query, null, 2));
        console.log('📈 Results count:', result.count);
        
        if (result.data && result.data.length > 0) {
          console.log('\n📋 Sample results:');
          result.data.slice(0, 3).forEach((item, idx) => {
            console.log(`   ${idx + 1}. ${item.name || item.fullName || JSON.stringify(item).substring(0, 50)}...`);
          });
        } else {
          console.log('\n⚠️  No data found (database might be empty)');
        }
      } else {
        console.log('\n❌ Query failed:', result.error);
      }
      console.log('');
    }

    console.log('\n============================================================');
    console.log('✅ ALL TESTS COMPLETED');
    console.log('============================================================\n');

    // Close all connections
    await closeAllConnections();
    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Test failed:', error);
    await closeAllConnections();
    await mongoose.connection.close();
    process.exit(1);
  }
}

testMultiDatabaseQuery();

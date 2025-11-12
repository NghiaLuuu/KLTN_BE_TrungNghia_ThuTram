/**
 * Simple Test - Booking Intent Detection
 * Test xem chatbot có tự động hiển thị danh sách dịch vụ khi user hỏi về đặt lịch không
 */

const axios = require('axios');

// Config
const CHATBOT_API = 'http://localhost:3000/api/ai/chat';
const TEST_USER_ID = '6902f23cd82bd98af6ef08c5'; // Replace with real user ID

// Test messages
const testMessages = [
  'Tôi muốn đặt lịch',
  'Tôi có dịch vụ được chỉ định nào không?',
  'Tôi muốn đặt lịch khám răng',
  'Có dịch vụ gì để đặt lịch?',
  'Bác sĩ chỉ định dịch vụ nào cho tôi?'
];

async function testBookingIntent(message) {
  console.log('\n' + '='.repeat(80));
  console.log(`📝 Test Message: "${message}"`);
  console.log('='.repeat(80));
  
  try {
    const response = await axios.post(CHATBOT_API, {
      message: message,
      userId: TEST_USER_ID
    });
    
    console.log('\n✅ Response Success:');
    console.log('-'.repeat(80));
    console.log(response.data.response);
    console.log('-'.repeat(80));
    
    if (response.data.bookingMode) {
      console.log('\n🎯 Booking Mode Activated!');
      console.log(`   - Total services: ${response.data.servicesData.total}`);
      console.log(`   - Recommended: ${response.data.servicesData.recommendedCount}`);
      console.log(`   - Regular: ${response.data.servicesData.regularCount}`);
    }
    
    if (response.data.isOffTopic) {
      console.log('\n⚠️  Off-topic detected!');
      console.log(`   - Count: ${response.data.offTopicCount}/3`);
    }
    
    return response.data;
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

async function runTests() {
  console.log('\n🚀 Starting Booking Intent Tests...\n');
  console.log('📋 Test Config:');
  console.log(`   Chatbot API: ${CHATBOT_API}`);
  console.log(`   Test User ID: ${TEST_USER_ID}`);
  console.log(`   Number of tests: ${testMessages.length}`);
  
  console.log('\n⚠️  Make sure these services are running:');
  console.log('   - chatbot-service (port 3000)');
  console.log('   - service-service (port 3003)');
  console.log('   - record-service (port 3010)');
  console.log('   - Redis (port 6379)');
  
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < testMessages.length; i++) {
    try {
      await testBookingIntent(testMessages[i]);
      successCount++;
      
      // Wait 2 seconds between tests
      if (i < testMessages.length - 1) {
        console.log('\n⏳ Waiting 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      failCount++;
      console.error(`\n❌ Test ${i + 1} failed`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Passed: ${successCount}/${testMessages.length}`);
  console.log(`❌ Failed: ${failCount}/${testMessages.length}`);
  console.log('='.repeat(80));
  
  if (failCount === 0) {
    console.log('\n🎉 ALL TESTS PASSED! 🎉\n');
  } else {
    console.log('\n⚠️  SOME TESTS FAILED!\n');
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  runTests().catch(error => {
    console.error('\n💥 Fatal Error:', error.message);
    process.exit(1);
  });
}

module.exports = { testBookingIntent };

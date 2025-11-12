/**
 * Test Booking APIs
 * Test để verify AI có thể gọi được các API giống như trang /patient/booking/select-service
 */

const axios = require('axios');

// Config
const SERVICE_API = 'http://localhost:3003/api/services';
const RECORD_API = 'http://localhost:3010/api/records/patient';
const CHATBOT_BOOKING_API = 'http://localhost:3000/api/ai/booking';

// Test user ID (replace with real user ID from your database)
const TEST_USER_ID = '6902f23cd82bd98af6ef08c5';

// Test JWT token (optional - get from localStorage after login)
const TEST_AUTH_TOKEN = 'YOUR_JWT_TOKEN_HERE';

async function testDirectAPIs() {
  console.log('\n🧪 ===== TEST 1: Direct API Calls (giống như FE) =====\n');
  
  try {
    // 1. Test Service API
    console.log('📡 Calling Service API...');
    console.log(`   URL: ${SERVICE_API}?page=1&limit=1000`);
    
    const servicesResponse = await axios.get(SERVICE_API, {
      params: { page: 1, limit: 1000 }
    });
    
    console.log(`✅ Services API Success`);
    console.log(`   Total services: ${servicesResponse.data.services?.length || 0}`);
    console.log(`   Active services: ${servicesResponse.data.services?.filter(s => s.isActive).length || 0}`);
    
    // Show first 3 services
    if (servicesResponse.data.services?.length > 0) {
      console.log('\n📋 Sample services:');
      servicesResponse.data.services.slice(0, 3).forEach((s, idx) => {
        console.log(`   ${idx + 1}. ${s.name} - ${s.basePrice}đ (${s.duration} phút)`);
        console.log(`      requireExamFirst: ${s.requireExamFirst || false}`);
      });
    }
    
    // 2. Test Record API
    console.log('\n📡 Calling Record API...');
    console.log(`   URL: ${RECORD_API}/${TEST_USER_ID}?limit=100`);
    
    const config = TEST_AUTH_TOKEN !== 'YOUR_JWT_TOKEN_HERE' ? {
      headers: { Authorization: `Bearer ${TEST_AUTH_TOKEN}` }
    } : {};
    
    const recordsResponse = await axios.get(
      `${RECORD_API}/${TEST_USER_ID}`,
      { ...config, params: { limit: 100 } }
    );
    
    console.log(`✅ Records API Success`);
    console.log(`   Total records: ${recordsResponse.data.data?.length || 0}`);
    
    // Filter exam records with unused indications
    const examRecords = recordsResponse.data.data?.filter(record => {
      return record.type === 'exam' && 
             !record.hasBeenUsed &&
             record.treatmentIndications && 
             record.treatmentIndications.length > 0 &&
             record.treatmentIndications.some(ind => !ind.used);
    }) || [];
    
    console.log(`   Exam records with unused indications: ${examRecords.length}`);
    
    if (examRecords.length > 0) {
      console.log('\n⭐ Dịch vụ được chỉ định:');
      examRecords.forEach((record, idx) => {
        console.log(`   Record ${idx + 1} (${record._id}):`);
        record.treatmentIndications.forEach(ind => {
          if (!ind.used) {
            console.log(`     - ${ind.serviceName} (${ind.serviceId})`);
            if (ind.notes) console.log(`       Notes: ${ind.notes}`);
          }
        });
      });
    }
    
    return { servicesResponse, recordsResponse, examRecords };
    
  } catch (error) {
    console.error('❌ Direct API Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

async function testChatbotBookingAPI() {
  console.log('\n\n🤖 ===== TEST 2: Chatbot Booking API =====\n');
  
  try {
    console.log('📡 Calling Chatbot Booking Start API...');
    console.log(`   URL: ${CHATBOT_BOOKING_API}/start`);
    
    const config = TEST_AUTH_TOKEN !== 'YOUR_JWT_TOKEN_HERE' ? {
      headers: { Authorization: `Bearer ${TEST_AUTH_TOKEN}` }
    } : {};
    
    const response = await axios.post(
      `${CHATBOT_BOOKING_API}/start`,
      { userId: TEST_USER_ID },
      config
    );
    
    console.log(`✅ Chatbot Booking API Success`);
    console.log(`   Total services: ${response.data.data.total}`);
    console.log(`   Recommended count: ${response.data.data.recommendedCount}`);
    
    const recommended = response.data.data.services.filter(s => s.isRecommended);
    const regular = response.data.data.services.filter(s => !s.isRecommended);
    
    if (recommended.length > 0) {
      console.log('\n⭐ Dịch vụ được bác sĩ chỉ định:');
      recommended.forEach((s, idx) => {
        console.log(`   ${idx + 1}. ${s.name} - ${s.basePrice}đ`);
        console.log(`      recordId: ${s.recordId}`);
        if (s.recommendationNotes) {
          console.log(`      Notes: ${s.recommendationNotes}`);
        }
      });
    }
    
    if (regular.length > 0) {
      console.log('\n🦷 Dịch vụ thông thường (first 5):');
      regular.slice(0, 5).forEach((s, idx) => {
        console.log(`   ${idx + 1}. ${s.name} - ${s.basePrice}đ`);
      });
    }
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Chatbot Booking API Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

async function testChatbotChatAPI() {
  console.log('\n\n💬 ===== TEST 3: Chatbot Chat with Booking Intent =====\n');
  
  try {
    console.log('📡 Sending message to Chatbot...');
    console.log('   Message: "Tôi có dịch vụ được chỉ định nào không?"');
    
    const config = TEST_AUTH_TOKEN !== 'YOUR_JWT_TOKEN_HERE' ? {
      headers: { Authorization: `Bearer ${TEST_AUTH_TOKEN}` }
    } : {};
    
    const response = await axios.post(
      'http://localhost:3000/api/ai/chat',
      { 
        message: 'Tôi có dịch vụ được chỉ định nào không?',
        userId: TEST_USER_ID
      },
      config
    );
    
    console.log(`✅ Chatbot Response:`);
    console.log(`   ${response.data.response}`);
    
    if (response.data.usedBooking) {
      console.log('\n🎯 Chatbot detected booking intent!');
      console.log(`   Booking data:`, response.data.bookingData);
    }
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Chatbot Chat API Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
    throw error;
  }
}

async function runAllTests() {
  console.log('🚀 Starting API Tests...\n');
  console.log('📝 Config:');
  console.log(`   Test User ID: ${TEST_USER_ID}`);
  console.log(`   Auth Token: ${TEST_AUTH_TOKEN === 'YOUR_JWT_TOKEN_HERE' ? 'NOT SET' : 'SET ✅'}`);
  
  try {
    // Test 1: Direct API calls
    const directResult = await testDirectAPIs();
    
    // Test 2: Chatbot Booking API
    const bookingResult = await testChatbotBookingAPI();
    
    // Test 3: Chatbot Chat with booking intent
    const chatResult = await testChatbotChatAPI();
    
    console.log('\n\n✅ ===== ALL TESTS PASSED =====\n');
    
    // Summary
    console.log('📊 Summary:');
    console.log(`   - Direct Services API: ${directResult.servicesResponse.data.services.length} services`);
    console.log(`   - Direct Records API: ${directResult.recordsResponse.data.data.length} records`);
    console.log(`   - Exam records with indications: ${directResult.examRecords.length}`);
    console.log(`   - Chatbot available services: ${bookingResult.data.total}`);
    console.log(`   - Recommended services: ${bookingResult.data.recommendedCount}`);
    
  } catch (error) {
    console.error('\n\n❌ ===== TESTS FAILED =====\n');
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  console.log('⚠️  NOTE: Make sure all services are running:');
  console.log('   - service-service (port 3003)');
  console.log('   - record-service (port 3010)');
  console.log('   - chatbot-service (port 3000)');
  console.log('   - Redis (port 6379)');
  console.log('\n');
  
  runAllTests().catch(console.error);
}

module.exports = {
  testDirectAPIs,
  testChatbotBookingAPI,
  testChatbotChatAPI
};

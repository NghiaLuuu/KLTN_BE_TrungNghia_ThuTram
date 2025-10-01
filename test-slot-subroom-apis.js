/**
 * Script để test thực tế API Slot Management với SubRoom logic
 * Sử dụng dữ liệu thật từ request của bạn
 */

const axios = require('axios').default;

// Configuration
const BASE_URL = 'http://localhost:3002';
const AUTH_TOKEN = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'; // Thay bằng token thật

// Test data từ request của bạn
const TEST_DATA = {
  roomId: "68dd31c43df7b61e7b509e61",
  // subRoomId: "68dd2e1d3df7b61e7b509e42", // Comment/uncomment để test
  quarter: 4,
  year: 2025,
  shifts: ["Ca Sáng", "Ca Chiều"],
  dentistIds: ["68d9f8bab5a75931c6cd0d7d"],
  nurseIds: ["68dd3147327b922b6119b8ed"]
};

async function testAPI(endpoint, data, expectedResult = 'success') {
  try {
    console.log(`\n🧪 Testing ${endpoint}...`);
    console.log('📤 Request data:', JSON.stringify(data, null, 2));
    
    const response = await axios.post(`${BASE_URL}${endpoint}`, data, {
      headers: {
        'Authorization': AUTH_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ SUCCESS Response:', JSON.stringify(response.data, null, 2));
    return { success: true, data: response.data };
    
  } catch (error) {
    if (error.response) {
      console.log('❌ ERROR Response:', JSON.stringify(error.response.data, null, 2));
      return { success: false, error: error.response.data };
    } else {
      console.log('💥 REQUEST FAILED:', error.message);
      return { success: false, error: error.message };
    }
  }
}

async function runTests() {
  console.log('🚀 STARTING SLOT SUBROOM LOGIC TESTS');
  console.log('=' .repeat(60));

  // TEST 1: REASSIGN-STAFF với data gốc (có comment subRoomId)
  console.log('\n1️⃣ TEST: REASSIGN-STAFF - Phòng không có subroom nhưng gửi subRoomId');
  const dataWithSubRoom = { ...TEST_DATA, subRoomId: "68dd2e1d3df7b61e7b509e42" };
  await testAPI('/api/slots/reassign-staff', dataWithSubRoom, 'error');

  // TEST 2: REASSIGN-STAFF không gửi subRoomId  
  console.log('\n2️⃣ TEST: REASSIGN-STAFF - Phòng không có subroom và không gửi subRoomId');
  const dataWithoutSubRoom = { ...TEST_DATA };
  delete dataWithoutSubRoom.subRoomId;
  await testAPI('/api/slots/reassign-staff', dataWithoutSubRoom, 'success');

  // TEST 3: ASSIGN-STAFF với logic tương tự
  console.log('\n3️⃣ TEST: ASSIGN-STAFF - Với subRoomId không hợp lệ');
  await testAPI('/api/slots/assign-staff', dataWithSubRoom, 'error');

  // TEST 4: Kiểm tra available quarters
  console.log('\n4️⃣ TEST: GET available quarters');
  try {
    const response = await axios.get(`${BASE_URL}/api/slots/available-quarters`, {
      headers: { 'Authorization': AUTH_TOKEN }
    });
    console.log('✅ Available quarters:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Failed to get quarters:', error.response?.data || error.message);
  }

  // TEST 5: Kiểm tra available shifts  
  console.log('\n5️⃣ TEST: GET available shifts');
  try {
    const response = await axios.get(`${BASE_URL}/api/slots/available-shifts`, {
      headers: { 'Authorization': AUTH_TOKEN }
    });
    console.log('✅ Available shifts:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Failed to get shifts:', error.response?.data || error.message);
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 TESTS COMPLETED');
  console.log(`
💡 NOTES:
  - Nếu lỗi 403: Cần token với role manager/admin
  - Nếu lỗi 500 "users_cache không tồn tại": Cần start auth-service trước
  - Nếu lỗi "không tìm thấy lịch": Cần tạo schedule cho quý 4/2025 trước
  - Thay đổi roomId/subRoomId dựa trên data thật trong database
  `);
}

// Chạy tests
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, testAPI };
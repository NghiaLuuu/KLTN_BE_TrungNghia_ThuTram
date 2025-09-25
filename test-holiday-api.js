// Test file cho Holiday Management API
// Chạy lệnh: node test-holiday-api.js

const BASE_URL = 'http://localhost:3005/api/schedule/config';
const AUTH_TOKEN = 'your-jwt-token-here'; // Thay bằng token thực

// Helper function để gọi API
async function apiCall(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` })
    }
  };
  
  const finalOptions = { ...defaultOptions, ...options };
  if (finalOptions.body && typeof finalOptions.body === 'object') {
    finalOptions.body = JSON.stringify(finalOptions.body);
  }
  
  try {
    const response = await fetch(url, finalOptions);
    const data = await response.json();
    console.log(`\n=== ${options.method || 'GET'} ${endpoint} ===`);
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { response, data };
  } catch (error) {
    console.error(`Error calling ${endpoint}:`, error);
    return null;
  }
}

// Test functions
async function testGetHolidays() {
  console.log('\n🔍 Testing GET /holidays');
  await apiCall('/holidays');
}

async function testAddHoliday() {
  console.log('\n➕ Testing POST /holidays');
  await apiCall('/holidays', {
    method: 'POST',
    body: {
      name: 'Test Holiday',
      startDate: '2024-12-25',
      endDate: '2024-12-25',
      note: 'Test holiday for API testing'
    }
  });
}

async function testAddDuplicateHoliday() {
  console.log('\n❌ Testing POST /holidays (duplicate)');
  await apiCall('/holidays', {
    method: 'POST',
    body: {
      name: 'Test Holiday',
      startDate: '2024-12-25',
      endDate: '2024-12-25',
      note: 'Another test holiday'
    }
  });
}

async function testUpdateHoliday(holidayId) {
  console.log('\n✏️ Testing PATCH /holidays/:id');
  await apiCall(`/holidays/${holidayId}`, {
    method: 'PATCH',
    body: {
      name: 'Updated Test Holiday',
      note: 'Updated note for testing'
    }
  });
}

async function testDeleteHoliday(holidayId) {
  console.log('\n🗑️ Testing DELETE /holidays/:id');
  await apiCall(`/holidays/${holidayId}`, {
    method: 'DELETE'
  });
}

async function testValidationErrors() {
  console.log('\n⚠️ Testing validation errors');
  
  // Missing required fields
  await apiCall('/holidays', {
    method: 'POST',
    body: {}
  });
  
  // Invalid date format
  await apiCall('/holidays', {
    method: 'POST',
    body: {
      name: 'Invalid Date Holiday',
      startDate: '2024-13-40',
      endDate: '2024-13-41'
    }
  });
  
  // Invalid holiday ID
  await apiCall('/holidays/invalid-id', {
    method: 'PATCH',
    body: { name: 'Test' }
  });
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting Holiday Management API Tests...');
  console.log('📝 Make sure your server is running on http://localhost:3005');
  console.log('🔑 Update AUTH_TOKEN variable with a valid JWT token');
  
  // Test basic functionality
  await testGetHolidays();
  await testAddHoliday();
  await testAddDuplicateHoliday();
  
  // Get the list to find the created holiday ID
  const { data: holidaysData } = await apiCall('/holidays') || {};
  if (holidaysData?.data?.length > 0) {
    const testHoliday = holidaysData.data.find(h => h.name.includes('Test Holiday'));
    if (testHoliday) {
      const holidayId = testHoliday._id;
      console.log(`\n📌 Found test holiday ID: ${holidayId}`);
      
      await testUpdateHoliday(holidayId);
      await testDeleteHoliday(holidayId);
    }
  }
  
  // Test validation
  await testValidationErrors();
  
  console.log('\n✅ All tests completed!');
}

// Only run if this file is executed directly
if (require.main === module) {
  // Check if we have fetch (Node.js 18+)
  if (typeof fetch === 'undefined') {
    console.error('❌ This test requires Node.js 18+ or install node-fetch package');
    process.exit(1);
  }
  
  runTests().catch(console.error);
}

module.exports = {
  apiCall,
  testGetHolidays,
  testAddHoliday,
  testUpdateHoliday,
  testDeleteHoliday,
  runTests
};
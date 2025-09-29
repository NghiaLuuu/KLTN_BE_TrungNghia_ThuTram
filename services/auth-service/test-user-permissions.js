/**
 * 🧪 Test script cho user management APIs với role-based permissions
 */

const API_BASE = 'http://localhost:3001'; // Auth service port

// Mock tokens - thay bằng token thật khi test
const tokens = {
  admin: 'admin_jwt_token_here',
  manager: 'manager_jwt_token_here',
  patient: 'patient_jwt_token_here'
};

// ✅ Test cases for user update permissions
const testCases = [
  {
    name: '🔒 Admin cập nhật chính mình (should fail)',
    method: 'PUT',
    url: '/api/users/profile',
    token: 'admin',
    body: { name: 'Admin Updated' },
    expectedStatus: 400
  },
  {
    name: '✅ Admin cập nhật manager khác (should success)',
    method: 'PUT', 
    url: '/api/users/{manager_id}',
    token: 'admin',
    body: { name: 'Manager Updated by Admin' },
    expectedStatus: 200
  },
  {
    name: '🔒 Admin cập nhật email (should fail)',
    method: 'PUT',
    url: '/api/users/{manager_id}',
    token: 'admin', 
    body: { email: 'newemail@test.com' },
    expectedStatus: 400
  },
  {
    name: '✅ Manager cập nhật patient (should success)',
    method: 'PUT',
    url: '/api/users/{patient_id}',
    token: 'manager',
    body: { name: 'Patient Updated by Manager' },
    expectedStatus: 200
  },
  {
    name: '🔒 Manager cập nhật admin (should fail)',
    method: 'PUT',
    url: '/api/users/{admin_id}',
    token: 'manager',
    body: { name: 'Admin Updated by Manager' },
    expectedStatus: 400
  },
  {
    name: '✅ Patient cập nhật chính mình (should success)',
    method: 'PUT',
    url: '/api/users/profile',
    token: 'patient',
    body: { name: 'Patient Self Update' },
    expectedStatus: 200
  },
  {
    name: '🔒 Patient cập nhật patient khác (should fail)',
    method: 'PUT',
    url: '/api/users/{other_patient_id}',
    token: 'patient',
    body: { name: 'Other Patient Update' },
    expectedStatus: 400
  }
];

// ✅ Test cases for staff/patient viewing permissions
const viewTestCases = [
  {
    name: '✅ Admin xem all staff',
    method: 'GET',
    url: '/api/users/all-staff',
    token: 'admin',
    expectedStatus: 200
  },
  {
    name: '✅ Manager xem patients',
    method: 'GET',
    url: '/api/users/patients',
    token: 'manager',
    expectedStatus: 200
  },
  {
    name: '🔒 Patient xem staff (should fail)',
    method: 'GET',
    url: '/api/users/all-staff',
    token: 'patient',
    expectedStatus: 403
  },
  {
    name: '🔒 Patient xem patients (should fail)',
    method: 'GET',
    url: '/api/users/patients',
    token: 'patient',
    expectedStatus: 403
  }
];

async function runTest(testCase) {
  console.log(`\n📋 Testing: ${testCase.name}`);
  
  try {
    const options = {
      method: testCase.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokens[testCase.token]}`
      }
    };
    
    if (testCase.body) {
      options.body = JSON.stringify(testCase.body);
    }
    
    const response = await fetch(`${API_BASE}${testCase.url}`, options);
    const result = await response.json();
    
    if (response.status === testCase.expectedStatus) {
      console.log(`✅ PASS: ${response.status} - ${result.message || 'OK'}`);
    } else {
      console.log(`❌ FAIL: Expected ${testCase.expectedStatus}, got ${response.status}`);
      console.log(`   Response:`, result);
    }
    
  } catch (error) {
    console.log(`💥 ERROR: ${error.message}`);
  }
}

async function runAllTests() {
  console.log('🚀 Starting User Management API Tests...\n');
  
  console.log('=== PERMISSION UPDATE TESTS ===');
  for (const test of testCases) {
    await runTest(test);
  }
  
  console.log('\n=== VIEW PERMISSION TESTS ===');
  for (const test of viewTestCases) {
    await runTest(test);
  }
  
  console.log('\n🏁 Test completed!');
}

// Uncomment to run tests
// runAllTests();

module.exports = {
  runAllTests,
  testCases,
  viewTestCases
};
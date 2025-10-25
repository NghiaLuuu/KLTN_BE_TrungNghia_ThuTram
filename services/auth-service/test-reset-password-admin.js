/**
 * Test Reset Password API (Admin/Manager)
 * API: POST /api/user/:id/reset-password
 * 
 * Test Cases:
 * 1. Admin resets patient password → "12345678"
 * 2. Admin resets staff password → employeeCode
 * 3. Manager resets staff password → employeeCode
 * 4. Manager tries to reset manager password → Error
 * 5. Staff tries to reset password → Error
 * 6. Try to reset admin password → Error
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api';

// Test data - Update these with actual values from your database
const TEST_DATA = {
  adminToken: '', // Fill after admin login
  managerToken: '', // Fill after manager login
  staffToken: '', // Fill after staff login
  patientUserId: '', // Patient user ID to reset
  staffUserId: '', // Staff user ID to reset
  managerUserId: '', // Manager user ID to reset (for permission test)
  adminUserId: '', // Admin user ID (should fail)
};

// Helper function to login
async function login(loginValue, password) {
  try {
    const response = await axios.post(`${BASE_URL}/auth/login`, {
      login: loginValue,
      password: password
    });
    return response.data.accessToken;
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data?.message || error.message);
    return null;
  }
}

// Helper function to reset password
async function resetPassword(userId, token) {
  try {
    const response = await axios.post(
      `${BASE_URL}/user/${userId}/reset-password`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );
    return response.data;
  } catch (error) {
    throw error.response?.data || error;
  }
}

// Test 1: Admin resets patient password
async function test1_AdminResetsPatient() {
  console.log('\n========== TEST 1: Admin resets patient password ==========');
  try {
    const result = await resetPassword(TEST_DATA.patientUserId, TEST_DATA.adminToken);
    console.log('✅ SUCCESS:', result);
    console.log('📝 Default password for patient:', result.defaultPassword);
    console.log('Expected: "12345678"');
  } catch (error) {
    console.error('❌ FAILED:', error.message);
  }
}

// Test 2: Admin resets staff password
async function test2_AdminResetsStaff() {
  console.log('\n========== TEST 2: Admin resets staff password ==========');
  try {
    const result = await resetPassword(TEST_DATA.staffUserId, TEST_DATA.adminToken);
    console.log('✅ SUCCESS:', result);
    console.log('📝 Default password for staff:', result.defaultPassword);
    console.log('Expected: employeeCode (e.g., NV00000001)');
  } catch (error) {
    console.error('❌ FAILED:', error.message);
  }
}

// Test 3: Manager resets staff password
async function test3_ManagerResetsStaff() {
  console.log('\n========== TEST 3: Manager resets staff password ==========');
  try {
    const result = await resetPassword(TEST_DATA.staffUserId, TEST_DATA.managerToken);
    console.log('✅ SUCCESS:', result);
    console.log('📝 Default password for staff:', result.defaultPassword);
  } catch (error) {
    console.error('❌ FAILED:', error.message);
  }
}

// Test 4: Manager tries to reset manager password (should fail)
async function test4_ManagerResetsManager() {
  console.log('\n========== TEST 4: Manager tries to reset manager password (SHOULD FAIL) ==========');
  try {
    const result = await resetPassword(TEST_DATA.managerUserId, TEST_DATA.managerToken);
    console.log('❌ UNEXPECTED SUCCESS:', result);
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
    console.log('Expected error: "Chỉ admin mới có thể reset mật khẩu của manager"');
  }
}

// Test 5: Staff tries to reset password (should fail)
async function test5_StaffResetsPassword() {
  console.log('\n========== TEST 5: Staff tries to reset password (SHOULD FAIL) ==========');
  try {
    const result = await resetPassword(TEST_DATA.patientUserId, TEST_DATA.staffToken);
    console.log('❌ UNEXPECTED SUCCESS:', result);
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
    console.log('Expected error: "Chỉ admin hoặc manager mới có thể reset mật khẩu"');
  }
}

// Test 6: Try to reset admin password (should fail)
async function test6_ResetAdminPassword() {
  console.log('\n========== TEST 6: Try to reset admin password (SHOULD FAIL) ==========');
  try {
    const result = await resetPassword(TEST_DATA.adminUserId, TEST_DATA.adminToken);
    console.log('❌ UNEXPECTED SUCCESS:', result);
  } catch (error) {
    console.log('✅ EXPECTED FAILURE:', error.message);
    console.log('Expected error: "Không thể reset mật khẩu của admin"');
  }
}

// Main test runner
async function runTests() {
  console.log('='.repeat(60));
  console.log('RESET PASSWORD API TEST SUITE');
  console.log('='.repeat(60));

  // Step 1: Setup - Login as different users
  console.log('\n📝 SETUP: Logging in test users...');
  console.log('Please fill in TEST_DATA at the top of this file:');
  console.log('- Login credentials for admin, manager, staff');
  console.log('- User IDs to test reset password on');
  console.log('\nThen uncomment the tests below and run again.\n');

  // Uncomment these when TEST_DATA is filled:
  /*
  TEST_DATA.adminToken = await login('admin@example.com', 'admin_password');
  TEST_DATA.managerToken = await login('manager@example.com', 'manager_password');
  TEST_DATA.staffToken = await login('staff@example.com', 'staff_password');

  if (!TEST_DATA.adminToken || !TEST_DATA.managerToken || !TEST_DATA.staffToken) {
    console.error('❌ Failed to login test users. Check credentials.');
    return;
  }

  console.log('✅ All test users logged in successfully\n');

  // Run tests
  await test1_AdminResetsPatient();
  await test2_AdminResetsStaff();
  await test3_ManagerResetsStaff();
  await test4_ManagerResetsManager();
  await test5_StaffResetsPassword();
  await test6_ResetAdminPassword();

  console.log('\n' + '='.repeat(60));
  console.log('TEST SUITE COMPLETED');
  console.log('='.repeat(60));
  */
}

// Run the tests
runTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});

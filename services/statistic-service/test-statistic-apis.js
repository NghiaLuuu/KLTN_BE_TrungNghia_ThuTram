const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3010';
const API_URL = `${BASE_URL}/api/statistics`;

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

// Test token (you'll need a valid token from auth service)
const TEST_TOKEN = 'Bearer your_test_token_here'; // Replace with actual token

// Helper function to log results
function logResult(testName, success, data = null, error = null) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${colors.cyan}TEST: ${testName}${colors.reset}`);
    console.log(`${'='.repeat(60)}`);
    
    if (success) {
        console.log(`${colors.green}✅ SUCCESS${colors.reset}`);
        if (data) {
            console.log(`${colors.blue}Response:${colors.reset}`, JSON.stringify(data, null, 2));
        }
    } else {
        console.log(`${colors.red}❌ FAILED${colors.reset}`);
        if (error) {
            console.log(`${colors.red}Error:${colors.reset}`, error.message);
            if (error.response) {
                console.log(`${colors.yellow}Status:${colors.reset}`, error.response.status);
                console.log(`${colors.yellow}Response:${colors.reset}`, JSON.stringify(error.response.data, null, 2));
            }
        }
    }
}

// 1. Test Health Check
async function testHealthCheck() {
    try {
        const response = await axios.get(`${BASE_URL}/health`);
        logResult('Health Check', true, response.data);
        return true;
    } catch (error) {
        logResult('Health Check', false, null, error);
        return false;
    }
}

// 2. Test Dashboard Statistics
async function testDashboardStats() {
    try {
        const response = await axios.get(`${API_URL}/dashboard`, {
            headers: { Authorization: TEST_TOKEN },
            params: { timeframe: 'month' }
        });
        logResult('Dashboard Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Dashboard Statistics', false, null, error);
        return false;
    }
}

// 3. Test Appointment Statistics
async function testAppointmentStats() {
    try {
        const response = await axios.get(`${API_URL}/appointments`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                period: 'month'
            }
        });
        logResult('Appointment Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Appointment Statistics', false, null, error);
        return false;
    }
}

// 4. Test Revenue Statistics
async function testRevenueStats() {
    try {
        const response = await axios.get(`${API_URL}/revenue`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                period: 'month',
                groupBy: 'day',
                compareWithPrevious: 'true'
            }
        });
        logResult('Revenue Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Revenue Statistics', false, null, error);
        return false;
    }
}

// 5. Test Patient Statistics
async function testPatientStats() {
    try {
        const response = await axios.get(`${API_URL}/patients`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                period: 'month',
                ageGroup: 'all',
                gender: 'all'
            }
        });
        logResult('Patient Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Patient Statistics', false, null, error);
        return false;
    }
}

// 6. Test Staff Statistics
async function testStaffStats() {
    try {
        const response = await axios.get(`${API_URL}/staff`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                role: 'all',
                includeInactive: 'false'
            }
        });
        logResult('Staff Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Staff Statistics', false, null, error);
        return false;
    }
}

// 7. Test Service Statistics
async function testServiceStats() {
    try {
        const response = await axios.get(`${API_URL}/services`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                period: 'month',
                serviceType: 'all',
                limit: 20
            }
        });
        logResult('Service Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Service Statistics', false, null, error);
        return false;
    }
}

// 8. Test Dentist Statistics
async function testDentistStats() {
    try {
        const response = await axios.get(`${API_URL}/dentists`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                period: 'month'
            }
        });
        logResult('Dentist Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Dentist Statistics', false, null, error);
        return false;
    }
}

// 9. Test Schedule Statistics
async function testScheduleStats() {
    try {
        const response = await axios.get(`${API_URL}/schedule`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                period: 'month'
            }
        });
        logResult('Schedule Statistics', true, response.data);
        return true;
    } catch (error) {
        logResult('Schedule Statistics', false, null, error);
        return false;
    }
}

// 10. Test Invalid Date Range
async function testInvalidDateRange() {
    try {
        const response = await axios.get(`${API_URL}/appointments`, {
            headers: { Authorization: TEST_TOKEN },
            params: {
                startDate: 'invalid-date',
                endDate: 'invalid-date'
            }
        });
        logResult('Invalid Date Range', false, null, { message: 'Should have failed validation' });
        return false;
    } catch (error) {
        if (error.response && error.response.status === 400) {
            logResult('Invalid Date Range', true, { message: 'Validation failed as expected', errors: error.response.data });
            return true;
        } else {
            logResult('Invalid Date Range', false, null, error);
            return false;
        }
    }
}

// 11. Test Unauthorized Access
async function testUnauthorizedAccess() {
    try {
        const response = await axios.get(`${API_URL}/revenue`); // No token
        logResult('Unauthorized Access', false, null, { message: 'Should have failed authentication' });
        return false;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            logResult('Unauthorized Access', true, { message: '401 returned as expected' });
            return true;
        } else {
            logResult('Unauthorized Access', false, null, error);
            return false;
        }
    }
}

// 12. Test Clear Cache (Admin only)
async function testClearCache() {
    try {
        const response = await axios.delete(`${API_URL}/cache`, {
            headers: { Authorization: TEST_TOKEN }
        });
        logResult('Clear Cache', true, response.data);
        return true;
    } catch (error) {
        logResult('Clear Cache', false, null, error);
        return false;
    }
}

// Main test runner
async function runAllTests() {
    console.log(`${colors.magenta}🧪 STARTING STATISTIC SERVICE API TESTS${colors.reset}`);
    console.log(`${colors.magenta}Testing comprehensive statistics and analytics functionality${colors.reset}`);
    console.log(`${colors.magenta}Base URL: ${API_URL}${colors.reset}`);
    console.log(`${colors.yellow}⚠️  Note: Some tests may fail if services are not running or token is invalid${colors.reset}`);
    
    const tests = [
        { name: 'Health Check', func: testHealthCheck },
        { name: 'Dashboard Statistics', func: testDashboardStats },
        { name: 'Appointment Statistics', func: testAppointmentStats },
        { name: 'Revenue Statistics', func: testRevenueStats },
        { name: 'Patient Statistics', func: testPatientStats },
        { name: 'Staff Statistics', func: testStaffStats },
        { name: 'Service Statistics', func: testServiceStats },
        { name: 'Dentist Statistics', func: testDentistStats },
        { name: 'Schedule Statistics', func: testScheduleStats },
        { name: 'Invalid Date Range', func: testInvalidDateRange },
        { name: 'Unauthorized Access', func: testUnauthorizedAccess },
        { name: 'Clear Cache', func: testClearCache }
    ];
    
    let passedTests = 0;
    let totalTests = tests.length;
    
    for (const test of tests) {
        console.log(`\n${colors.yellow}Running: ${test.name}${colors.reset}`);
        const result = await test.func();
        if (result) passedTests++;
        
        // Add delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log(`${colors.magenta}📊 TEST SUMMARY${colors.reset}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`${colors.green}Passed: ${passedTests}/${totalTests}${colors.reset}`);
    console.log(`${colors.red}Failed: ${totalTests - passedTests}/${totalTests}${colors.reset}`);
    
    if (passedTests === totalTests) {
        console.log(`${colors.green}🎉 ALL TESTS PASSED! Statistic service is working perfectly!${colors.reset}`);
    } else {
        console.log(`${colors.yellow}⚠️  Some tests failed. Check the errors above and ensure:${colors.reset}`);
        console.log(`${colors.yellow}   - All microservices are running${colors.reset}`);
        console.log(`${colors.yellow}   - Valid authentication token is provided${colors.reset}`);
        console.log(`${colors.yellow}   - Database connections are working${colors.reset}`);
        console.log(`${colors.yellow}   - RabbitMQ and Redis are connected${colors.reset}`);
    }
}

// Run tests
runAllTests().catch(console.error);
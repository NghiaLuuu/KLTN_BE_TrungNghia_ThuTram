/**
 * Test timezone fix cho 4 API statistics
 * Kiểm tra xem API có lấy đúng dữ liệu theo giờ Việt Nam không
 */

const axios = require('axios');
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Ho_Chi_Minh';
const BASE_URL = 'http://localhost:5000'; // Thay đổi theo cấu hình của bạn

// Test data: Ngày 06/12/2025 theo giờ VN
const TEST_DATE_VN = '2025-12-06';
const TEST_DATE_RANGE_START = '2025-11-07';
const TEST_DATE_RANGE_END = '2025-12-07';

// Sample room IDs for clinic utilization test
const ROOM_IDS = [
  '6934b2ecb1e59ce823d4ce19',
  '6934ae8c34e1da693ed25100',
  '692aab072373421ac38a57a0',
  '692329037ae1fa280c255df0',
  '692328e17ae1fa280c255ddc',
  '69231cb3f036870893431c38'
];

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(80));
  log(title, 'cyan');
  console.log('='.repeat(80));
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

/**
 * Hiển thị thông tin timezone
 */
function displayTimezoneInfo(dateStr) {
  const vnStart = moment.tz(dateStr, TIMEZONE).startOf('day');
  const vnEnd = moment.tz(dateStr, TIMEZONE).endOf('day');
  
  logInfo(`Input date: ${dateStr}`);
  logInfo(`VN Timezone: ${TIMEZONE} (UTC+7)`);
  logInfo(`Expected range (VN time):`);
  console.log(`  Start: ${vnStart.format('YYYY-MM-DD HH:mm:ss')} VN = ${vnStart.toISOString()}`);
  console.log(`  End:   ${vnEnd.format('YYYY-MM-DD HH:mm:ss')} VN = ${vnEnd.toISOString()}`);
  
  const utcStart = moment(dateStr).utc().startOf('day');
  const utcEnd = moment(dateStr).utc().endOf('day');
  logWarning('WRONG if using UTC directly:');
  console.log(`  Start: ${utcStart.format('YYYY-MM-DD HH:mm:ss')} UTC = ${utcStart.toISOString()}`);
  console.log(`  End:   ${utcEnd.format('YYYY-MM-DD HH:mm:ss')} UTC = ${utcEnd.toISOString()}`);
}

/**
 * Test 1: Revenue Statistics API
 */
async function testRevenueStats() {
  logSection('TEST 1: Revenue Statistics API');
  
  const url = `${BASE_URL}/api/statistics/revenue`;
  const params = {
    groupBy: 'day',
    startDate: TEST_DATE_VN,
    endDate: TEST_DATE_VN
  };
  
  displayTimezoneInfo(TEST_DATE_VN);
  
  try {
    logInfo(`\nCalling: GET ${url}`);
    logInfo(`Params: ${JSON.stringify(params, null, 2)}`);
    
    const response = await axios.get(url, { params });
    
    if (response.data.success) {
      logSuccess('API call successful');
      
      const data = response.data.data;
      console.log('\nResponse data:');
      console.log(JSON.stringify(data, null, 2));
      
      // Validate period
      if (data.period) {
        const returnedStart = new Date(data.period.startDate);
        const returnedEnd = new Date(data.period.endDate);
        const expectedStart = moment.tz(TEST_DATE_VN, TIMEZONE).startOf('day').toDate();
        const expectedEnd = moment.tz(TEST_DATE_VN, TIMEZONE).endOf('day').toDate();
        
        logInfo('\nDate range validation:');
        console.log(`  Returned start: ${returnedStart.toISOString()}`);
        console.log(`  Expected start: ${expectedStart.toISOString()}`);
        console.log(`  Returned end:   ${returnedEnd.toISOString()}`);
        console.log(`  Expected end:   ${expectedEnd.toISOString()}`);
        
        if (returnedStart.toISOString() === expectedStart.toISOString() &&
            returnedEnd.toISOString() === expectedEnd.toISOString()) {
          logSuccess('✓ Date range is CORRECT (using VN timezone)');
        } else {
          logError('✗ Date range is WRONG (not using VN timezone properly)');
        }
      }
      
      // Display summary
      if (data.summary) {
        logInfo('\nSummary:');
        console.log(`  Total Revenue: ${data.summary.totalRevenue?.toLocaleString('vi-VN')} VNĐ`);
        console.log(`  Total Invoices: ${data.summary.totalInvoices}`);
        console.log(`  Average Invoice Value: ${data.summary.averageInvoiceValue?.toLocaleString('vi-VN')} VNĐ`);
        console.log(`  Payment Rate: ${data.summary.paymentRate}%`);
      }
      
      return true;
    } else {
      logError(`API returned success=false: ${response.data.message}`);
      return false;
    }
  } catch (error) {
    logError(`API call failed: ${error.message}`);
    if (error.response) {
      console.log('Response data:', error.response.data);
    }
    return false;
  }
}

/**
 * Test 2: Booking Channel Statistics API
 */
async function testBookingChannelStats() {
  logSection('TEST 2: Booking Channel Statistics API');
  
  const url = `${BASE_URL}/api/appointments/booking-channel-stats`;
  const params = {
    startDate: TEST_DATE_RANGE_START,
    endDate: TEST_DATE_RANGE_END,
    groupBy: 'day'
  };
  
  displayTimezoneInfo(TEST_DATE_RANGE_START);
  
  try {
    logInfo(`\nCalling: GET ${url}`);
    logInfo(`Params: ${JSON.stringify(params, null, 2)}`);
    
    const response = await axios.get(url, { params });
    
    if (response.data.success) {
      logSuccess('API call successful');
      
      const data = response.data.data;
      console.log('\nResponse data:');
      console.log(JSON.stringify(data, null, 2));
      
      // Display summary
      if (data.summary) {
        logInfo('\nSummary:');
        console.log(`  Total Appointments: ${data.summary.total}`);
        console.log(`  Online: ${data.summary.online} (${data.summary.onlinePercentage}%)`);
        console.log(`  Offline: ${data.summary.offline} (${data.summary.offlinePercentage}%)`);
        console.log(`  Overall Completion Rate: ${data.summary.completionRate}%`);
      }
      
      // Display trends (first 3 days)
      if (data.trends && data.trends.length > 0) {
        logInfo('\nTrends (first 3 days):');
        data.trends.slice(0, 3).forEach(trend => {
          console.log(`  ${trend.date}: Total=${trend.total}, Online=${trend.online}, Offline=${trend.offline}`);
        });
      }
      
      return true;
    } else {
      logError(`API returned success=false: ${response.data.message}`);
      return false;
    }
  } catch (error) {
    logError(`API call failed: ${error.message}`);
    if (error.response) {
      console.log('Response data:', error.response.data);
    }
    return false;
  }
}

/**
 * Test 3: Clinic Utilization Statistics API
 */
async function testClinicUtilizationStats() {
  logSection('TEST 3: Clinic Utilization Statistics API');
  
  const url = `${BASE_URL}/api/statistics/clinic-utilization`;
  const params = {
    startDate: TEST_DATE_RANGE_START,
    endDate: TEST_DATE_RANGE_END,
    timeRange: 'day'
  };
  
  // Add roomIds as array
  ROOM_IDS.forEach(id => {
    if (!params['roomIds[]']) params['roomIds[]'] = [];
    params['roomIds[]'].push(id);
  });
  
  displayTimezoneInfo(TEST_DATE_RANGE_START);
  
  try {
    logInfo(`\nCalling: GET ${url}`);
    logInfo(`Params: roomIds count = ${ROOM_IDS.length}`);
    
    const response = await axios.get(url, { 
      params,
      paramsSerializer: {
        indexes: null // Send as roomIds[]=xxx&roomIds[]=yyy
      }
    });
    
    if (response.data.success) {
      logSuccess('API call successful');
      
      const data = response.data.data;
      console.log('\nResponse data summary:');
      
      // Display summary
      if (data.summary) {
        logInfo('Summary:');
        console.log(`  Total Slots: ${data.summary.totalSlots}`);
        console.log(`  Used Slots: ${data.summary.usedSlots}`);
        console.log(`  Empty Slots: ${data.summary.emptySlots}`);
        console.log(`  Utilization Rate: ${data.summary.utilizationRate}%`);
        console.log(`  Avg Slots Per Day: ${data.summary.avgSlotsPerDay}`);
      }
      
      // Display by room (first 3)
      if (data.byRoom && data.byRoom.length > 0) {
        logInfo('\nBy Room (first 3):');
        data.byRoom.slice(0, 3).forEach(room => {
          console.log(`  Room: ${room.roomName || room.roomId}`);
          console.log(`    Total: ${room.totalSlots}, Used: ${room.usedSlots}, Rate: ${room.utilizationRate}%`);
        });
      }
      
      return true;
    } else {
      logError(`API returned success=false: ${response.data.message}`);
      return false;
    }
  } catch (error) {
    logError(`API call failed: ${error.message}`);
    if (error.response) {
      console.log('Response data:', error.response.data);
    }
    return false;
  }
}

/**
 * Test 4: Appointment Status Statistics API
 */
async function testAppointmentStatusStats() {
  logSection('TEST 4: Appointment Status Statistics API');
  
  const url = `${BASE_URL}/api/statistics/appointment-status`;
  const params = {
    startDate: TEST_DATE_VN,
    endDate: TEST_DATE_VN,
    groupBy: 'day'
  };
  
  displayTimezoneInfo(TEST_DATE_VN);
  
  try {
    logInfo(`\nCalling: GET ${url}`);
    logInfo(`Params: ${JSON.stringify(params, null, 2)}`);
    
    const response = await axios.get(url, { params });
    
    if (response.data.success) {
      logSuccess('API call successful');
      
      const data = response.data.data;
      console.log('\nResponse data:');
      console.log(JSON.stringify(data, null, 2));
      
      // Display summary
      if (data.summary) {
        logInfo('\nSummary:');
        console.log(`  Total Appointments: ${data.summary.totalAppointments}`);
        console.log(`  Completion Rate: ${data.summary.completionRate}%`);
        console.log(`  Cancellation Rate: ${data.summary.cancellationRate}%`);
        console.log(`  Avg Per Day: ${data.summary.avgPerDay}`);
      }
      
      // Display status breakdown
      if (data.statusStats && data.statusStats.length > 0) {
        logInfo('\nStatus Breakdown:');
        data.statusStats.forEach(stat => {
          console.log(`  ${stat.status}: ${stat.count} (${stat.percentage}%)`);
        });
      }
      
      return true;
    } else {
      logError(`API returned success=false: ${response.data.message}`);
      return false;
    }
  } catch (error) {
    logError(`API call failed: ${error.message}`);
    if (error.response) {
      console.log('Response data:', error.response.data);
    }
    return false;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  log('\n' + '█'.repeat(80), 'bright');
  log('TIMEZONE FIX TESTING - SmileCare Dental Statistics APIs', 'bright');
  log('█'.repeat(80) + '\n', 'bright');
  
  logInfo(`Test Date (VN): ${TEST_DATE_VN}`);
  logInfo(`Test Range: ${TEST_DATE_RANGE_START} to ${TEST_DATE_RANGE_END}`);
  logInfo(`Base URL: ${BASE_URL}`);
  logInfo(`Timezone: ${TIMEZONE}\n`);
  
  const results = {
    revenue: false,
    bookingChannel: false,
    clinicUtilization: false,
    appointmentStatus: false
  };
  
  // Run tests
  results.revenue = await testRevenueStats();
  await sleep(1000);
  
  results.bookingChannel = await testBookingChannelStats();
  await sleep(1000);
  
  results.clinicUtilization = await testClinicUtilizationStats();
  await sleep(1000);
  
  results.appointmentStatus = await testAppointmentStatusStats();
  
  // Summary
  logSection('TEST SUMMARY');
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  console.log('');
  Object.entries(results).forEach(([name, passed]) => {
    if (passed) {
      logSuccess(`${name}: PASSED`);
    } else {
      logError(`${name}: FAILED`);
    }
  });
  
  console.log('\n' + '='.repeat(80));
  if (passed === total) {
    logSuccess(`ALL TESTS PASSED (${passed}/${total})`);
  } else {
    logWarning(`SOME TESTS FAILED (${passed}/${total} passed)`);
  }
  console.log('='.repeat(80) + '\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run tests
runAllTests().catch(error => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});

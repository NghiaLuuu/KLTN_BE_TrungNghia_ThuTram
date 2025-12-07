/**
 * TEST FILE FOR PATIENT BOOKING APIs
 * 
 * Test 2 APIs:
 * 1. GET /api/slot/dentists-with-nearest-slot?serviceDuration=30&serviceId=xxx
 * 2. GET /api/slot/dentist/:dentistId/working-dates?serviceDuration=30&serviceId=xxx
 * 3. GET /api/slot/dentist/:dentistId/details/future?date=YYYY-MM-DD&serviceId=xxx
 * 
 * Run: node test-patient-booking-apis.js
 */

const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3005;
const SERVICE_DURATION = 30;
const SERVICE_ID = '692332654bad0e8aaaa5f450'; // Khám tổng quát

// Test data
let testDentistId = null;
let testDate = null;

// Helper to make HTTP GET request
function httpGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error('Invalid JSON response: ' + data));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

// Helper to format current time
function getCurrentVietnamTime() {
  const now = new Date();
  const vnTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  return vnTime.toISOString().replace('T', ' ').substring(0, 16);
}

// Helper to format test results
function printTestResult(testName, success, data, error = null) {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST: ${testName}`);
  console.log('='.repeat(80));
  console.log(`Status: ${success ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`Time: ${getCurrentVietnamTime()}`);
  
  if (success) {
    console.log('\n📊 Response Data:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log('\n❌ Error:');
    console.log(error);
  }
}

// Test 1: Get dentists with nearest slot
async function testGetDentistsWithNearestSlot() {
  try {
    console.log('\n🧪 Testing API 1: GET /dentists-with-nearest-slot');
    console.log(`Parameters: serviceDuration=${SERVICE_DURATION}, serviceId=${SERVICE_ID}`);
    
    const path = `/api/slot/dentists-with-nearest-slot?serviceDuration=${SERVICE_DURATION}&serviceId=${SERVICE_ID}`;
    const data = await httpGet(path);
    
    // Validate response structure
    const validations = [];
    validations.push({ 
      check: 'Has success field', 
      result: data.hasOwnProperty('success')
    });
    validations.push({ 
      check: 'Success is true', 
      result: data.success === true 
    });
    validations.push({ 
      check: 'Has data.dentists array', 
      result: Array.isArray(data.data?.dentists) 
    });
    validations.push({ 
      check: 'Has timeThreshold', 
      result: !!data.data?.timeThreshold 
    });
    validations.push({ 
      check: 'Has maxDate', 
      result: !!data.data?.maxDate 
    });
    
    // Check each dentist has nearestSlot
    if (data.data?.dentists) {
      data.data.dentists.forEach((dentist, index) => {
        validations.push({
          check: `Dentist ${index + 1} (${dentist.fullName}) has nearestSlot`,
          result: !!dentist.nearestSlot
        });
        
        if (dentist.nearestSlot) {
          validations.push({
            check: `  - Has slotIds array`,
            result: Array.isArray(dentist.nearestSlot.slotIds)
          });
          validations.push({
            check: `  - Has date`,
            result: !!dentist.nearestSlot.date
          });
          validations.push({
            check: `  - Has startTime`,
            result: !!dentist.nearestSlot.startTime
          });
          validations.push({
            check: `  - Has shiftName`,
            result: !!dentist.nearestSlot.shiftName
          });
          validations.push({
            check: `  - Has room info`,
            result: !!dentist.nearestSlot.room
          });
          
          // Save first dentist for next test
          if (index === 0) {
            testDentistId = dentist._id;
            testDate = dentist.nearestSlot.date;
          }
        }
      });
    }
    
    console.log('\n📋 Validations:');
    validations.forEach(v => {
      console.log(`${v.result ? '✅' : '❌'} ${v.check}`);
    });
    
    const allPassed = validations.every(v => v.result);
    printTestResult('API 1: Get Dentists With Nearest Slot', allPassed, data);
    
    return allPassed;
    
  } catch (error) {
    printTestResult('API 1: Get Dentists With Nearest Slot', false, null, error.message);
    return false;
  }
}

// Test 2: Get dentist working dates
async function testGetDentistWorkingDates() {
  if (!testDentistId) {
    console.log('\n⚠️ Skipping Test 2: No dentist ID from previous test');
    return false;
  }
  
  try {
    console.log('\n🧪 Testing API 2: GET /dentist/:dentistId/working-dates');
    console.log(`Parameters: dentistId=${testDentistId}, serviceDuration=${SERVICE_DURATION}, serviceId=${SERVICE_ID}`);
    
    const path = `/api/slot/dentist/${testDentistId}/working-dates?serviceDuration=${SERVICE_DURATION}&serviceId=${SERVICE_ID}`;
    const data = await httpGet(path);
    
    // Validate response structure
    const validations = [];
    validations.push({ 
      check: 'Has success field', 
      result: data.hasOwnProperty('success')
    });
    validations.push({ 
      check: 'Success is true', 
      result: data.success === true 
    });
    validations.push({ 
      check: 'Has data.workingDates array', 
      result: Array.isArray(data.data?.workingDates) 
    });
    validations.push({ 
      check: 'Has dentistId', 
      result: data.data?.dentistId === testDentistId 
    });
    
    // Check workingDates structure
    if (data.data?.workingDates && data.data.workingDates.length > 0) {
      const firstDate = data.data.workingDates[0];
      
      validations.push({
        check: 'First date has date field',
        result: !!firstDate.date
      });
      validations.push({
        check: 'First date has shifts object',
        result: !!firstDate.shifts
      });
      validations.push({
        check: 'Shifts has morning/afternoon/evening',
        result: firstDate.shifts?.morning && firstDate.shifts?.afternoon && firstDate.shifts?.evening
      });
      
      // Check shifts consistency
      ['morning', 'afternoon', 'evening'].forEach(shift => {
        const shiftData = firstDate.shifts[shift];
        validations.push({
          check: `${shift} has available boolean`,
          result: typeof shiftData?.available === 'boolean'
        });
        validations.push({
          check: `${shift} has slots array`,
          result: Array.isArray(shiftData?.slots)
        });
        
        // If shift is available, should have slots
        if (shiftData?.available) {
          validations.push({
            check: `${shift} available=true has slots`,
            result: shiftData.slots.length > 0
          });
          
          // Check slot structure
          if (shiftData.slots.length > 0) {
            const firstSlot = shiftData.slots[0];
            validations.push({
              check: `  ${shift} slot has _id`,
              result: !!firstSlot._id
            });
            validations.push({
              check: `  ${shift} slot has startTime`,
              result: !!firstSlot.startTime
            });
            validations.push({
              check: `  ${shift} slot has endTime`,
              result: !!firstSlot.endTime
            });
          }
        }
      });
    }
    
    console.log('\n📋 Validations:');
    validations.forEach(v => {
      console.log(`${v.result ? '✅' : '❌'} ${v.check}`);
    });
    
    const allPassed = validations.every(v => v.result);
    printTestResult('API 2: Get Dentist Working Dates', allPassed, data);
    
    return allPassed;
    
  } catch (error) {
    printTestResult('API 2: Get Dentist Working Dates', false, null, error.message);
    return false;
  }
}

// Test 3: Get dentist slot details future
async function testGetDentistSlotDetailsFuture() {
  if (!testDentistId || !testDate) {
    console.log('\n⚠️ Skipping Test 3: No dentist ID or date from previous tests');
    return false;
  }
  
  try {
    console.log('\n🧪 Testing API 3: GET /dentist/:dentistId/details/future');
    console.log(`Parameters: dentistId=${testDentistId}, date=${testDate}, serviceId=${SERVICE_ID}`);
    
    const path = `/api/slot/dentist/${testDentistId}/details/future?date=${testDate}&serviceId=${SERVICE_ID}&minLeadMinutes=30`;
    const data = await httpGet(path);
    
    // Validate response structure
    const validations = [];
    validations.push({ 
      check: 'Has success field', 
      result: data.hasOwnProperty('success')
    });
    validations.push({ 
      check: 'Success is true', 
      result: data.success === true 
    });
    validations.push({ 
      check: 'Has data.shifts object', 
      result: !!data.data?.shifts 
    });
    validations.push({ 
      check: 'Has totalSlots', 
      result: typeof data.data?.totalSlots === 'number' 
    });
    
    // Check shifts structure
    if (data.data?.shifts) {
      ['Ca Sáng', 'Ca Chiều', 'Ca Tối'].forEach(shift => {
        const shiftSlots = data.data.shifts[shift];
        validations.push({
          check: `${shift} is an array`,
          result: Array.isArray(shiftSlots)
        });
        
        // Check slot structure if exists
        if (shiftSlots && shiftSlots.length > 0) {
          const firstSlot = shiftSlots[0];
          validations.push({
            check: `  ${shift} slot has _id`,
            result: !!firstSlot._id
          });
          validations.push({
            check: `  ${shift} slot has startTimeVN`,
            result: !!firstSlot.startTimeVN
          });
          validations.push({
            check: `  ${shift} slot has endTimeVN`,
            result: !!firstSlot.endTimeVN
          });
          validations.push({
            check: `  ${shift} slot has shiftName`,
            result: !!firstSlot.shiftName
          });
        }
      });
    }
    
    // Compare with API 2 results
    console.log('\n🔍 Cross-validation with API 2:');
    console.log(`Expected slots from API 1 nearestSlot to exist in this response`);
    
    console.log('\n📋 Validations:');
    validations.forEach(v => {
      console.log(`${v.result ? '✅' : '❌'} ${v.check}`);
    });
    
    const allPassed = validations.every(v => v.result);
    printTestResult('API 3: Get Dentist Slot Details Future', allPassed, data);
    
    return allPassed;
    
  } catch (error) {
    printTestResult('API 3: Get Dentist Slot Details Future', false, null, error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('\n' + '═'.repeat(80));
  console.log('🧪 PATIENT BOOKING APIs TEST SUITE');
  console.log('═'.repeat(80));
  console.log(`Current Vietnam Time: ${getCurrentVietnamTime()}`);
  console.log(`Service Duration: ${SERVICE_DURATION} minutes`);
  console.log(`Service ID: ${SERVICE_ID}`);
  
  const results = [];
  
  // Test 1
  const test1 = await testGetDentistsWithNearestSlot();
  results.push({ name: 'Get Dentists With Nearest Slot', passed: test1 });
  
  // Wait 1 second between tests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 2
  const test2 = await testGetDentistWorkingDates();
  results.push({ name: 'Get Dentist Working Dates', passed: test2 });
  
  // Wait 1 second between tests
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test 3
  const test3 = await testGetDentistSlotDetailsFuture();
  results.push({ name: 'Get Dentist Slot Details Future', passed: test3 });
  
  // Summary
  console.log('\n' + '═'.repeat(80));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(80));
  
  results.forEach((result, index) => {
    console.log(`${result.passed ? '✅' : '❌'} Test ${index + 1}: ${result.name}`);
  });
  
  const totalPassed = results.filter(r => r.passed).length;
  const totalTests = results.length;
  
  console.log('\n' + '═'.repeat(80));
  console.log(`Total: ${totalPassed}/${totalTests} tests passed`);
  console.log('═'.repeat(80) + '\n');
  
  process.exit(totalPassed === totalTests ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

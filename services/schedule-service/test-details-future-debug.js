/**
 * DEBUG TEST: Check why /details/future returns empty slots
 * 
 * Real API call that's failing:
 * GET /api/slot/dentist/6923b27cc96fd594d2e3b129/details/future?date=2025-12-07&serviceId=692332654bad0e8aaaa5f450
 * 
 * Expected: Should return slots after 19:01 (current time 18:31 + 30 min buffer)
 * Actual: Returns empty array
 */

const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 3005;

function httpGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
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
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

async function debugDetailsFuture() {
  console.log('═'.repeat(80));
  console.log('🐛 DEBUG TEST: /details/future with serviceId');
  console.log('═'.repeat(80));
  
  const dentistId = '6923b27cc96fd594d2e3b129';
  const date = '2025-12-07';
  const serviceId = '692332654bad0e8aaaa5f450';
  
  console.log(`\n📋 Test Parameters:`);
  console.log(`   Dentist ID: ${dentistId}`);
  console.log(`   Date: ${date}`);
  console.log(`   Service ID: ${serviceId}`);
  
  // Test 1: Call /details/future WITH serviceId (failing case)
  console.log('\n' + '─'.repeat(80));
  console.log('TEST 1: /details/future WITH serviceId');
  console.log('─'.repeat(80));
  
  const path1 = `/api/slot/dentist/${dentistId}/details/future?date=${date}&serviceId=${serviceId}`;
  console.log(`\n🔗 Request: GET ${path1}`);
  
  try {
    const response1 = await httpGet(path1);
    console.log(`\n📥 Response Status: ${response1.status}`);
    console.log(`📊 Total Slots: ${response1.data.data?.totalSlots || 0}`);
    
    if (response1.data.data?.totalSlots === 0) {
      console.log(`\n❌ ISSUE CONFIRMED: No slots returned despite having slots after buffer time`);
      console.log(`\n💡 Possible causes:`);
      console.log(`   1. Service allowedRoomTypes filtering too strict`);
      console.log(`   2. Room roomType in DB doesn't match service allowedRoomTypes`);
      console.log(`   3. Room cache not matching actual room data`);
    } else {
      console.log(`\n✅ Slots returned:`, response1.data.data.totalSlots);
      console.log(JSON.stringify(response1.data.data.shifts, null, 2));
    }
  } catch (error) {
    console.error(`\n❌ Request failed:`, error.message);
  }
  
  // Test 2: Call /details/future WITHOUT serviceId (should work)
  console.log('\n' + '─'.repeat(80));
  console.log('TEST 2: /details/future WITHOUT serviceId (baseline)');
  console.log('─'.repeat(80));
  
  const path2 = `/api/slot/dentist/${dentistId}/details/future?date=${date}`;
  console.log(`\n🔗 Request: GET ${path2}`);
  
  try {
    const response2 = await httpGet(path2);
    console.log(`\n📥 Response Status: ${response2.status}`);
    console.log(`📊 Total Slots: ${response2.data.data?.totalSlots || 0}`);
    
    if (response2.data.data?.totalSlots > 0) {
      console.log(`\n✅ WITHOUT serviceId returns ${response2.data.data.totalSlots} slots`);
      console.log(`\n🔍 This confirms the issue is with roomType filtering when serviceId is provided`);
    }
  } catch (error) {
    console.error(`\n❌ Request failed:`, error.message);
  }
  
  // Test 3: Check service data
  console.log('\n' + '─'.repeat(80));
  console.log('TEST 3: Check Service allowedRoomTypes');
  console.log('─'.repeat(80));
  
  const servicePath = `/api/service/${serviceId}`;
  console.log(`\n🔗 Request: GET http://localhost:3003${servicePath}`);
  
  try {
    const options = {
      hostname: 'localhost',
      port: 3003,
      path: servicePath,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const serviceResponse = await new Promise((resolve, reject) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, data: data });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
    
    console.log(`\n📥 Response Status: ${serviceResponse.status}`);
    const serviceData = serviceResponse.data.data || serviceResponse.data;
    console.log(`\n📋 Service Info:`);
    console.log(`   Name: ${serviceData.name}`);
    console.log(`   Type: ${serviceData.type}`);
    console.log(`   Allowed Room Types: ${JSON.stringify(serviceData.allowedRoomTypes)}`);
    
    console.log(`\n💡 Expected room types in slots:`);
    console.log(`   Slots should have rooms with roomType in: ${JSON.stringify(serviceData.allowedRoomTypes)}`);
    
  } catch (error) {
    console.error(`\n⚠️ Could not fetch service data:`, error.message);
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('📊 SUMMARY');
  console.log('═'.repeat(80));
  console.log(`\nThe issue is likely that:`);
  console.log(`1. Service has allowedRoomTypes restriction`);
  console.log(`2. Slots have rooms with roomType not matching service allowedRoomTypes`);
  console.log(`3. This causes all slots to be filtered out`);
  console.log(`\n💡 Solution: Check room.roomType in database vs service.allowedRoomTypes`);
  console.log('═'.repeat(80) + '\n');
}

debugDetailsFuture()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });

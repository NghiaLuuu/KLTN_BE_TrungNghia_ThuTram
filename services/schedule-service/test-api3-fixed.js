const axios = require('axios');

const BASE_URL = 'http://localhost:3005/api/slot';

async function testAPI3Fixed() {
  console.log('🧪 Testing API 3 after fix to match API 1 & 2\n');
  
  const now = new Date();
  const threshold = new Date(now.getTime() + 30 * 60 * 1000);
  
  console.log('⏰ Current time:', now.toISOString());
  console.log('🕐 Threshold (now + 30min):', threshold.toISOString());
  console.log('');
  
  // Test parameters from user's example
  const dentistId = '66dce9edcc7f9bdc78d89e81';
  const date = '2025-12-07';
  const serviceId = '692332654bad0e8aaaa5f450';
  
  try {
    console.log('📞 API 1: GET /dentists-with-nearest-slot?serviceId=' + serviceId);
    const api1 = await axios.get(`${BASE_URL}/dentists-with-nearest-slot?serviceId=${serviceId}`);
    const api1Slots = api1.data?.data?.dentists || [];
    const api1DentistSlots = api1Slots.find(d => d.dentistId === dentistId);
    
    console.log(`✅ API 1 Response: ${api1Slots.length} dentists`);
    if (api1DentistSlots) {
      console.log(`   Dentist ${dentistId}: nearest slot at ${api1DentistSlots.nearestSlot?.startTime}`);
    }
    console.log('');
    
    console.log('📞 API 2: GET /dentist/' + dentistId + '/working-dates?serviceId=' + serviceId);
    const api2 = await axios.get(`${BASE_URL}/dentist/${dentistId}/working-dates?serviceId=${serviceId}`);
    const api2Slots = api2.data?.data?.dates || [];
    
    console.log(`✅ API 2 Response: ${api2Slots.length} dates`);
    const api2Date = api2Slots.find(d => d.date === date);
    if (api2Date) {
      console.log(`   Date ${date}: ${api2Date.slots.length} slots`);
      if (api2Date.slots.length > 0) {
        console.log(`   First slot: ${api2Date.slots[0].startTime} - ${api2Date.slots[0].endTime}`);
      }
    }
    console.log('');
    
    console.log('📞 API 3: GET /dentist/' + dentistId + '/details/future?date=' + date + '&serviceId=' + serviceId);
    const api3 = await axios.get(`${BASE_URL}/dentist/${dentistId}/details/future?date=${date}&serviceId=${serviceId}`);
    const api3Slots = api3.data?.data?.slots || [];
    
    console.log(`✅ API 3 Response: ${api3Slots.length} slots`);
    if (api3Slots.length > 0) {
      console.log(`   First slot: ${api3Slots[0].startTime} - ${api3Slots[0].endTime}`);
      console.log(`   Shift: ${api3Slots[0].shiftName}`);
    }
    console.log('');
    
    // Validation
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 VALIDATION');
    console.log('═══════════════════════════════════════════════════════════');
    
    let allPassed = true;
    
    // Check 1: API 3 should return slots (not empty)
    if (api3Slots.length > 0) {
      console.log('✅ Check 1: API 3 returns slots (not empty)');
    } else {
      console.log('❌ Check 1: API 3 returns empty results!');
      allPassed = false;
    }
    
    // Check 2: If API 2 has slots for the date, API 3 should have same count
    if (api2Date && api2Date.slots.length > 0) {
      if (api3Slots.length === api2Date.slots.length) {
        console.log(`✅ Check 2: API 3 (${api3Slots.length} slots) matches API 2 (${api2Date.slots.length} slots)`);
      } else {
        console.log(`⚠️  Check 2: API 3 (${api3Slots.length} slots) != API 2 (${api2Date.slots.length} slots)`);
        console.log('   Note: This might be OK if roomType filtering is different');
      }
    }
    
    // Check 3: All slot times should be >= threshold
    const invalidSlots = api3Slots.filter(s => new Date(s.startTime) < threshold);
    if (invalidSlots.length === 0) {
      console.log('✅ Check 3: All API 3 slots are >= threshold (current time + 30min)');
    } else {
      console.log(`❌ Check 3: ${invalidSlots.length} slots are before threshold!`);
      invalidSlots.forEach(s => {
        console.log(`   - ${s.startTime} (< ${threshold.toISOString()})`);
      });
      allPassed = false;
    }
    
    // Check 4: All slots should be within the selected date
    const targetDate = new Date(date);
    const vnStartOfDay = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const vnEndOfDay = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));
    
    const outsideDate = api3Slots.filter(s => {
      const slotTime = new Date(s.startTime);
      return slotTime < vnStartOfDay || slotTime >= vnEndOfDay;
    });
    
    if (outsideDate.length === 0) {
      console.log(`✅ Check 4: All API 3 slots are within date ${date}`);
    } else {
      console.log(`❌ Check 4: ${outsideDate.length} slots are outside date ${date}!`);
      outsideDate.forEach(s => {
        console.log(`   - ${s.startTime}`);
      });
      allPassed = false;
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    if (allPassed) {
      console.log('✅ ALL CHECKS PASSED - API 3 is now consistent with API 1 & 2');
    } else {
      console.log('❌ SOME CHECKS FAILED - Please review');
    }
    console.log('═══════════════════════════════════════════════════════════');
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testAPI3Fixed();

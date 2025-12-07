/**
 * TEST FILE FOR PATIENT BOOKING APIs WITH MOCK DATA
 * 
 * Test logic consistency between:
 * 1. API /dentists-with-nearest-slot (uses $gte threshold)
 * 2. API /working-dates (groups by shiftName from DB)
 * 3. API /details/future (uses $gte threshold + groups by shiftName)
 * 
 * Run: node test-patient-booking-mock.js
 */

// Mock current time: 2025-12-07 18:12 (Vietnam time)
const MOCK_CURRENT_TIME = new Date('2025-12-07T11:12:00.000Z'); // UTC time
const BUFFER_MINUTES = 30;

// Helper functions
function getVietnamTime(date) {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
}

function formatVNTime(date) {
  return date.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatTime(date) {
  const vnDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const hours = vnDate.getHours().toString().padStart(2, '0');
  const minutes = vnDate.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Mock slot data (from database)
const MOCK_SLOTS = [
  // Dentist 1: Dương Chí Trọng - has slot at 18:45 (Ca Tối)
  {
    _id: '692ab884a9793fcecf17783e',
    dentist: '6923b27cc96fd594d2e3b129',
    startTime: new Date('2025-12-07T11:45:00.000Z'), // 18:45 VN
    endTime: new Date('2025-12-07T12:00:00.000Z'),   // 19:00 VN
    shiftName: 'Ca Tối',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  },
  {
    _id: '692ab884a9793fcecf17783f',
    dentist: '6923b27cc96fd594d2e3b129',
    startTime: new Date('2025-12-07T12:00:00.000Z'), // 19:00 VN
    endTime: new Date('2025-12-07T12:15:00.000Z'),   // 19:15 VN
    shiftName: 'Ca Tối',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  },
  {
    _id: '692ab884a9793fcecf177840',
    dentist: '6923b27cc96fd594d2e3b129',
    startTime: new Date('2025-12-07T12:15:00.000Z'), // 19:15 VN
    endTime: new Date('2025-12-07T12:30:00.000Z'),   // 19:30 VN
    shiftName: 'Ca Tối',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  },
  // Dentist 2: Nguyễn Trường Sơn - next day 08:15 (Ca Sáng)
  {
    _id: '692aacd565b14a9acbff01b2',
    dentist: '6923b180c96fd594d2e3b0e7',
    startTime: new Date('2025-12-08T01:15:00.000Z'), // 08:15 VN
    endTime: new Date('2025-12-08T01:30:00.000Z'),   // 08:30 VN
    shiftName: 'Ca Sáng',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  },
  {
    _id: '692aacd565b14a9acbff01b3',
    dentist: '6923b180c96fd594d2e3b0e7',
    startTime: new Date('2025-12-08T01:30:00.000Z'), // 08:30 VN
    endTime: new Date('2025-12-08T01:45:00.000Z'),   // 08:45 VN
    shiftName: 'Ca Sáng',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  }
];

// Mock room data
const MOCK_ROOMS = {
  '692aab072373421ac38a57a0': {
    _id: '692aab072373421ac38a57a0',
    name: 'Phòng khám tổng quát',
    roomType: 'CONSULTATION'
  }
};

console.log('═'.repeat(80));
console.log('🧪 MOCK TEST: PATIENT BOOKING APIs LOGIC');
console.log('═'.repeat(80));
console.log(`Mock Current Time: ${formatVNTime(MOCK_CURRENT_TIME)} (Vietnam)`);
console.log(`Buffer: ${BUFFER_MINUTES} minutes`);
console.log('');

// Test 1: Simulate /dentists-with-nearest-slot logic
console.log('\n' + '='.repeat(80));
console.log('TEST 1: API /dentists-with-nearest-slot Logic');
console.log('='.repeat(80));

const threshold = new Date(MOCK_CURRENT_TIME.getTime() + BUFFER_MINUTES * 60 * 1000);
console.log(`Threshold (now + ${BUFFER_MINUTES} min): ${formatVNTime(threshold)}`);

// Filter slots using $gte threshold (same as real API)
const slotsAPI1 = MOCK_SLOTS.filter(slot => {
  return slot.startTime >= threshold && 
         slot.status === 'available' && 
         slot.isActive;
});

console.log(`\nSlots found with startTime >= threshold: ${slotsAPI1.length}`);
slotsAPI1.forEach(slot => {
  console.log(`  - ${slot._id.substring(0, 8)}... at ${formatTime(slot.startTime)} (${slot.shiftName})`);
});

// Group consecutive slots (30 minutes = 2 slots of 15 min)
const requiredSlots = 2;
let nearestSlotGroup = null;

for (let i = 0; i <= slotsAPI1.length - requiredSlots; i++) {
  const group = [];
  let isConsecutive = true;
  
  for (let j = 0; j < requiredSlots; j++) {
    const slot = slotsAPI1[i + j];
    if (j > 0) {
      const prevSlot = slotsAPI1[i + j - 1];
      const gap = slot.startTime.getTime() - prevSlot.endTime.getTime();
      if (Math.abs(gap) > 60000) { // > 1 minute gap
        isConsecutive = false;
        break;
      }
    }
    group.push(slot);
  }
  
  if (isConsecutive && group.length === requiredSlots) {
    nearestSlotGroup = {
      slotIds: group.map(s => s._id),
      startTime: formatTime(group[0].startTime),
      endTime: formatTime(group[group.length - 1].endTime),
      shiftName: group[0].shiftName,
      slotCount: group.length
    };
    break;
  }
}

if (nearestSlotGroup) {
  console.log('\n✅ Nearest slot group found:');
  console.log(`   Time: ${nearestSlotGroup.startTime} - ${nearestSlotGroup.endTime}`);
  console.log(`   Shift: ${nearestSlotGroup.shiftName}`);
  console.log(`   Slots: ${nearestSlotGroup.slotCount}`);
} else {
  console.log('\n❌ No consecutive slot group found');
}

// Test 2: Simulate /working-dates logic (FIXED VERSION)
console.log('\n' + '='.repeat(80));
console.log('TEST 2: API /working-dates Logic (FIXED with shiftName from DB)');
console.log('='.repeat(80));

const slotsAPI2 = MOCK_SLOTS.filter(slot => {
  return slot.startTime >= threshold && 
         slot.status === 'available' && 
         slot.isActive;
});

console.log(`\nSlots found: ${slotsAPI2.length}`);

// Group by date and shift (using shiftName from DB - FIXED)
const dateMap = new Map();

slotsAPI2.forEach(slot => {
  const date = slot.startTime.toISOString().split('T')[0];
  
  if (!dateMap.has(date)) {
    dateMap.set(date, {
      date: date,
      shifts: {
        morning: { available: false, slots: [] },
        afternoon: { available: false, slots: [] },
        evening: { available: false, slots: [] }
      }
    });
  }
  
  const dateData = dateMap.get(date);
  
  // ✅ FIX: Use shiftName from database instead of calculating from hour
  let shiftKey = 'morning';
  if (slot.shiftName === 'Ca Sáng') shiftKey = 'morning';
  else if (slot.shiftName === 'Ca Chiều') shiftKey = 'afternoon';
  else if (slot.shiftName === 'Ca Tối') shiftKey = 'evening';
  
  dateData.shifts[shiftKey].slots.push(slot);
});

// Check for consecutive slots in each shift
dateMap.forEach((dateData, date) => {
  Object.entries(dateData.shifts).forEach(([shiftKey, shiftData]) => {
    if (shiftData.slots.length >= requiredSlots) {
      // Check for consecutive slots
      let hasConsecutive = false;
      for (let i = 0; i <= shiftData.slots.length - requiredSlots; i++) {
        let isConsecutive = true;
        for (let j = 1; j < requiredSlots; j++) {
          const prevSlot = shiftData.slots[i + j - 1];
          const currentSlot = shiftData.slots[i + j];
          const gap = currentSlot.startTime.getTime() - prevSlot.endTime.getTime();
          if (Math.abs(gap) > 60000) {
            isConsecutive = false;
            break;
          }
        }
        if (isConsecutive) {
          hasConsecutive = true;
          break;
        }
      }
      shiftData.available = hasConsecutive;
    }
  });
  
  console.log(`\nDate: ${date}`);
  Object.entries(dateData.shifts).forEach(([shiftKey, shiftData]) => {
    const status = shiftData.available ? '✅' : '❌';
    console.log(`  ${status} ${shiftKey}: ${shiftData.available ? 'AVAILABLE' : 'NOT AVAILABLE'} (${shiftData.slots.length} slots)`);
    if (shiftData.slots.length > 0) {
      shiftData.slots.forEach(slot => {
        console.log(`      - ${formatTime(slot.startTime)} (${slot.shiftName})`);
      });
    }
  });
});

// Test 3: Simulate /details/future logic (FIXED VERSION)
console.log('\n' + '='.repeat(80));
console.log('TEST 3: API /details/future Logic (FIXED with $gte)');
console.log('='.repeat(80));

const testDate = '2025-12-07';
console.log(`Query for date: ${testDate}`);
console.log(`Using threshold: ${formatVNTime(threshold)}`);

// Filter slots for specific date with $gte threshold (FIXED)
const slotsAPI3 = MOCK_SLOTS.filter(slot => {
  const slotDate = slot.startTime.toISOString().split('T')[0];
  return slotDate === testDate &&
         slot.startTime >= threshold && // ✅ CHANGED from > to >=
         slot.status === 'available' && 
         slot.isActive;
});

console.log(`\nSlots found with startTime >= threshold: ${slotsAPI3.length}`);
slotsAPI3.forEach(slot => {
  console.log(`  - ${slot._id.substring(0, 8)}... at ${formatTime(slot.startTime)} (${slot.shiftName})`);
});

// Group by shift
const groupedByShift = {
  'Ca Sáng': slotsAPI3.filter(s => s.shiftName === 'Ca Sáng'),
  'Ca Chiều': slotsAPI3.filter(s => s.shiftName === 'Ca Chiều'),
  'Ca Tối': slotsAPI3.filter(s => s.shiftName === 'Ca Tối')
};

console.log('\nGrouped by shift:');
Object.entries(groupedByShift).forEach(([shift, slots]) => {
  console.log(`  ${shift}: ${slots.length} slots`);
  slots.forEach(slot => {
    console.log(`    - ${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`);
  });
});

// Cross-validation
console.log('\n' + '═'.repeat(80));
console.log('📊 CROSS-VALIDATION');
console.log('═'.repeat(80));

const validations = [];

// Validation 1: API 1 and API 3 should return same slots for same date
const api1SlotsForDate = slotsAPI1.filter(s => 
  s.startTime.toISOString().split('T')[0] === testDate
);
const matchingSlots = api1SlotsForDate.length === slotsAPI3.length &&
                      api1SlotsForDate.every(s1 => 
                        slotsAPI3.some(s3 => s3._id === s1._id)
                      );

validations.push({
  check: 'API 1 and API 3 return same slots for same date',
  result: matchingSlots,
  details: `API1: ${api1SlotsForDate.length} slots, API3: ${slotsAPI3.length} slots`
});

// Validation 2: Nearest slot from API 1 should exist in API 3
const nearestSlotInAPI3 = nearestSlotGroup && slotsAPI3.some(s => 
  nearestSlotGroup.slotIds.includes(s._id)
);

validations.push({
  check: 'Nearest slot from API 1 exists in API 3',
  result: nearestSlotInAPI3,
  details: nearestSlotGroup ? 
    `Found at ${nearestSlotGroup.startTime}` : 
    'No nearest slot found in API 1'
});

// Validation 3: Shift grouping consistency
const shiftConsistency = slotsAPI3.every(slot => {
  const expectedShift = slot.shiftName;
  const groupedShift = Object.entries(groupedByShift).find(([shift, slots]) => 
    slots.some(s => s._id === slot._id)
  );
  return groupedShift && groupedShift[0] === expectedShift;
});

validations.push({
  check: 'Slots grouped into correct shifts (by shiftName)',
  result: shiftConsistency,
  details: 'All slots match their database shiftName'
});

// Validation 4: $gte vs $gt comparison
const thresholdTime = threshold.getTime();
const nearestSlotTime = nearestSlotGroup ? 
  MOCK_SLOTS.find(s => s._id === nearestSlotGroup.slotIds[0]).startTime.getTime() :
  null;

if (nearestSlotTime) {
  const useGTE = nearestSlotTime >= thresholdTime;
  const useGT = nearestSlotTime > thresholdTime;
  
  validations.push({
    check: 'Threshold comparison ($gte vs $gt)',
    result: useGTE,
    details: `Slot ${formatTime(new Date(nearestSlotTime))} ${useGTE ? '>=' : '<'} threshold ${formatTime(threshold)}. ` +
             `$gte: ${useGTE ? '✅' : '❌'}, $gt: ${useGT ? '✅' : '❌'}`
  });
}

// Print validation results
console.log('');
validations.forEach(v => {
  console.log(`${v.result ? '✅' : '❌'} ${v.check}`);
  console.log(`   ${v.details}`);
});

// Summary
const allPassed = validations.every(v => v.result);
const totalPassed = validations.filter(v => v.result).length;

console.log('\n' + '═'.repeat(80));
console.log('📊 TEST SUMMARY');
console.log('═'.repeat(80));
console.log(`Total: ${totalPassed}/${validations.length} validations passed`);
console.log(allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');
console.log('═'.repeat(80) + '\n');

process.exit(allPassed ? 0 : 1);

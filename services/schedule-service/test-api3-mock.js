/**
 * Test API 3 with mock data to verify the fix
 * Simulates the scenario where API 1 & 2 work but API 3 returns empty
 */

const mongoose = require('mongoose');

// Mock data setup
const mockSlots = [
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    subRoomId: null,
    shiftName: 'Chiều',
    startTime: new Date('2025-12-07T12:30:00.000Z'), // 19:30 VN
    endTime: new Date('2025-12-07T13:00:00.000Z'),   // 20:00 VN
    status: 'available',
    isActive: true,
    scheduleId: new mongoose.Types.ObjectId(),
    duration: 30
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    subRoomId: null,
    shiftName: 'Chiều',
    startTime: new Date('2025-12-07T12:45:00.000Z'), // 19:45 VN
    endTime: new Date('2025-12-07T13:15:00.000Z'),   // 20:15 VN
    status: 'available',
    isActive: true,
    scheduleId: new mongoose.Types.ObjectId(),
    duration: 30
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    subRoomId: null,
    shiftName: 'Chiều',
    startTime: new Date('2025-12-07T13:00:00.000Z'), // 20:00 VN
    endTime: new Date('2025-12-07T13:30:00.000Z'),   // 20:30 VN
    status: 'available',
    isActive: true,
    scheduleId: new mongoose.Types.ObjectId(),
    duration: 30
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    subRoomId: null,
    shiftName: 'Tối',
    startTime: new Date('2025-12-07T13:30:00.000Z'), // 20:30 VN
    endTime: new Date('2025-12-07T14:00:00.000Z'),   // 21:00 VN
    status: 'available',
    isActive: true,
    scheduleId: new mongoose.Types.ObjectId(),
    duration: 30
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    subRoomId: null,
    shiftName: 'Tối',
    startTime: new Date('2025-12-07T14:00:00.000Z'), // 21:00 VN
    endTime: new Date('2025-12-07T14:30:00.000Z'),   // 21:30 VN
    status: 'available',
    isActive: true,
    scheduleId: new mongoose.Types.ObjectId(),
    duration: 30
  }
];

// Test scenarios
function testOldLogic() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔴 OLD LOGIC (Using endUTC with $lt)');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Simulate testing at 19:16 VN (12:16 UTC)
  const testTime = new Date('2025-12-07T12:16:00.000Z'); // 19:16 VN
  const vietnamNow = new Date(testTime);
  vietnamNow.setMinutes(vietnamNow.getMinutes() + 30); // Add 30 min buffer
  const effectiveStartTime = vietnamNow; // 12:46 UTC (19:46 VN)
  
  const date = '2025-12-07';
  const targetDate = new Date(date);
  const endUTC = new Date(Date.UTC(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    -7 + 24, 0, 0, 0
  )); // 2025-12-07 17:00 UTC = 2025-12-08 00:00 VN
  
  console.log('⏰ Test time:', testTime.toISOString(), '(19:16 VN)');
  console.log('🕐 Effective start time:', effectiveStartTime.toISOString(), '(19:46 VN)');
  console.log('📅 End UTC:', endUTC.toISOString(), '(00:00 VN next day)\n');
  
  // Old query filter
  const filteredOld = mockSlots.filter(slot => {
    return slot.startTime >= effectiveStartTime && slot.startTime < endUTC;
  });
  
  console.log(`📊 Query: startTime >= ${effectiveStartTime.toISOString()} AND < ${endUTC.toISOString()}`);
  console.log(`✅ Result: ${filteredOld.length} slots\n`);
  
  if (filteredOld.length > 0) {
    console.log('📋 Slots returned:');
    filteredOld.forEach(slot => {
      console.log(`   - ${slot.startTime.toISOString()} (${slot.shiftName})`);
    });
  } else {
    console.log('❌ NO SLOTS RETURNED!');
  }
  console.log('');
  
  return filteredOld.length;
}

function testNewLogic() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🟢 NEW LOGIC (Using maxDate with $lte, same as API 1 & 2)');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Simulate testing at 19:16 VN (12:16 UTC)
  const now = new Date('2025-12-07T12:16:00.000Z'); // 19:16 VN
  const threshold = new Date(now.getTime() + 30 * 60 * 1000); // 12:46 UTC (19:46 VN)
  
  const maxBookingDays = 30;
  const maxDate = new Date(now);
  maxDate.setDate(maxDate.getDate() + maxBookingDays);
  
  console.log('⏰ Current time:', now.toISOString(), '(19:16 VN)');
  console.log('🕐 Threshold (now + 30min):', threshold.toISOString(), '(19:46 VN)');
  console.log('📅 Max date (now + 30 days):', maxDate.toISOString(), '\n');
  
  // New query filter (same as API 1 & 2)
  const filteredByQuery = mockSlots.filter(slot => {
    return slot.startTime >= threshold && slot.startTime <= maxDate;
  });
  
  console.log(`📊 Query: startTime >= ${threshold.toISOString()} AND <= ${maxDate.toISOString()}`);
  console.log(`✅ Result from query: ${filteredByQuery.length} slots\n`);
  
  // Then filter by date (to keep API 3 behavior of filtering by selected date)
  const date = '2025-12-07';
  const targetDate = new Date(date);
  const vnStartOfDay = new Date(Date.UTC(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    -7, 0, 0, 0
  )); // 2025-12-06 17:00 UTC = 2025-12-07 00:00 VN
  const vnEndOfDay = new Date(Date.UTC(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    -7 + 24, 0, 0, 0
  )); // 2025-12-07 17:00 UTC = 2025-12-08 00:00 VN
  
  const filteredByDate = filteredByQuery.filter(slot => {
    return slot.startTime >= vnStartOfDay && slot.startTime < vnEndOfDay;
  });
  
  console.log(`📅 Filter by date ${date}:`);
  console.log(`   Start: ${vnStartOfDay.toISOString()} (00:00 VN)`);
  console.log(`   End: ${vnEndOfDay.toISOString()} (00:00 VN next day)`);
  console.log(`✅ Result after date filter: ${filteredByDate.length} slots\n`);
  
  if (filteredByDate.length > 0) {
    console.log('📋 Slots returned:');
    filteredByDate.forEach(slot => {
      console.log(`   - ${slot.startTime.toISOString()} (${slot.shiftName})`);
    });
  } else {
    console.log('❌ NO SLOTS RETURNED!');
  }
  console.log('');
  
  return filteredByDate.length;
}

function testEdgeCases() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 EDGE CASE TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Test 1: Early morning (before first slot)
  console.log('Test 1: Early morning at 06:00 VN (23:00 UTC prev day)');
  const earlyMorning = new Date('2025-12-06T23:00:00.000Z');
  const threshold1 = new Date(earlyMorning.getTime() + 30 * 60 * 1000);
  console.log(`   Threshold: ${threshold1.toISOString()} (06:30 VN)`);
  
  const maxDate1 = new Date(earlyMorning);
  maxDate1.setDate(maxDate1.getDate() + 30);
  
  const result1 = mockSlots.filter(slot => {
    return slot.startTime >= threshold1 && slot.startTime <= maxDate1;
  });
  
  // Filter by date 2025-12-07
  const date = '2025-12-07';
  const targetDate = new Date(date);
  const vnStart = new Date(Date.UTC(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    -7, 0, 0, 0
  ));
  const vnEnd = new Date(Date.UTC(
    targetDate.getFullYear(),
    targetDate.getMonth(),
    targetDate.getDate(),
    -7 + 24, 0, 0, 0
  ));
  
  const result1Final = result1.filter(s => s.startTime >= vnStart && s.startTime < vnEnd);
  console.log(`   ✅ Result: ${result1Final.length} slots (should be 5 - all slots)`);
  console.log('');
  
  // Test 2: Late evening (after last slot)
  console.log('Test 2: Late evening at 22:00 VN (15:00 UTC)');
  const lateEvening = new Date('2025-12-07T15:00:00.000Z');
  const threshold2 = new Date(lateEvening.getTime() + 30 * 60 * 1000);
  console.log(`   Threshold: ${threshold2.toISOString()} (22:30 VN)`);
  
  const maxDate2 = new Date(lateEvening);
  maxDate2.setDate(maxDate2.getDate() + 30);
  
  const result2 = mockSlots.filter(slot => {
    return slot.startTime >= threshold2 && slot.startTime <= maxDate2;
  });
  
  const result2Final = result2.filter(s => s.startTime >= vnStart && s.startTime < vnEnd);
  console.log(`   ✅ Result: ${result2Final.length} slots (should be 0 - all slots before threshold)`);
  console.log('');
  
  // Test 3: Exact slot time (19:30 VN = 12:30 UTC)
  console.log('Test 3: Exact slot time at 19:30 VN (12:30 UTC)');
  const exactSlot = new Date('2025-12-07T12:30:00.000Z');
  const threshold3 = new Date(exactSlot.getTime() + 30 * 60 * 1000);
  console.log(`   Threshold: ${threshold3.toISOString()} (20:00 VN)`);
  
  const maxDate3 = new Date(exactSlot);
  maxDate3.setDate(maxDate3.getDate() + 30);
  
  const result3 = mockSlots.filter(slot => {
    return slot.startTime >= threshold3 && slot.startTime <= maxDate3;
  });
  
  const result3Final = result3.filter(s => s.startTime >= vnStart && s.startTime < vnEnd);
  console.log(`   ✅ Result: ${result3Final.length} slots (should be 3 - slots at 20:00, 20:30, 21:00)`);
  console.log('');
}

// Run all tests
console.log('\n');
console.log('🧪 TESTING API 3 FIX WITH MOCK DATA');
console.log('═══════════════════════════════════════════════════════════');
console.log('Mock data: 5 slots for dentist on 2025-12-07');
console.log('  - 19:30 VN (12:30 UTC) - Chiều');
console.log('  - 19:45 VN (12:45 UTC) - Chiều');
console.log('  - 20:00 VN (13:00 UTC) - Chiều');
console.log('  - 20:30 VN (13:30 UTC) - Tối');
console.log('  - 21:00 VN (14:00 UTC) - Tối');
console.log('═══════════════════════════════════════════════════════════\n\n');

const oldCount = testOldLogic();
const newCount = testNewLogic();
testEdgeCases();

// Final summary
console.log('═══════════════════════════════════════════════════════════');
console.log('📊 SUMMARY');
console.log('═══════════════════════════════════════════════════════════');
console.log(`🔴 Old logic: ${oldCount} slots returned`);
console.log(`🟢 New logic: ${newCount} slots returned`);
console.log('');

if (newCount > oldCount) {
  console.log('✅ FIX SUCCESSFUL!');
  console.log('   New logic returns more slots than old logic');
  console.log('   API 3 should now match API 1 & 2 behavior');
} else if (newCount === oldCount && newCount > 0) {
  console.log('✅ BOTH WORK');
  console.log('   Both old and new logic return same results');
} else {
  console.log('⚠️  NEED INVESTIGATION');
  console.log('   New logic does not return more slots');
}
console.log('═══════════════════════════════════════════════════════════\n');

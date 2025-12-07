/**
 * Test demonstrating why API 3 needed to be fixed
 * Shows scenario where old logic fails but new logic works
 */

const mongoose = require('mongoose');

console.log('\n🔍 DEMONSTRATING THE BUG IN OLD API 3 LOGIC\n');
console.log('═══════════════════════════════════════════════════════════');
console.log('SCENARIO: User tests at 19:16 VN on 2025-12-07');
console.log('Expected: Should see slots starting from 19:46 VN onwards');
console.log('═══════════════════════════════════════════════════════════\n');

// Mock slots with realistic production data
const mockSlots = [
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    shiftName: 'Chiều',
    startTime: new Date('2025-12-07T12:30:00.000Z'), // 19:30 VN - BEFORE threshold
    endTime: new Date('2025-12-07T13:00:00.000Z'),
    status: 'available',
    isActive: true
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    shiftName: 'Chiều',
    startTime: new Date('2025-12-07T12:45:00.000Z'), // 19:45 VN - BEFORE threshold
    endTime: new Date('2025-12-07T13:15:00.000Z'),
    status: 'available',
    isActive: true
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    shiftName: 'Chiều',
    startTime: new Date('2025-12-07T12:46:00.000Z'), // 19:46 VN - EXACT threshold (should appear)
    endTime: new Date('2025-12-07T13:16:00.000Z'),
    status: 'available',
    isActive: true
  },
  {
    _id: new mongoose.Types.ObjectId(),
    dentist: new mongoose.Types.ObjectId('66dce9edcc7f9bdc78d89e81'),
    roomId: new mongoose.Types.ObjectId('674b0c0c4dba54f42f0e7f01'),
    shiftName: 'Tối',
    startTime: new Date('2025-12-07T13:00:00.000Z'), // 20:00 VN - AFTER threshold
    endTime: new Date('2025-12-07T13:30:00.000Z'),
    status: 'available',
    isActive: true
  }
];

// User's production test parameters
const testDate = '2025-12-07';
const testTime = new Date('2025-12-07T12:16:00.000Z'); // 19:16 VN
const bufferMinutes = 30;

console.log('📋 Available slots in database:');
mockSlots.forEach((slot, i) => {
  const vnHour = slot.startTime.getUTCHours() + 7;
  const vnMin = slot.startTime.getUTCMinutes();
  console.log(`   ${i + 1}. ${slot.startTime.toISOString()} (${vnHour}:${vnMin.toString().padStart(2, '0')} VN) - ${slot.shiftName}`);
});
console.log('');

// OLD LOGIC TEST
console.log('═══════════════════════════════════════════════════════════');
console.log('🔴 OLD API 3 LOGIC (Using vietnamNow + endUTC)');
console.log('═══════════════════════════════════════════════════════════\n');

// Calculate like old API 3
function getVietnamDate() {
  const now = new Date();
  const utcOffset = now.getTimezoneOffset() * 60000;
  const vietnamOffset = 7 * 3600000;
  return new Date(now.getTime() + utcOffset + vietnamOffset);
}

const vietnamNow = new Date(testTime);
vietnamNow.setHours(vietnamNow.getUTCHours() + 7); // Convert to VN timezone
vietnamNow.setMinutes(vietnamNow.getMinutes() + bufferMinutes);
const effectiveStartTime = new Date(vietnamNow.getTime() - (7 * 3600000)); // Convert back to UTC

const targetDate = new Date(testDate);
const endUTC = new Date(Date.UTC(
  targetDate.getFullYear(),
  targetDate.getMonth(),
  targetDate.getDate(),
  -7 + 24, 0, 0, 0
));

console.log('⏰ Test time:', testTime.toISOString(), '(19:16 VN)');
console.log('🕐 Vietnam now + buffer:', vietnamNow.toISOString());
console.log('🕐 Effective start time:', effectiveStartTime.toISOString());
console.log('📅 End UTC (end of day):', endUTC.toISOString());
console.log('');

const oldQuery = `startTime >= ${effectiveStartTime.toISOString()} AND < ${endUTC.toISOString()}`;
console.log('🔍 Query:', oldQuery);
console.log('');

const oldResults = mockSlots.filter(slot => {
  const match = slot.startTime >= effectiveStartTime && slot.startTime < endUTC;
  const vnHour = slot.startTime.getUTCHours() + 7;
  const vnMin = slot.startTime.getUTCMinutes();
  console.log(`   ${slot.startTime.toISOString()} (${vnHour}:${vnMin.toString().padStart(2, '0')} VN): ${match ? '✅' : '❌'}`);
  return match;
});

console.log('');
console.log(`📊 Result: ${oldResults.length} slots`);
if (oldResults.length === 0) {
  console.log('❌ PROBLEM: No slots returned (but slots exist after 19:46!)');
}
console.log('');

// NEW LOGIC TEST
console.log('═══════════════════════════════════════════════════════════');
console.log('🟢 NEW API 3 LOGIC (Using threshold + maxDate, same as API 1 & 2)');
console.log('═══════════════════════════════════════════════════════════\n');

const now = new Date(testTime);
const threshold = new Date(now.getTime() + bufferMinutes * 60 * 1000);
const maxBookingDays = 30;
const maxDate = new Date(now);
maxDate.setDate(maxDate.getDate() + maxBookingDays);

console.log('⏰ Current time (server):', now.toISOString(), '(19:16 VN)');
console.log('🕐 Threshold (now + 30min):', threshold.toISOString(), '(19:46 VN)');
console.log('📅 Max date (now + 30 days):', maxDate.toISOString());
console.log('');

const newQuery = `startTime >= ${threshold.toISOString()} AND <= ${maxDate.toISOString()}`;
console.log('🔍 Query:', newQuery);
console.log('');

const newResultsFromQuery = mockSlots.filter(slot => {
  const match = slot.startTime >= threshold && slot.startTime <= maxDate;
  const vnHour = slot.startTime.getUTCHours() + 7;
  const vnMin = slot.startTime.getUTCMinutes();
  console.log(`   ${slot.startTime.toISOString()} (${vnHour}:${vnMin.toString().padStart(2, '0')} VN): ${match ? '✅' : '❌'}`);
  return match;
});

console.log('');
console.log(`📊 Result from query: ${newResultsFromQuery.length} slots`);
console.log('');

// Filter by selected date
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

console.log('📅 Filter by date', testDate, ':');
console.log('   Start:', vnStartOfDay.toISOString(), '(00:00 VN)');
console.log('   End:', vnEndOfDay.toISOString(), '(00:00 VN next day)');
console.log('');

const newResults = newResultsFromQuery.filter(slot => {
  const match = slot.startTime >= vnStartOfDay && slot.startTime < vnEndOfDay;
  const vnHour = slot.startTime.getUTCHours() + 7;
  const vnMin = slot.startTime.getUTCMinutes();
  console.log(`   ${slot.startTime.toISOString()} (${vnHour}:${vnMin.toString().padStart(2, '0')} VN): ${match ? '✅' : '❌'}`);
  return match;
});

console.log('');
console.log(`📊 Final result: ${newResults.length} slots`);
if (newResults.length > 0) {
  console.log('✅ SUCCESS: Slots returned correctly');
}
console.log('');

// COMPARISON
console.log('═══════════════════════════════════════════════════════════');
console.log('📊 COMPARISON');
console.log('═══════════════════════════════════════════════════════════\n');

console.log(`🔴 Old logic: ${oldResults.length} slots`);
console.log(`🟢 New logic: ${newResults.length} slots`);
console.log('');

if (newResults.length > oldResults.length) {
  console.log('✅ FIX VERIFIED!');
  console.log('   New logic returns MORE slots than old logic');
  console.log('   This matches the behavior of API 1 & 2');
  console.log('');
  console.log('💡 Why did old logic fail?');
  console.log('   Old logic used Vietnam timezone conversion which could');
  console.log('   cause incorrect threshold calculation in some scenarios');
  console.log('');
  console.log('💡 Why does new logic work?');
  console.log('   New logic uses server time (UTC) directly, same as API 1 & 2');
  console.log('   Then filters by date range to maintain API 3 behavior');
} else if (newResults.length === oldResults.length) {
  console.log('ℹ️  SAME RESULT');
  console.log('   In this scenario, both logics return same number of slots');
  console.log('   But new logic is more consistent with API 1 & 2');
} else {
  console.log('⚠️  UNEXPECTED');
  console.log('   Old logic returned more slots than new logic');
  console.log('   This should not happen with correct implementation');
}

console.log('═══════════════════════════════════════════════════════════\n');

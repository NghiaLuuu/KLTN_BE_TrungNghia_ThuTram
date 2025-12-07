/**
 * Test timezone helper fix
 * Run: node test-timezone-fix.js
 */

const { getStartOfDayVN, getEndOfDayVN } = require('./src/utils/timezone.helper');

console.log('='.repeat(80));
console.log('TEST TIMEZONE HELPER - FIX VERIFICATION');
console.log('='.repeat(80));

// Simulate current time: 2025-12-07 in VN
const testDate = new Date('2025-12-07T10:00:00+07:00'); // 10:00 AM VN time = 03:00 UTC

console.log('\n📅 Test Date (VN time): 2025-12-07 10:00:00 +07:00');
console.log('📅 Test Date (UTC):     ', testDate.toISOString());

// Test getStartOfDayVN
console.log('\n' + '='.repeat(80));
console.log('TEST 1: getStartOfDayVN()');
console.log('='.repeat(80));

const startOfDay = getStartOfDayVN(testDate);
console.log('Result (UTC):        ', startOfDay.toISOString());
console.log('Expected (UTC):      ', '2025-12-06T17:00:00.000Z');
console.log('Match:               ', startOfDay.toISOString() === '2025-12-06T17:00:00.000Z' ? '✅ PASS' : '❌ FAIL');

// Verify it represents midnight VN time
const vnMidnight = new Date(startOfDay.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('Represents (VN time):', vnMidnight.toString());
console.log('Should be:          ', '2025-12-07 00:00:00');

// Test getEndOfDayVN
console.log('\n' + '='.repeat(80));
console.log('TEST 2: getEndOfDayVN()');
console.log('='.repeat(80));

const endOfDay = getEndOfDayVN(testDate);
console.log('Result (UTC):        ', endOfDay.toISOString());
console.log('Expected (UTC):      ', '2025-12-07T16:59:59.999Z');
console.log('Match:               ', endOfDay.toISOString() === '2025-12-07T16:59:59.999Z' ? '✅ PASS' : '❌ FAIL');

// Test with appointment date from API
console.log('\n' + '='.repeat(80));
console.log('TEST 3: Query Range for VN Date 2025-12-07');
console.log('='.repeat(80));

console.log('Query should be:');
console.log('  appointmentDate >= ', startOfDay.toISOString());
console.log('  appointmentDate <= ', endOfDay.toISOString());

// Test appointment dates
const testAppointments = [
  { date: '2025-12-06T17:00:00.000Z', vnDate: '2025-12-07 00:00', shouldMatch: true },
  { date: '2025-12-07T02:00:00.000Z', vnDate: '2025-12-07 09:00', shouldMatch: true },
  { date: '2025-12-07T10:00:00.000Z', vnDate: '2025-12-07 17:00', shouldMatch: true },
  { date: '2025-12-07T16:59:59.999Z', vnDate: '2025-12-07 23:59', shouldMatch: true },
  { date: '2025-12-07T17:00:00.000Z', vnDate: '2025-12-08 00:00', shouldMatch: false },
  { date: '2025-12-05T17:00:00.000Z', vnDate: '2025-12-06 00:00', shouldMatch: false },
];

console.log('\nAppointment matching test:');
testAppointments.forEach(apt => {
  const aptDate = new Date(apt.date);
  const matches = aptDate >= startOfDay && aptDate <= endOfDay;
  const status = matches === apt.shouldMatch ? '✅' : '❌';
  console.log(`${status} ${apt.date} (${apt.vnDate} VN) → ${matches ? 'MATCH' : 'NO MATCH'} (expected: ${apt.shouldMatch ? 'MATCH' : 'NO MATCH'})`);
});

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log('✅ If all tests pass, the fix is correct!');
console.log('❌ If any test fails, need to review the logic again.');
console.log('='.repeat(80));

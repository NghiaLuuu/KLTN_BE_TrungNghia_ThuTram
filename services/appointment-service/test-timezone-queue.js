/**
 * Test timezone logic cho queue service
 * Kiểm tra xem parse date và query có đúng không
 */

const { 
  getStartOfDayVN, 
  getEndOfDayVN, 
  getNowVN,
  parseVNDate 
} = require('./src/utils/timezone.helper');

console.log('\n=== TEST TIMEZONE HELPER ===\n');

// Test 1: parseVNDate
console.log('TEST 1: parseVNDate("2025-11-27")');
const testDate = parseVNDate('2025-11-27');
console.log('Result:', testDate);
console.log('ISO String:', testDate.toISOString());
console.log('Expected: 2025-11-26T17:00:00.000Z (UTC) = 2025-11-27 00:00:00 VN');
console.log('Match:', testDate.toISOString() === '2025-11-26T17:00:00.000Z' ? '✅' : '❌');

// Test 2: getStartOfDayVN
console.log('\n\nTEST 2: getStartOfDayVN() - Hôm nay 02/12/2025');
const startOfDay = getStartOfDayVN();
console.log('Result:', startOfDay);
console.log('ISO String:', startOfDay.toISOString());
console.log('Expected: 2025-12-01T17:00:00.000Z (UTC) = 2025-12-02 00:00:00 VN');
console.log('Match:', startOfDay.toISOString().startsWith('2025-12-01T17:00:00') ? '✅' : '❌');

// Test 3: getEndOfDayVN
console.log('\n\nTEST 3: getEndOfDayVN() - Hôm nay 02/12/2025');
const endOfDay = getEndOfDayVN();
console.log('Result:', endOfDay);
console.log('ISO String:', endOfDay.toISOString());
console.log('Expected: 2025-12-02T16:59:59.999Z (UTC) = 2025-12-02 23:59:59 VN');
console.log('Match:', endOfDay.toISOString().startsWith('2025-12-02T16:59:59') ? '✅' : '❌');

// Test 4: getNowVN
console.log('\n\nTEST 4: getNowVN()');
const nowVN = getNowVN();
console.log('Result:', nowVN);
console.log('ISO String:', nowVN.toISOString());

// Test 5: Kiểm tra query logic
console.log('\n\n=== TEST QUERY LOGIC ===\n');
console.log('Giả sử hôm nay là 02/12/2025 14:30 VN time');
console.log('Query appointments "hôm nay" nên lấy:');
console.log('  - appointmentDate >= 2025-12-01T17:00:00.000Z (00:00 VN 02/12)');
console.log('  - appointmentDate <= 2025-12-02T16:59:59.999Z (23:59 VN 02/12)');

const sampleAppointments = [
  {
    id: 1,
    appointmentDate: parseVNDate('2025-12-01'),
    note: 'Ngày 01/12 - KHÔNG nên lấy'
  },
  {
    id: 2,
    appointmentDate: parseVNDate('2025-12-02'),
    note: 'Ngày 02/12 - NÊN lấy ✅'
  },
  {
    id: 3,
    appointmentDate: parseVNDate('2025-12-03'),
    note: 'Ngày 03/12 - KHÔNG nên lấy'
  }
];

console.log('\n\nSample appointments:');
sampleAppointments.forEach(apt => {
  console.log(`\nID ${apt.id}:`);
  console.log(`  Date VN: ${apt.note}`);
  console.log(`  Date UTC: ${apt.appointmentDate.toISOString()}`);
  
  const isInRange = apt.appointmentDate >= startOfDay && apt.appointmentDate <= endOfDay;
  console.log(`  In range: ${isInRange ? '✅ YES' : '❌ NO'}`);
});

// Test 6: Kiểm tra parse các edge cases
console.log('\n\n=== TEST EDGE CASES ===\n');

// Edge case 1: Date string có timezone
console.log('Edge case 1: Date string có timezone');
try {
  const date1 = parseVNDate('2025-11-27T00:00:00+07:00');
  console.log('Result:', date1.toISOString());
  console.log('Expected: 2025-11-26T17:00:00.000Z');
  console.log('Match:', date1.toISOString() === '2025-11-26T17:00:00.000Z' ? '✅' : '❌');
} catch (err) {
  console.log('Error:', err.message);
}

// Edge case 2: Invalid date
console.log('\n\nEdge case 2: Invalid date');
try {
  const date2 = parseVNDate('invalid-date');
  console.log('Result:', date2);
} catch (err) {
  console.log('Error caught ✅:', err.message);
}

// Edge case 3: Date object input
console.log('\n\nEdge case 3: Date object input');
try {
  const dateObj = new Date('2025-11-27T00:00:00Z');
  const date3 = parseVNDate(dateObj);
  console.log('Result:', date3.toISOString());
} catch (err) {
  console.log('Error:', err.message);
}

// Test 7: Verify FE display logic
console.log('\n\n=== TEST FE DISPLAY LOGIC ===\n');
console.log('Giả sử FE browser ở timezone Asia/Ho_Chi_Minh (UTC+7)');
console.log('Appointment date trong DB: 2025-11-26T17:00:00.000Z');
console.log('Khi FE dùng dayjs().format("DD/MM/YYYY"):');

// Simulate FE parsing
const dbDate = new Date('2025-11-26T17:00:00.000Z');
console.log('\nDB Date (UTC):', dbDate.toISOString());
console.log('Browser local string:', dbDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('Expected display: 27/11/2025');

// Extract date parts in VN timezone
const vnDateParts = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(dbDate);
console.log('Actual display:', vnDateParts);
console.log('Match: 27/11/2025:', vnDateParts === '27/11/2025' ? '✅' : '❌');

console.log('\n\n=== TEST COMPLETED ===\n');

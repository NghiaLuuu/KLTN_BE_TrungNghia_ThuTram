/**
 * Test bug generateAppointmentCode
 */

const appointmentDate = new Date('2025-12-02T17:00:00.000Z');

console.log('🐛 BUG TRONG generateAppointmentCode');
console.log('='.repeat(80));

console.log('\n1️⃣ Input appointmentDate:');
console.log('  UTC:', appointmentDate.toISOString());
console.log('  Vietnam:', appointmentDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

console.log('\n2️⃣ CURRENT WRONG LOGIC:');
console.log('  const day = String(date.getDate()).padStart(2, "0");');
console.log('  const month = String(date.getMonth() + 1).padStart(2, "0");');
console.log('  const year = date.getFullYear();');

const wrongDay = String(appointmentDate.getDate()).padStart(2, '0');
const wrongMonth = String(appointmentDate.getMonth() + 1).padStart(2, '0');
const wrongYear = appointmentDate.getFullYear();
const wrongDateStr = `${wrongDay}${wrongMonth}${wrongYear}`;

console.log(`  Result: day=${wrongDay}, month=${wrongMonth}, year=${wrongYear}`);
console.log(`  dateStr: ${wrongDateStr}`);
console.log(`  appointmentCode: AP000001-${wrongDateStr}`);
console.log('  ❌ WRONG! Đây là ngày 02/12/2025 (UTC) nhưng thực tế là 03/12/2025 (Vietnam)!');

console.log('\n3️⃣ CORRECT LOGIC (using Vietnam timezone):');
console.log('  Get date parts in Vietnam timezone:');

// Cách 1: Dùng toLocaleString
const vietnamDateStr = appointmentDate.toLocaleString('en-US', { 
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
console.log('  vietnamDateStr:', vietnamDateStr); // MM/DD/YYYY

const [vnMonth, vnDay, vnYear] = vietnamDateStr.split('/');
const correctDateStr = `${vnDay}${vnMonth}${vnYear}`;
console.log(`  Result: day=${vnDay}, month=${vnMonth}, year=${vnYear}`);
console.log(`  dateStr: ${correctDateStr}`);
console.log(`  appointmentCode: AP000001-${correctDateStr}`);
console.log('  ✅ CORRECT!');

console.log('\n4️⃣ ALSO WRONG: startOfDay/endOfDay calculation:');
console.log('  const startOfDay = new Date(date);');
console.log('  startOfDay.setHours(0, 0, 0, 0);  // ❌ Uses local timezone!');

const wrongStartOfDay = new Date(appointmentDate);
wrongStartOfDay.setHours(0, 0, 0, 0);
console.log('  Result:', wrongStartOfDay.toISOString());
console.log('  Vietnam:', wrongStartOfDay.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  ❌ WRONG! Nếu server ở UTC, start sẽ là 00:00 UTC = 07:00 Vietnam!');

console.log('\n  CORRECT:');
console.log('  Just use appointmentDate directly (already is midnight Vietnam in UTC)');
const correctStartOfDay = new Date(appointmentDate);
correctStartOfDay.setUTCHours(0, 0, 0, 0); // Keep as midnight UTC (which is already midnight Vietnam + 17 hours)
console.log('  Result:', correctStartOfDay.toISOString());

const correctEndOfDay = new Date(appointmentDate);
correctEndOfDay.setUTCHours(23, 59, 59, 999);
console.log('  End of day:', correctEndOfDay.toISOString());
console.log('  Vietnam:', correctEndOfDay.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

console.log('\n' + '='.repeat(80));
console.log('✅ Test completed');

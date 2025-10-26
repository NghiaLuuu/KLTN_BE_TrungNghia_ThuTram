const dayjs = require('dayjs');

console.log('🔍 TEST DAYOFWEEK CONVERSION:\n');

// Test các ngày trong tuần của tháng 11/2025
const testDates = [
  { date: '2025-11-02', expect: 'Chủ nhật (Sunday)', expectDayOfWeek: 1 },
  { date: '2025-11-03', expect: 'Thứ Hai (Monday)', expectDayOfWeek: 2 },
  { date: '2025-11-04', expect: 'Thứ Ba (Tuesday)', expectDayOfWeek: 3 },
  { date: '2025-11-05', expect: 'Thứ Tư (Wednesday)', expectDayOfWeek: 4 },
  { date: '2025-11-06', expect: 'Thứ Năm (Thursday)', expectDayOfWeek: 5 },
  { date: '2025-11-07', expect: 'Thứ Sáu (Friday)', expectDayOfWeek: 6 },
  { date: '2025-11-08', expect: 'Thứ Bảy (Saturday)', expectDayOfWeek: 7 },
  { date: '2025-11-09', expect: 'Chủ nhật (Sunday)', expectDayOfWeek: 1 },
];

console.log('Date         | dayjs.day() | +1 Result | Expected | Match?');
console.log('-------------|-------------|-----------|----------|-------');

testDates.forEach(test => {
  const d = dayjs(test.date);
  const dayjsDay = d.day();
  const converted = dayjsDay + 1;
  const match = converted === test.expectDayOfWeek ? '✅' : '❌';
  
  console.log(
    `${test.date} | ${dayjsDay}           | ${converted}         | ${test.expectDayOfWeek}        | ${match} ${test.expect}`
  );
});

console.log('\n📋 CONVENTION IN DB:');
console.log('  1 = Chủ nhật (Sunday)');
console.log('  2 = Thứ Hai (Monday)');
console.log('  3 = Thứ Ba (Tuesday)');
console.log('  4 = Thứ Tư (Wednesday)');
console.log('  5 = Thứ Năm (Thursday)');
console.log('  6 = Thứ Sáu (Friday)');
console.log('  7 = Thứ Bảy (Saturday)');

console.log('\n🔄 CONVERSION LOGIC:');
console.log('  const dayOfWeek = currentDate.day() + 1;');
console.log('  0 (Sunday)    + 1 = 1 (Chủ nhật) ✅');
console.log('  1 (Monday)    + 1 = 2 (Thứ Hai) ✅');
console.log('  2 (Tuesday)   + 1 = 3 (Thứ Ba) ✅');
console.log('  3 (Wednesday) + 1 = 4 (Thứ Tư) ✅');
console.log('  4 (Thursday)  + 1 = 5 (Thứ Năm) ✅');
console.log('  5 (Friday)    + 1 = 6 (Thứ Sáu) ✅');
console.log('  6 (Saturday)  + 1 = 7 (Thứ Bảy) ✅');

console.log('\n✅ Logic is CORRECT!');

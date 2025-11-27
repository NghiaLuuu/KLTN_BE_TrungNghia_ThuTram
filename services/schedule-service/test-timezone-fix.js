const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// Test case: Ngày 1/2/2026 là Chủ nhật (dayOfWeek = 1)
console.log('=== Test Timezone Fix ===\n');

// Cách CŨ (BỊ LỖI):
const dayString = '2026-02-01';
const oldWay = new Date(dayString + 'T00:00:00.000Z');
console.log('1. Cách CŨ (BỊ LỖI):');
console.log('   Input:', dayString, '(Chủ nhật)');
console.log('   UTC Date:', oldWay.toISOString());
console.log('   VN Time:', oldWay.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

// Convert về VN để lấy dayOfWeek (cách cũ)
const vnString = oldWay.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' });
const vnDate = new Date(vnString);
const oldDayOfWeek = vnDate.getDay() === 0 ? 1 : vnDate.getDay() + 1;
console.log('   → dayOfWeek (cách cũ):', oldDayOfWeek, oldDayOfWeek === 7 ? '(Thứ 7 - SAI!)' : '(Chủ nhật - đúng)');

console.log('\n2. Cách MỚI (ĐÚNG):');
// Cách MỚI (ĐÚNG):
const currentDayVN = dayjs('2026-02-01').tz('Asia/Ho_Chi_Minh').startOf('day');
const dateToCheck = currentDayVN.toDate();
console.log('   Input:', dayString, '(Chủ nhật)');
console.log('   dayjs VN:', currentDayVN.format('YYYY-MM-DD HH:mm:ss'));
console.log('   Date object:', dateToCheck.toISOString());
console.log('   VN Time:', dateToCheck.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

// Lấy dayOfWeek từ dayjs
const checkDateVN = dayjs(dateToCheck).tz('Asia/Ho_Chi_Minh').startOf('day');
const newDayOfWeek = checkDateVN.day() === 0 ? 1 : checkDateVN.day() + 1;
console.log('   → dayOfWeek (cách mới):', newDayOfWeek, newDayOfWeek === 1 ? '(Chủ nhật - ĐÚNG!)' : '(SAI!)');

console.log('\n3. Test nhiều ngày:');
const testDates = [
  '2026-02-01', // Chủ nhật
  '2026-02-02', // Thứ 2
  '2026-01-31', // Thứ 7
  '2026-02-08', // Chủ nhật
];

testDates.forEach(dateStr => {
  const dVN = dayjs(dateStr).tz('Asia/Ho_Chi_Minh').startOf('day');
  const dow = dVN.day() === 0 ? 1 : dVN.day() + 1;
  const dayName = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][dow - 1];
  console.log(`   ${dateStr}: dayOfWeek=${dow} (${dayName})`);
});

console.log('\n✅ Nếu tất cả Chủ nhật có dayOfWeek=1 → Fix thành công!');

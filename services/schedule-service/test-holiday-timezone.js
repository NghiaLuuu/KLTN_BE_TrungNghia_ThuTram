const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== TEST NGÀY NGHỈ LỄ (Non-Recurring Holiday) - TIMEZONE BUG ===\n');

// Scenario: Ngày nghỉ Tết 2026: 1/2 - 5/2 (5 ngày)
const holiday = {
  name: 'Tết Nguyên Đán 2026',
  startDate: '2026-02-01', // Chủ nhật
  endDate: '2026-02-05'     // Thứ 5
};

console.log('Ngày nghỉ lễ:', holiday.name);
console.log('Thời gian:', holiday.startDate, '-', holiday.endDate);
console.log('');

// Test dates
const testDates = [
  { date: '2026-01-31', desc: '31/1 (Thứ 7) - Trước kỳ nghỉ', expected: false },
  { date: '2026-02-01', desc: '1/2 (Chủ nhật) - Ngày đầu', expected: true },
  { date: '2026-02-03', desc: '3/2 (Thứ 3) - Giữa kỳ nghỉ', expected: true },
  { date: '2026-02-05', desc: '5/2 (Thứ 5) - Ngày cuối', expected: true },
  { date: '2026-02-06', desc: '6/2 (Thứ 6) - Sau kỳ nghỉ', expected: false },
];

console.log('=== CÁCH CŨ (CÓ THỂ BỊ BUG) ===\n');
testDates.forEach(({ date, desc, expected }) => {
  // OLD WAY: getHolidaySnapshot comparison
  const holidayStart = new Date(holiday.startDate);
  const holidayEnd = new Date(holiday.endDate);
  const scheduleStart = new Date(date);
  const scheduleEnd = new Date(date);
  
  const isHoliday_old1 = holidayEnd >= scheduleStart && holidayStart <= scheduleEnd;
  
  // OLD WAY 2: Override holiday check
  const targetDate = new Date(date);
  targetDate.setUTCHours(0, 0, 0, 0);
  const startDate = new Date(holiday.startDate);
  const endDate = new Date(holiday.endDate);
  startDate.setUTCHours(0, 0, 0, 0);
  endDate.setUTCHours(23, 59, 59, 999);
  
  const isHoliday_old2 = targetDate >= startDate && targetDate <= endDate;
  
  // OLD WAY 3: getValidHolidayDates
  const checkDate = new Date(date);
  const start = new Date(holiday.startDate);
  const end = new Date(holiday.endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  
  const isHoliday_old3 = checkDate >= start && checkDate <= end;
  
  const result1 = isHoliday_old1 === expected ? '✅' : '❌';
  const result2 = isHoliday_old2 === expected ? '✅' : '❌';
  const result3 = isHoliday_old3 === expected ? '✅' : '❌';
  
  console.log(`${date} (${desc}):`);
  console.log(`  Method 1 (getHolidaySnapshot): ${isHoliday_old1} ${result1}`);
  console.log(`  Method 2 (overrideHoliday): ${isHoliday_old2} ${result2}`);
  console.log(`  Method 3 (getValidDates): ${isHoliday_old3} ${result3}`);
  console.log(`  Expected: ${expected}\n`);
});

console.log('\n=== CÁCH MỚI (ĐÚNG - DÙNG DAYJS) ===\n');
testDates.forEach(({ date, desc, expected }) => {
  // NEW WAY: Use dayjs for all comparisons
  const checkDateVN = dayjs(date).tz('Asia/Ho_Chi_Minh').startOf('day');
  const checkStr = checkDateVN.format('YYYY-MM-DD');
  
  const startVN = dayjs(holiday.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const endVN = dayjs(holiday.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  
  const isHoliday_new = checkStr >= startVN && checkStr <= endVN;
  
  const result = isHoliday_new === expected ? '✅' : '❌';
  
  console.log(`${date} (${desc}): ${isHoliday_new} ${result} (expected: ${expected})`);
});

console.log('\n=== KẾT LUẬN ===');
console.log('Nếu có ❌ ở cách cũ → Có bug timezone cần fix');
console.log('Nếu tất cả ✅ ở cách mới → Fix đúng bằng dayjs string comparison');

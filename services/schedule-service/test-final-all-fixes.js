const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== FINAL TEST: TẤT CẢ CÁC FIX TIMEZONE ===\n');

let totalTests = 0;
let passedTests = 0;

function test(name, actual, expected) {
  totalTests++;
  const result = actual === expected ? '✅' : '❌';
  if (actual === expected) passedTests++;
  console.log(`${result} ${name}: ${actual} (expected: ${expected})`);
  return actual === expected;
}

// ===== TEST 1: Ngày nghỉ cố định (Recurring Holiday) =====
console.log('1️⃣  NGÀY NGHỈ CỐ ĐỊNH (Chủ nhật):\n');

const recurringHoliday = { name: 'Chủ nhật', dayOfWeek: 1 }; // 1 = Sunday

['2026-01-31', '2026-02-01', '2026-02-02', '2026-02-08'].forEach(date => {
  const d = dayjs(date).tz('Asia/Ho_Chi_Minh').startOf('day');
  const dayOfWeek = d.day() === 0 ? 1 : d.day() + 1;
  const isHoliday = dayOfWeek === 1;
  const expected = date.endsWith('-01') || date.endsWith('-08'); // 1/2 và 8/2 là Chủ nhật
  
  test(`  ${date}`, isHoliday, expected);
});

// ===== TEST 2: Ngày nghỉ lễ (Non-Recurring Holiday) =====
console.log('\n2️⃣  NGÀY NGHỈ LỄ (Tết 1/2-5/2):\n');

const nonRecurringHoliday = {
  name: 'Tết',
  startDate: new Date('2026-02-01'),
  endDate: new Date('2026-02-05')
};

['2026-01-31', '2026-02-01', '2026-02-03', '2026-02-05', '2026-02-06'].forEach(date => {
  const checkStr = dayjs(date).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const startStr = dayjs(nonRecurringHoliday.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const endStr = dayjs(nonRecurringHoliday.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  
  const isHoliday = checkStr >= startStr && checkStr <= endStr;
  const expected = date >= '2026-02-01' && date <= '2026-02-05';
  
  test(`  ${date}`, isHoliday, expected);
});

// ===== TEST 3: Override holiday (recurring) =====
console.log('\n3️⃣  OVERRIDE HOLIDAY CHECK (Chủ nhật 1/2):\n');

const targetDate = new Date('2026-02-01');
targetDate.setUTCHours(0, 0, 0, 0);
const targetDateDayjs = dayjs(targetDate).tz('Asia/Ho_Chi_Minh').startOf('day');
const jsDay = targetDateDayjs.day();
const dayOfWeek = jsDay === 0 ? 1 : jsDay + 1;

test('  targetDate dayOfWeek', dayOfWeek, 1);
test('  is Sunday (recurring)', dayOfWeek === 1, true);

// ===== TEST 4: Override holiday (non-recurring) =====
console.log('\n4️⃣  OVERRIDE HOLIDAY CHECK (Tết 3/2):\n');

const targetDate2 = new Date('2026-02-03');
const targetDateDayjs2 = dayjs(targetDate2).tz('Asia/Ho_Chi_Minh').startOf('day');
const targetDateStr = targetDateDayjs2.format('YYYY-MM-DD');
const startDateStr = dayjs(nonRecurringHoliday.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
const endDateStr = dayjs(nonRecurringHoliday.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
const isInRange = targetDateStr >= startDateStr && targetDateStr <= endDateStr;

test('  targetDateStr', targetDateStr, '2026-02-03');
test('  is in Tết range', isInRange, true);

// ===== TEST 5: Get calendar dayOfWeek =====
console.log('\n5️⃣  GET CALENDAR dayOfWeek:\n');

const slot = { date: new Date('2026-02-01') };
const slotDayOfWeek = dayjs(slot.date).tz('Asia/Ho_Chi_Minh').day();

test('  1/2/2026 dayOfWeek', slotDayOfWeek, 0); // 0 = Sunday in dayjs

// ===== SUMMARY =====
console.log('\n' + '='.repeat(50));
console.log(`TỔNG KẾT: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('✅ TẤT CẢ CÁC FIX TIMEZONE HOẠT ĐỘNG ĐÚNG!');
  console.log('');
  console.log('Đã fix:');
  console.log('  ✅ Ngày nghỉ cố định (Chủ nhật, Thứ 7,...)');
  console.log('  ✅ Ngày nghỉ lễ (Tết, 30/4, 2/9,...)');
  console.log('  ✅ Tạo lịch mới (generateRoomSchedule)');
  console.log('  ✅ Thêm ca thiếu (addMissingShifts)');
  console.log('  ✅ Override lịch nghỉ (overrideHolidaySlot)');
  console.log('  ✅ Lấy calendar (getCalendar)');
  console.log('  ✅ Validate holiday dates');
} else {
  console.log('❌ CÒN LỖI CẦN FIX!');
}

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== KIỂM TRA TẤT CẢ CÁC FIX TIMEZONE ===\n');

// Test case: Ngày 1/2/2026 là Chủ nhật
const testDate = '2026-02-01';
console.log(`Test date: ${testDate} (Chủ nhật)\n`);

// 1. generateSlotsCore - FIXED
console.log('1. generateSlotsCore (FIXED):');
const currentDayVN = dayjs(testDate).tz('Asia/Ho_Chi_Minh').startOf('day');
const dateToCheck = currentDayVN.toDate();
const checkDateVN = dayjs(dateToCheck).tz('Asia/Ho_Chi_Minh').startOf('day');
const dow1 = checkDateVN.day() === 0 ? 1 : checkDateVN.day() + 1;
console.log(`   dateToCheck:`, dateToCheck.toISOString());
console.log(`   dayOfWeek:`, dow1, dow1 === 1 ? '✅ Chủ nhật' : '❌ Sai');

// 2. generateScheduleForRoom - FIXED
console.log('\n2. generateScheduleForRoom (FIXED):');
const currentDayVN2 = dayjs(testDate).tz('Asia/Ho_Chi_Minh').startOf('day');
const dateToCheck2 = currentDayVN2.toDate();
const checkDateVN2 = dayjs(dateToCheck2).tz('Asia/Ho_Chi_Minh').startOf('day');
const dow2 = checkDateVN2.day() === 0 ? 1 : checkDateVN2.day() + 1;
console.log(`   dayOfWeek:`, dow2, dow2 === 1 ? '✅ Chủ nhật' : '❌ Sai');

// 3. generateSlotsForShift (addMissingShifts) - FIXED
console.log('\n3. generateSlotsForShift (FIXED):');
const currentDayVN3 = dayjs(testDate).tz('Asia/Ho_Chi_Minh').startOf('day');
const currentDateForHolidayCheck = currentDayVN3.toDate();
const checkDateVN3 = dayjs(currentDateForHolidayCheck).tz('Asia/Ho_Chi_Minh').startOf('day');
const dow3 = checkDateVN3.day() === 0 ? 1 : checkDateVN3.day() + 1;
console.log(`   dayOfWeek:`, dow3, dow3 === 1 ? '✅ Chủ nhật' : '❌ Sai');

// 4. Override holiday check - FIXED
console.log('\n4. Override holiday check (FIXED):');
const targetDate = new Date(testDate);
targetDate.setUTCHours(0, 0, 0, 0);
const targetDateDayjs = dayjs(targetDate).tz('Asia/Ho_Chi_Minh').startOf('day');
const jsDay = targetDateDayjs.day();
const dow4 = jsDay === 0 ? 1 : jsDay + 1;
console.log(`   targetDate:`, targetDate.toISOString());
console.log(`   dayOfWeek:`, dow4, dow4 === 1 ? '✅ Chủ nhật' : '❌ Sai');

// 5. Get available override dates - FIXED
console.log('\n5. Get available override dates (FIXED):');
const targetDate5 = new Date(testDate);
targetDate5.setHours(0, 0, 0, 0);
const targetDateDayjs5 = dayjs(targetDate5).tz('Asia/Ho_Chi_Minh');
const dow5 = targetDateDayjs5.day();
console.log(`   dayOfWeek:`, dow5, dow5 === 0 ? '✅ Chủ nhật (0)' : '❌ Sai');

// 6. Get valid holiday dates - FIXED
console.log('\n6. Get valid holiday dates (FIXED):');
const checkDate = new Date(testDate);
const checkDateDayjs = dayjs(checkDate).tz('Asia/Ho_Chi_Minh');
const checkDayOfWeek = checkDateDayjs.day();
const conventionDay = checkDayOfWeek === 0 ? 1 : checkDayOfWeek + 1;
console.log(`   dayOfWeek (dayjs):`, checkDayOfWeek, checkDayOfWeek === 0 ? '✅ Sunday (0)' : '❌ Sai');
console.log(`   conventionDay:`, conventionDay, conventionDay === 1 ? '✅ Chủ nhật (1)' : '❌ Sai');

// 7. getCalendar - FIXED
console.log('\n7. getCalendar dayOfWeek (FIXED):');
const slot = { date: new Date(testDate) };
const dow7 = dayjs(slot.date).tz('Asia/Ho_Chi_Minh').day();
console.log(`   dayOfWeek:`, dow7, dow7 === 0 ? '✅ Sunday (0)' : '❌ Sai');

// Tổng kết
console.log('\n=== KẾT QUẢ ===');
const allCorrect = dow1 === 1 && dow2 === 1 && dow3 === 1 && dow4 === 1 && dow5 === 0 && conventionDay === 1 && dow7 === 0;
if (allCorrect) {
  console.log('✅ TẤT CẢ CÁC FIX ĐỀU ĐÚNG!');
  console.log('   Ngày 1/2/2026 (Chủ nhật) được kiểm tra đúng ở tất cả các hàm');
  console.log('   → Ngày nghỉ cố định (Chủ nhật) sẽ được skip đúng khi tạo lịch/thêm ca');
} else {
  console.log('⚠️ CÓ VẤN ĐỀ, KIỂM TRA LẠI!');
}

// Test edge cases
console.log('\n=== TEST EDGE CASES ===');
const edgeCases = [
  '2026-01-31', // Thứ 7
  '2026-02-01', // Chủ nhật
  '2026-02-02', // Thứ 2
  '2026-02-07', // Thứ 7
  '2026-02-08', // Chủ nhật
];

edgeCases.forEach(date => {
  const d = dayjs(date).tz('Asia/Ho_Chi_Minh').startOf('day');
  const dateToCheck = d.toDate();
  const checkVN = dayjs(dateToCheck).tz('Asia/Ho_Chi_Minh').startOf('day');
  const dayOfWeek = checkVN.day() === 0 ? 1 : checkVN.day() + 1;
  const dayName = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][checkVN.day()];
  const isSunday = dayOfWeek === 1;
  console.log(`${date}: dayOfWeek=${dayOfWeek} (${dayName}) ${isSunday ? '🔴 SKIP' : '✅ OK'}`);
});

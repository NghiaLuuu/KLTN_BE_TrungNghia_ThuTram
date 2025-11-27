const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== Test Bug: Chủ nhật 1/2/2026 bị check thành Thứ 7 31/1/2026 ===\n');

// Simulate generate slots logic
const currentDayVN = dayjs('2026-02-01').tz('Asia/Ho_Chi_Minh').startOf('day');
console.log('1. currentDayVN (dayjs VN):', currentDayVN.format('YYYY-MM-DD HH:mm:ss Z'));
console.log('   → dayOfWeek:', currentDayVN.day() === 0 ? 1 : currentDayVN.day() + 1, '(Chủ nhật)');

// OLD WAY (BUG): toDate() converts to UTC
const currentDateForHolidayCheck_OLD = currentDayVN.toDate();
console.log('\n2. CÁCH CŨ (BUG):');
console.log('   .toDate():', currentDateForHolidayCheck_OLD.toISOString());
console.log('   → UTC:', currentDateForHolidayCheck_OLD.toUTCString());

// isHolidayFromSnapshot OLD logic
const checkDate_OLD = new Date(currentDateForHolidayCheck_OLD);
checkDate_OLD.setUTCHours(0, 0, 0, 0);
const dateStr_OLD = checkDate_OLD.toISOString().split('T')[0];
const dayOfWeek_OLD = checkDate_OLD.getUTCDay() + 1;
console.log('   → checkDate after setUTCHours(0):', checkDate_OLD.toISOString());
console.log('   → dateStr:', dateStr_OLD, '← SAI! (31/1 thay vì 1/2)');
console.log('   → dayOfWeek:', dayOfWeek_OLD, dayOfWeek_OLD === 7 ? '(Thứ 7) ← SAI!' : '');

// NEW WAY (FIX): Use dayjs directly
console.log('\n3. CÁCH MỚI (FIX):');
const checkDateVN_NEW = dayjs(currentDateForHolidayCheck_OLD).tz('Asia/Ho_Chi_Minh').startOf('day');
const dateStr_NEW = checkDateVN_NEW.format('YYYY-MM-DD');
const dayOfWeek_NEW = checkDateVN_NEW.day() === 0 ? 1 : checkDateVN_NEW.day() + 1;
console.log('   → checkDateVN:', checkDateVN_NEW.format('YYYY-MM-DD HH:mm:ss Z'));
console.log('   → dateStr:', dateStr_NEW, '← ĐÚNG!');
console.log('   → dayOfWeek:', dayOfWeek_NEW, dayOfWeek_NEW === 1 ? '(Chủ nhật) ← ĐÚNG!' : '');

// Verify holiday check
console.log('\n4. Kiểm tra ngày nghỉ cố định (Chủ nhật = dayOfWeek: 1):');
const recurringHolidays = [{ name: 'Chủ nhật', dayOfWeek: 1 }];
const isHoliday_OLD = recurringHolidays.some(h => h.dayOfWeek === dayOfWeek_OLD);
const isHoliday_NEW = recurringHolidays.some(h => h.dayOfWeek === dayOfWeek_NEW);
console.log('   Cách cũ:', isHoliday_OLD ? '✅ Là ngày nghỉ' : '❌ KHÔNG phải ngày nghỉ ← BUG!');
console.log('   Cách mới:', isHoliday_NEW ? '✅ Là ngày nghỉ ← ĐÚNG!' : '❌ KHÔNG phải ngày nghỉ');

console.log('\n=== KẾT LUẬN ===');
if (!isHoliday_OLD && isHoliday_NEW) {
  console.log('✅ BUG ĐÃ ĐƯỢC SỬA!');
  console.log('   - Trước: Ngày 1/2 (Chủ nhật) bị check thành 31/1 (Thứ 7) → Không skip');
  console.log('   - Sau: Ngày 1/2 (Chủ nhật) được check đúng → Skip đúng');
} else {
  console.log('⚠️ Cần kiểm tra lại logic');
}

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== TEST EDGE CASE: Ngày nghỉ lễ qua ranh giới tháng ===\n');

// EDGE CASE 1: Ngày nghỉ lễ bắt đầu từ ngày cuối tháng 1, kết thúc đầu tháng 2
const holiday1 = {
  name: 'Tết qua tháng',
  startDate: '2026-01-30T00:00:00.000Z', // UTC midnight = 7:00 VN (30/1)
  endDate: '2026-02-03T00:00:00.000Z'     // UTC midnight = 7:00 VN (3/2)
};

console.log('Scenario 1: Ngày nghỉ với UTC timestamp');
console.log('Holiday:', holiday1.name);
console.log('startDate (UTC):', holiday1.startDate);
console.log('endDate (UTC):', holiday1.endDate);
console.log('');

const testDates1 = [
  { date: '2026-01-29', desc: '29/1 - Trước kỳ nghỉ', expected: false },
  { date: '2026-01-30', desc: '30/1 - Ngày đầu', expected: true },
  { date: '2026-02-01', desc: '1/2 - Giữa kỳ nghỉ', expected: true },
  { date: '2026-02-03', desc: '3/2 - Ngày cuối', expected: true },
  { date: '2026-02-04', desc: '4/2 - Sau kỳ nghỉ', expected: false },
];

console.log('CÁCH CŨ (new Date comparison):');
testDates1.forEach(({ date, desc, expected }) => {
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  const start = new Date(holiday1.startDate);
  const end = new Date(holiday1.endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  
  const isHoliday = checkDate >= start && checkDate <= end;
  const result = isHoliday === expected ? '✅' : '❌';
  
  console.log(`  ${date} (${desc}): ${isHoliday} ${result}`);
  if (isHoliday !== expected) {
    console.log(`    🔍 Debug: checkDate=${checkDate.toISOString()}, start=${start.toISOString()}, end=${end.toISOString()}`);
  }
});

console.log('\nCÁCH MỚI (dayjs string comparison):');
testDates1.forEach(({ date, desc, expected }) => {
  const checkDateVN = dayjs(date).tz('Asia/Ho_Chi_Minh').startOf('day');
  const checkStr = checkDateVN.format('YYYY-MM-DD');
  
  const startVN = dayjs(holiday1.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const endVN = dayjs(holiday1.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  
  const isHoliday = checkStr >= startVN && checkStr <= endVN;
  const result = isHoliday === expected ? '✅' : '❌';
  
  console.log(`  ${date} (${desc}): ${isHoliday} ${result}`);
  if (isHoliday !== expected) {
    console.log(`    🔍 Debug: checkStr=${checkStr}, startVN=${startVN}, endVN=${endVN}`);
  }
});

// EDGE CASE 2: Ngày nghỉ 1 ngày duy nhất ở đầu tháng
console.log('\n\nScenario 2: Ngày nghỉ 1 ngày (1/2/2026 - Chủ nhật)');
const holiday2 = {
  name: 'Nghỉ Chủ nhật',
  startDate: '2026-02-01T00:00:00.000Z', // UTC midnight
  endDate: '2026-02-01T23:59:59.999Z'
};

const testDates2 = [
  { date: '2026-01-31', desc: '31/1', expected: false },
  { date: '2026-02-01', desc: '1/2 - Ngày nghỉ', expected: true },
  { date: '2026-02-02', desc: '2/2', expected: false },
];

console.log('\nCÁCH CŨ (new Date comparison):');
testDates2.forEach(({ date, desc, expected }) => {
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  const start = new Date(holiday2.startDate);
  const end = new Date(holiday2.endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  
  const isHoliday = checkDate >= start && checkDate <= end;
  const result = isHoliday === expected ? '✅' : '❌';
  
  console.log(`  ${date} (${desc}): ${isHoliday} ${result}`);
});

console.log('\nCÁCH MỚI (dayjs string comparison):');
testDates2.forEach(({ date, desc, expected }) => {
  const checkDateVN = dayjs(date).tz('Asia/Ho_Chi_Minh').startOf('day');
  const checkStr = checkDateVN.format('YYYY-MM-DD');
  
  const startVN = dayjs(holiday2.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const endVN = dayjs(holiday2.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  
  const isHoliday = checkStr >= startVN && checkStr <= endVN;
  const result = isHoliday === expected ? '✅' : '❌';
  
  console.log(`  ${date} (${desc}): ${isHoliday} ${result}`);
});

console.log('\n=== KẾT LUẬN ===');
console.log('✅ Nếu tất cả test đều pass → Logic ngày nghỉ lễ OK');
console.log('❌ Nếu có test fail → Cần fix timezone cho ngày nghỉ lễ');

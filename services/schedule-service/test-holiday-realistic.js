const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== TEST REALISTIC: Ngày nghỉ lễ được lưu từ Frontend ===\n');

// REALISTIC SCENARIO: Frontend tạo ngày nghỉ 1/2/2026 đến 5/2/2026
// Frontend sẽ gửi: { startDate: '2026-02-01', endDate: '2026-02-05' }
// Backend sẽ parse thành Date và lưu vào MongoDB

console.log('Scenario: Tạo ngày nghỉ Tết từ 1/2 đến 5/2/2026');
console.log('Frontend gửi: startDate="2026-02-01", endDate="2026-02-05"\n');

// Simulate backend parsing
const holiday = {
  name: 'Tết Nguyên Đán 2026',
  startDate: new Date('2026-02-01'), // Backend parse string thành Date
  endDate: new Date('2026-02-05')
};

console.log('MongoDB lưu:');
console.log('  startDate:', holiday.startDate.toISOString());
console.log('  endDate:', holiday.endDate.toISOString());
console.log('');

// Test dates
const testDates = [
  { date: '2026-01-31', expected: false },
  { date: '2026-02-01', expected: true },
  { date: '2026-02-03', expected: true },
  { date: '2026-02-05', expected: true },
  { date: '2026-02-06', expected: false },
];

console.log('CÁCH MỚI (dayjs string comparison - AFTER FIX):');
testDates.forEach(({ date, expected }) => {
  const checkDateVN = dayjs(date).tz('Asia/Ho_Chi_Minh').startOf('day');
  const checkStr = checkDateVN.format('YYYY-MM-DD');
  
  const startVN = dayjs(holiday.startDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  const endVN = dayjs(holiday.endDate).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
  
  const isHoliday = checkStr >= startVN && checkStr <= endVN;
  const result = isHoliday === expected ? '✅' : '❌';
  
  console.log(`  ${date}: ${isHoliday} ${result} (expected: ${expected})`);
  if (isHoliday !== expected) {
    console.log(`    🔍 checkStr=${checkStr}, startVN=${startVN}, endVN=${endVN}`);
  }
});

console.log('\n=== KẾT LUẬN ===');
console.log('✅ Với cách parse realistic từ string "YYYY-MM-DD", logic hoạt động đúng');
console.log('⚠️  Lưu ý: Backend cần parse date string đúng cách khi tạo holiday');

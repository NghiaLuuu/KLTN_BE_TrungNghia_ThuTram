const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

console.log('=== DEBUG UTC MIDNIGHT ISSUE ===\n');

const endDateUTC = '2026-02-01T23:59:59.999Z';

console.log('Input endDate (UTC):', endDateUTC);
console.log('');

// Method 1: Just tz and format
const method1 = dayjs(endDateUTC).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD');
console.log('Method 1: .tz().format()');
console.log('  Result:', method1);
console.log('  Full datetime:', dayjs(endDateUTC).tz('Asia/Ho_Chi_Minh').format('YYYY-MM-DD HH:mm:ss'));
console.log('');

// Method 2: tz then startOf('day')
const method2 = dayjs(endDateUTC).tz('Asia/Ho_Chi_Minh').startOf('day').format('YYYY-MM-DD');
console.log('Method 2: .tz().startOf("day").format()');
console.log('  Result:', method2);
console.log('  Full datetime:', dayjs(endDateUTC).tz('Asia/Ho_Chi_Minh').startOf('day').format('YYYY-MM-DD HH:mm:ss'));
console.log('');

// Method 3: Parse as UTC, format to date string, then parse again
const method3 = dayjs.utc(endDateUTC).format('YYYY-MM-DD');
console.log('Method 3: dayjs.utc().format()');
console.log('  Result:', method3);
console.log('');

// CORRECT METHOD: Lấy date component từ UTC
const utcDate = dayjs.utc(endDateUTC);
const correctMethod = utcDate.format('YYYY-MM-DD');
console.log('CORRECT: Get date from UTC directly');
console.log('  Result:', correctMethod);
console.log('  UTC date:', utcDate.format('YYYY-MM-DD HH:mm:ss'));
console.log('');

console.log('=== KẾT LUẬN ===');
console.log('Vấn đề: "2026-02-01T23:59:59.999Z" trong UTC');
console.log('  - Convert sang VN timezone → 2026-02-02 06:59:59');
console.log('  - Format thành YYYY-MM-DD → "2026-02-02" (SAI!)');
console.log('');
console.log('Giải pháp: Dùng dayjs.utc().format() thay vì .tz().format()');
console.log('  → Lấy date component từ UTC timestamp');
console.log('  → "2026-02-01T23:59:59.999Z" → "2026-02-01" (ĐÚNG!)');

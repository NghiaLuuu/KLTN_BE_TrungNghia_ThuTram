/**
 * Test để hiểu rõ cron đang lấy thời gian như thế nào
 */

console.log('\n🕐 PHÂN TÍCH TIMEZONE TRONG CRON');
console.log('='.repeat(80));

// 1️⃣ Cron lấy thời gian hiện tại
const now = new Date();
console.log('\n1️⃣ THỜI GIAN HIỆN TẠI (const now = new Date()):');
console.log('  now.toISOString():', now.toISOString());
console.log('  now.toString():', now.toString());
console.log('  now.getTime():', now.getTime());
console.log('  → Đây là thời gian UTC (Universal Time)');
console.log('  → Giống nhau trên mọi server, bất kể timezone');

// 2️⃣ appointmentDate trong database
const appointmentDate = new Date('2025-12-02T17:00:00.000Z');
console.log('\n2️⃣ APPOINTMENT DATE TỪ DATABASE:');
console.log('  DB value: "2025-12-02T17:00:00.000Z"');
console.log('  appointmentDate.toISOString():', appointmentDate.toISOString());
console.log('  appointmentDate.getTime():', appointmentDate.getTime());
console.log('  → Đây CŨNG là UTC (MongoDB lưu Date dưới dạng UTC timestamp)');
console.log('  → 2025-12-02T17:00:00.000Z = 00:00 ngày 03/12/2025 giờ Việt Nam');

// 3️⃣ So sánh appointmentDate với now
console.log('\n3️⃣ SO SÁNH: appointmentDate { $lte: now }');
console.log('  Query: { appointmentDate: { $lte: now } }');
console.log(`  appointmentDate (${appointmentDate.getTime()}) <= now (${now.getTime()})?`);
console.log(`  ${appointmentDate.toISOString()} <= ${now.toISOString()}?`);
console.log(`  Result: ${appointmentDate <= now ? '✅ TRUE' : '❌ FALSE'}`);
console.log('  → So sánh 2 UTC timestamp với nhau ✅');

// 4️⃣ Vấn đề: startTime là string "08:00" (giờ Việt Nam)
console.log('\n4️⃣ VẤN ĐỀ: startTime/endTime là giờ Việt Nam (string):');
console.log('  startTime: "08:00" ← Đây là giờ Việt Nam, KHÔNG phải UTC!');
console.log('  endTime: "09:00" ← Đây là giờ Việt Nam, KHÔNG phải UTC!');

// 5️⃣ Cách tính ĐÚNG
console.log('\n5️⃣ CÁCH TÍNH ĐÚNG:');
console.log('  appointmentDate = 2025-12-02T17:00:00.000Z (UTC)');
console.log('                  = 00:00 ngày 03/12 (Vietnam)');
console.log('  startTime = "08:00" (Vietnam)');
console.log('  ');
console.log('  Cần tính: 08:00 ngày 03/12 Vietnam = ? UTC');
console.log('  ');
console.log('  Cách 1 (SAI - dùng setHours):');
console.log('    const start = new Date(appointmentDate);');
console.log('    start.setHours(8, 0, 0, 0);');
console.log('    → Nếu server timezone = UTC: start = 2025-12-02T08:00:00.000Z');
console.log('    → Nếu server timezone = UTC+7: start = 2025-12-03T01:00:00.000Z');
console.log('    → KẾT QUẢ KHÁC NHAU tùy server timezone! ❌');

const wrongStart = new Date(appointmentDate);
wrongStart.setHours(8, 0, 0, 0);
console.log('    Thực tế trên máy bạn:', wrongStart.toISOString());

console.log('  ');
console.log('  Cách 2 (ĐÚNG - dùng setUTCHours + offset):');
console.log('    const start = new Date(appointmentDate);');
console.log('    start.setUTCHours(start.getUTCHours() + 8, 0, 0, 0);');
console.log('    → appointmentDate.getUTCHours() = 17');
console.log('    → 17 + 8 = 25 → tràn sang ngày sau → 01:00 UTC');
console.log('    → start = 2025-12-03T01:00:00.000Z');
console.log('    → LUÔN ĐÚNG bất kể server timezone nào! ✅');

const correctStart = new Date(appointmentDate);
correctStart.setUTCHours(correctStart.getUTCHours() + 8, 0, 0, 0);
console.log('    Kết quả:', correctStart.toISOString());

// 6️⃣ Verify
console.log('\n6️⃣ VERIFY:');
console.log('  2025-12-03T01:00:00.000Z = 08:00 ngày 03/12 Vietnam?');
console.log('  Check:', correctStart.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  ✅ ĐÚNG!');

// 7️⃣ Kết luận
console.log('\n7️⃣ KẾT LUẬN:');
console.log('='.repeat(80));
console.log('  ✅ now = new Date() → UTC timestamp (đồng bộ trên mọi server)');
console.log('  ✅ appointmentDate từ DB → UTC timestamp');
console.log('  ✅ So sánh appointmentDate <= now → So sánh 2 UTC timestamp (đúng)');
console.log('  ❌ startTime/endTime là STRING giờ Vietnam (không phải UTC!)');
console.log('  ✅ FIX: setUTCHours(getUTCHours() + hours) để chuyển giờ VN → UTC');
console.log('  ');
console.log('  WHY IT WORKS:');
console.log('    - appointmentDate đã là "midnight Vietnam" stored as UTC');
console.log('    - Cộng thêm số giờ (8h, 9h...) vào UTC hours');
console.log('    - Kết quả: thời gian chính xác theo UTC, bất kể server timezone');
console.log('\n' + '='.repeat(80));

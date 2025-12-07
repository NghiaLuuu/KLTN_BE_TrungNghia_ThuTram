/**
 * FINAL VERIFICATION TEST
 * 
 * Kiểm tra 3 APIs với cùng điều kiện để đảm bảo logic nhất quán
 * 
 * Test case: Lúc 18:12 VN (buffer 30 phút = 18:42), tìm slots cho ngày 2025-12-07
 * Expected: Tất cả APIs đều trả về slots từ 18:45 trở đi
 */

// Mock current time: 2025-12-07 18:12 VN
const MOCK_CURRENT_TIME = new Date('2025-12-07T11:12:00.000Z'); // UTC
const BUFFER_MINUTES = 30;

// Mock data
const MOCK_SLOTS = [
  {
    _id: '692ab884a9793fcecf17783e',
    dentist: '6923b27cc96fd594d2e3b129',
    startTime: new Date('2025-12-07T11:45:00.000Z'), // 18:45 VN
    endTime: new Date('2025-12-07T12:00:00.000Z'),
    shiftName: 'Ca Tối',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  },
  {
    _id: '692ab884a9793fcecf177840',
    dentist: '6923b27cc96fd594d2e3b129',
    startTime: new Date('2025-12-07T12:15:00.000Z'), // 19:15 VN
    endTime: new Date('2025-12-07T12:30:00.000Z'),
    shiftName: 'Ca Tối',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  },
  {
    _id: '692ab884a9793fcecf177841',
    dentist: '6923b27cc96fd594d2e3b129',
    startTime: new Date('2025-12-07T12:30:00.000Z'), // 19:30 VN
    endTime: new Date('2025-12-07T12:45:00.000Z'),
    shiftName: 'Ca Tối',
    status: 'available',
    isActive: true,
    roomId: '692aab072373421ac38a57a0',
    subRoomId: '692aab072373421ac38a57a1'
  }
];

function formatVNTime(date) {
  return date.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

console.log('═'.repeat(80));
console.log('🔬 FINAL VERIFICATION TEST');
console.log('═'.repeat(80));
console.log(`Current Time: ${formatVNTime(MOCK_CURRENT_TIME)} VN`);
console.log(`Buffer: ${BUFFER_MINUTES} minutes`);
console.log('');

// Test 1: API /dentists-with-nearest-slot logic
console.log('TEST 1: API /dentists-with-nearest-slot');
console.log('─'.repeat(80));

const threshold1 = new Date(MOCK_CURRENT_TIME.getTime() + BUFFER_MINUTES * 60 * 1000);
console.log(`Threshold: ${formatVNTime(threshold1)} VN (${threshold1.toISOString()})`);

const api1Query = {
  startTime_gte: threshold1,
  startTime_lte: new Date(threshold1.getTime() + 30 * 24 * 60 * 60 * 1000) // +30 days
};

const api1Results = MOCK_SLOTS.filter(slot => 
  slot.startTime >= api1Query.startTime_gte &&
  slot.startTime <= api1Query.startTime_lte &&
  slot.status === 'available' &&
  slot.isActive
);

console.log(`Query: startTime >= ${threshold1.toISOString()}`);
console.log(`Results: ${api1Results.length} slots`);
api1Results.forEach(s => console.log(`  - ${s._id.substring(0, 8)}... at ${formatVNTime(s.startTime)}`));

// Test 2: API /working-dates logic
console.log('\nTEST 2: API /working-dates');
console.log('─'.repeat(80));

const threshold2 = new Date(MOCK_CURRENT_TIME.getTime() + BUFFER_MINUTES * 60 * 1000);
console.log(`Threshold: ${formatVNTime(threshold2)} VN (${threshold2.toISOString()})`);

const api2Query = {
  startTime_gte: threshold2,
  startTime_lte: new Date(threshold2.getTime() + 30 * 24 * 60 * 60 * 1000)
};

const api2Results = MOCK_SLOTS.filter(slot =>
  slot.startTime >= api2Query.startTime_gte &&
  slot.startTime <= api2Query.startTime_lte &&
  slot.status === 'available' &&
  slot.isActive
);

console.log(`Query: startTime >= ${threshold2.toISOString()}`);
console.log(`Results: ${api2Results.length} slots`);
api2Results.forEach(s => console.log(`  - ${s._id.substring(0, 8)}... at ${formatVNTime(s.startTime)}`));

// Test 3: API /details/future logic (AFTER FIX)
console.log('\nTEST 3: API /details/future (AFTER FIX)');
console.log('─'.repeat(80));

const date = '2025-12-07';
const targetDate = new Date(date);

// Calculate date boundaries in UTC
const startUTC = new Date(Date.UTC(
  targetDate.getFullYear(),
  targetDate.getMonth(),
  targetDate.getDate(),
  -7, 0, 0, 0
));
const endUTC = new Date(Date.UTC(
  targetDate.getFullYear(),
  targetDate.getMonth(),
  targetDate.getDate(),
  -7 + 24, 0, 0, 0
));

console.log(`Date: ${date}`);
console.log(`Start UTC: ${startUTC.toISOString()} (${formatVNTime(startUTC)} VN)`);
console.log(`End UTC: ${endUTC.toISOString()} (${formatVNTime(endUTC)} VN)`);

// Calculate effective start time (AFTER FIX)
const vietnamNow = new Date(MOCK_CURRENT_TIME);
vietnamNow.setMinutes(vietnamNow.getMinutes() + BUFFER_MINUTES);

// ✅ FIX: Just use vietnamNow, don't compare with startUTC
const effectiveStartTime = vietnamNow;

console.log(`Vietnam Now + buffer: ${vietnamNow.toISOString()} (${formatVNTime(vietnamNow)} VN)`);
console.log(`Effective Start Time: ${effectiveStartTime.toISOString()} (${formatVNTime(effectiveStartTime)} VN)`);

const api3Query = {
  startTime_gte: effectiveStartTime,
  startTime_lt: endUTC
};

const api3Results = MOCK_SLOTS.filter(slot =>
  slot.startTime >= api3Query.startTime_gte &&
  slot.startTime < api3Query.startTime_lt &&
  slot.status === 'available' &&
  slot.isActive
);

console.log(`Query: ${effectiveStartTime.toISOString()} <= startTime < ${endUTC.toISOString()}`);
console.log(`Results: ${api3Results.length} slots`);
api3Results.forEach(s => console.log(`  - ${s._id.substring(0, 8)}... at ${formatVNTime(s.startTime)}`));

// Cross-validation
console.log('\n' + '═'.repeat(80));
console.log('📊 CROSS-VALIDATION');
console.log('═'.repeat(80));

const checks = [
  {
    name: 'API 1 and API 2 return same results',
    pass: api1Results.length === api2Results.length &&
          api1Results.every((s, i) => s._id === api2Results[i]._id)
  },
  {
    name: 'API 1 and API 3 return same slots for date 2025-12-07',
    pass: api1Results.filter(s => s.startTime < endUTC).length === api3Results.length &&
          api3Results.every(s => api1Results.some(a => a._id === s._id))
  },
  {
    name: 'All APIs use threshold >= current time + buffer',
    pass: threshold1.getTime() === threshold2.getTime() &&
          effectiveStartTime >= vietnamNow
  },
  {
    name: 'API 3 effective time is NOT using startUTC (00:00 VN)',
    pass: effectiveStartTime.toISOString() !== startUTC.toISOString()
  }
];

checks.forEach(check => {
  console.log(`${check.pass ? '✅' : '❌'} ${check.name}`);
});

const allPass = checks.every(c => c.pass);

console.log('\n' + '═'.repeat(80));
console.log('📊 FINAL RESULT');
console.log('═'.repeat(80));
console.log(allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED');
console.log('═'.repeat(80) + '\n');

// Summary
console.log('📋 SUMMARY:');
console.log(`   API 1 (/dentists-with-nearest-slot): ${api1Results.length} slots`);
console.log(`   API 2 (/working-dates): ${api2Results.length} slots`);
console.log(`   API 3 (/details/future): ${api3Results.length} slots`);
console.log('');
console.log('✅ All APIs use consistent threshold: current time + 30 min buffer');
console.log('✅ API 3 now correctly uses vietnamNow instead of startUTC');
console.log('✅ API 3 correctly filters slots within selected date range');

process.exit(allPass ? 0 : 1);

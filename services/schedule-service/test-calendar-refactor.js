/**
 * Test Script for Refactored Calendar APIs and New Slot Detail APIs
 * 
 * Kiểm tra:
 * 1. Calendar APIs với limit=1 cho week/month
 * 2. Calendar APIs không còn trả về slot details
 * 3. New slot detail APIs hoạt động đúng
 */

const BASE_URL = 'http://localhost:3005/api/slots';

// Test data
const TEST_ROOM_ID = 'replace-with-real-room-id';
const TEST_ROOM_WITH_SUBROOMS = 'replace-with-room-has-subrooms-id';
const TEST_SUBROOM_ID = 'replace-with-subroom-id';
const TEST_ROOM_NO_SUBROOMS = 'replace-with-room-no-subrooms-id';
const TEST_DENTIST_ID = 'replace-with-real-dentist-id';
const TEST_NURSE_ID = 'replace-with-real-nurse-id';
const TEST_DATE = '2025-10-06';

console.log('========================================');
console.log('Calendar API Refactor - Test Script');
console.log('========================================\n');

// Test 1: Room Calendar - Week View (limit should be auto = 1)
console.log('TEST 1: Room Calendar - Week View (limit auto = 1)');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_ID}/calendar?viewType=week&limit=10`);
console.log('Expected: limit ignored, only 1 week returned, no slots array in shifts\n');

// Test 2: Room Calendar - Month View (limit should be auto = 1)
console.log('TEST 2: Room Calendar - Month View (limit auto = 1)');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_ID}/calendar?viewType=month&limit=5`);
console.log('Expected: limit ignored, only 1 month returned, no slots array in shifts\n');

// Test 3: Room Calendar - Day View (limit can be > 1)
console.log('TEST 3: Room Calendar - Day View (limit can be > 1)');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_ID}/calendar?viewType=day&limit=7`);
console.log('Expected: 7 days returned, no slots array in shifts\n');

// Test 4: Dentist Calendar - Week View
console.log('TEST 4: Dentist Calendar - Week View');
console.log(`GET ${BASE_URL}/dentist/${TEST_DENTIST_ID}/calendar?viewType=week`);
console.log('Expected: 1 week returned, no slots array in shifts\n');

// Test 5: Nurse Calendar - Month View
console.log('TEST 5: Nurse Calendar - Month View');
console.log(`GET ${BASE_URL}/nurse/${TEST_NURSE_ID}/calendar?viewType=month`);
console.log('Expected: 1 month returned, no slots array in shifts\n');

console.log('========================================');
console.log('New Slot Detail APIs');
console.log('========================================\n');

// Test 6: Room Slot Details - WITH subRoomId (room has subrooms)
console.log('TEST 6: Room Slot Details - Room WITH subrooms');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_WITH_SUBROOMS}/details?date=${TEST_DATE}&shiftName=Ca Sáng&subRoomId=${TEST_SUBROOM_ID}`);
console.log('Expected: Array of slots with full details (dentist, nurse, times, etc.)\n');

// Test 7: Room Slot Details - WITHOUT subRoomId (room has NO subrooms)
console.log('TEST 7: Room Slot Details - Room WITHOUT subrooms');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_NO_SUBROOMS}/details?date=${TEST_DATE}&shiftName=Ca Sáng`);
console.log('Expected: Array of slots with full details (dentist, nurse, times, etc.)\n');

// Test 8: Dentist Slot Details
console.log('TEST 8: Dentist Slot Details');
console.log(`GET ${BASE_URL}/dentist/${TEST_DENTIST_ID}/details?date=${TEST_DATE}&shiftName=Ca Chiều`);
console.log('Expected: Array of slots with room, nurse, times, etc.\n');

// Test 9: Nurse Slot Details
console.log('TEST 9: Nurse Slot Details');
console.log(`GET ${BASE_URL}/nurse/${TEST_NURSE_ID}/details?date=${TEST_DATE}&shiftName=Ca Tối`);
console.log('Expected: Array of slots with room, dentist, times, etc.\n');

console.log('========================================');
console.log('Validation Tests');
console.log('========================================\n');

// Test 10: Room Slot Details - Missing subRoomId for room WITH subrooms
console.log('TEST 10: Room Slot Details - Missing subRoomId (room has subrooms)');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_WITH_SUBROOMS}/details?date=${TEST_DATE}&shiftName=Ca Sáng`);
console.log('Expected: 400 error - "Phòng có buồng con phải cung cấp subRoomId"\n');

// Test 11: Room Slot Details - Providing subRoomId for room WITHOUT subrooms
console.log('TEST 11: Room Slot Details - Providing subRoomId (room has NO subrooms)');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_NO_SUBROOMS}/details?date=${TEST_DATE}&shiftName=Ca Sáng&subRoomId=${TEST_SUBROOM_ID}`);
console.log('Expected: 400 error - "Phòng không có buồng con không được cung cấp subRoomId"\n');

// Test 12: Room Slot Details - Invalid subRoomId
console.log('TEST 12: Room Slot Details - Invalid subRoomId');
console.log(`GET ${BASE_URL}/room/${TEST_ROOM_WITH_SUBROOMS}/details?date=${TEST_DATE}&shiftName=Ca Sáng&subRoomId=invalid-id`);
console.log('Expected: 400 error - "Không tìm thấy buồng con trong phòng này"\n');

// Test 13: Dentist Slot Details - Missing required params
console.log('TEST 13: Dentist Slot Details - Missing date');
console.log(`GET ${BASE_URL}/dentist/${TEST_DENTIST_ID}/details?shiftName=Ca Chiều`);
console.log('Expected: 400 error - "dentistId, date và shiftName là bắt buộc"\n');

// Test 14: Nurse Slot Details - Invalid shiftName
console.log('TEST 14: Nurse Slot Details - Invalid shiftName');
console.log(`GET ${BASE_URL}/nurse/${TEST_NURSE_ID}/details?date=${TEST_DATE}&shiftName=InvalidShift`);
console.log('Expected: 400 error - "shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối"\n');

console.log('========================================');
console.log('Response Structure Tests');
console.log('========================================\n');

console.log('TEST 11: Calendar Response Structure');
console.log('Calendar response should have:');
console.log('- periods[].days[].shifts[shiftName].appointmentCount');
console.log('- periods[].days[].shifts[shiftName].totalSlots');
console.log('- periods[].days[].shifts[shiftName].staffStats (for room)');
console.log('- periods[].days[].shifts[shiftName].mostFrequentRoom (for dentist/nurse)');
console.log('- NO slots array!\n');

console.log('TEST 12: Slot Detail Response Structure');
console.log('Slot detail response should have:');
console.log('- roomInfo (with hasSubRooms flag and optional subRoom)');
console.log('- date');
console.log('- shiftName');
console.log('- totalSlots');
console.log('- bookedSlots');
console.log('- availableSlots');
console.log('- slots[] - Array of slot objects with full details\n');

console.log('========================================');
console.log('Curl Commands for Manual Testing');
console.log('========================================\n');

console.log('# 1. Room Calendar - Week');
console.log(`curl "${BASE_URL}/room/${TEST_ROOM_ID}/calendar?viewType=week&limit=10"`);
console.log('');

console.log('# 2. Room Slot Details');
console.log(`curl "${BASE_URL}/room/${TEST_ROOM_ID}/details?date=${TEST_DATE}&shiftName=Ca%20Sáng"`);
console.log('');

console.log('# 3. Dentist Calendar - Month');
console.log(`curl "${BASE_URL}/dentist/${TEST_DENTIST_ID}/calendar?viewType=month"`);
console.log('');

console.log('# 4. Dentist Slot Details');
console.log(`curl "${BASE_URL}/dentist/${TEST_DENTIST_ID}/details?date=${TEST_DATE}&shiftName=Ca%20Chiều"`);
console.log('');

console.log('# 5. Nurse Calendar - Day');
console.log(`curl "${BASE_URL}/nurse/${TEST_NURSE_ID}/calendar?viewType=day&limit=5"`);
console.log('');

console.log('# 6. Nurse Slot Details');
console.log(`curl "${BASE_URL}/nurse/${TEST_NURSE_ID}/details?date=${TEST_DATE}&shiftName=Ca%20Tối"`);
console.log('');

console.log('========================================');
console.log('Expected Behavior Summary');
console.log('========================================\n');

console.log('✅ Calendar APIs (week/month):');
console.log('   - limit parameter is IGNORED');
console.log('   - Always return exactly 1 week or 1 month');
console.log('   - No slots array in shift objects');
console.log('   - Only summary data: counts and stats');
console.log('');

console.log('✅ Calendar APIs (day):');
console.log('   - limit parameter works as before');
console.log('   - Can return multiple days');
console.log('   - No slots array in shift objects');
console.log('   - Only summary data: counts and stats');
console.log('');

console.log('✅ Slot Detail APIs:');
console.log('   - Return full slot array for specific day/shift');
console.log('   - Include all details: staff, times, booking status');
console.log('   - Provide summary: totalSlots, bookedSlots, availableSlots');
console.log('   - Use for drill-down after viewing calendar');
console.log('');

console.log('========================================');
console.log('Frontend Integration Pattern');
console.log('========================================\n');

console.log('// Step 1: Load calendar overview (no slot details)');
console.log(`const calendar = await fetch('${BASE_URL}/room/roomId/calendar?viewType=week');`);
console.log('// Shows: appointment counts, staff stats per day/shift');
console.log('');

console.log('// Step 2: User clicks on a specific day/shift');
console.log('// Load slot details on demand');
console.log(`const details = await fetch('${BASE_URL}/room/roomId/details?date=2025-10-06&shiftName=Ca Sáng');`);
console.log('// Shows: individual slots with full details');
console.log('');

console.log('✅ Benefits:');
console.log('   - Faster initial calendar load');
console.log('   - Reduced bandwidth');
console.log('   - Better user experience (lazy loading)');
console.log('');

console.log('========================================');
console.log('To run actual tests, replace test IDs above');
console.log('and use curl or Postman');
console.log('========================================');

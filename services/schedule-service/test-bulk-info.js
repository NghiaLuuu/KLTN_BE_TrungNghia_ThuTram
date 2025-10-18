/**
 * 🧪 TEST SCRIPT: Kiểm tra logic getBulkRoomSchedulesInfo
 * 
 * Chạy script này để test logic tính availableMonths
 * 
 * Usage:
 *   node test-bulk-info.js
 */

const mongoose = require('mongoose');
const dayjs = require('dayjs');

// Mock data để test logic
const mockRoomInfo = {
  _id: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3022'),
  name: 'Phòng thẩm mỹ nha',
  hasSubRooms: true,
  subRooms: [
    {
      _id: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3023'),
      name: 'Buồng 1',
      isActive: true
    },
    {
      _id: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3024'),
      name: 'Buồng 2',
      isActive: false // ❌ TẮT
    }
  ]
};

const mockSchedules = [
  // Buồng 1 - Tháng 10/2025 - Đầy đủ
  {
    _id: new mongoose.Types.ObjectId('68f0bd0ced413f365088ea6c'),
    roomId: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3022'),
    subRoomId: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3023'),
    month: 10,
    year: 2025,
    isActive: true,
    isActiveSubRoom: true,
    shiftConfig: {
      morning: { isGenerated: true, isActive: true },
      afternoon: { isGenerated: true, isActive: true },
      evening: { isGenerated: true, isActive: false } // Ca tối tắt trong shift config
    }
  },
  // Buồng 2 - Tháng 10/2025 - Thiếu ca nhưng ĐÃ TẮT
  {
    _id: new mongoose.Types.ObjectId('68f0bd0ded413f365088ed08'),
    roomId: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3022'),
    subRoomId: new mongoose.Types.ObjectId('68ee84ddbc3c52f197ff3024'),
    month: 10,
    year: 2025,
    isActive: true,
    isActiveSubRoom: true, // Trong schedule vẫn true
    shiftConfig: {
      morning: { isGenerated: false, isActive: true }, // ❌ Thiếu Ca Sáng
      afternoon: { isGenerated: false, isActive: true }, // ❌ Thiếu Ca Chiều
      evening: { isGenerated: true, isActive: false }
    }
  }
];

const mockConfigShifts = {
  morning: { isActive: true },
  afternoon: { isActive: true },
  evening: { isActive: false } // Ca tối tắt trong config
};

// ==================== TEST LOGIC ====================

console.log('🧪 Testing getBulkRoomSchedulesInfo Logic\n');
console.log('📊 Mock Data:');
console.log('  - Room:', mockRoomInfo.name);
console.log('  - Total subRooms:', mockRoomInfo.subRooms.length);
console.log('  - Active subRooms:', mockRoomInfo.subRooms.filter(sr => sr.isActive !== false).length);
console.log('  - Month to check: 10/2025\n');

// Step 1: Get active shifts from config
const activeShifts = {
  morning: mockConfigShifts.morning?.isActive !== false,
  afternoon: mockConfigShifts.afternoon?.isActive !== false,
  evening: mockConfigShifts.evening?.isActive !== false
};
console.log('📋 Active shifts from config:', activeShifts);
console.log('');

// Step 2: Filter active subrooms
const activeSubRooms = mockRoomInfo.subRooms.filter(sr => sr.isActive !== false);
const activeSubRoomCount = activeSubRooms.length;
const activeSubRoomIds = new Set(activeSubRooms.map(sr => sr._id.toString()));

console.log('✅ Active subRooms:');
activeSubRooms.forEach(sr => {
  console.log(`  - ${sr.name} (${sr._id})`);
});
console.log(`  Total: ${activeSubRoomCount}\n`);

// Step 3: Analyze month 10/2025
const month = 10;
const year = 2025;
const monthSchedules = mockSchedules.filter(s => s.month === month && s.year === year);

console.log(`📅 Analyzing month ${month}/${year}:`);
console.log(`  - Found ${monthSchedules.length} schedules\n`);

// Step 4: Check shift status
const shiftStatus = {
  morning: { allHave: false, someHave: false },
  afternoon: { allHave: false, someHave: false },
  evening: { allHave: false, someHave: false }
};

['morning', 'afternoon', 'evening'].forEach(shiftKey => {
  console.log(`🔍 Checking shift: ${shiftKey}`);
  
  const subRoomsWithShift = monthSchedules.filter(s => {
    const subRoomId = s.subRoomId?.toString();
    const subRoomName = mockRoomInfo.subRooms.find(sr => sr._id.toString() === subRoomId)?.name || 'Unknown';
    
    const isSubRoomActive = activeSubRoomIds.has(subRoomId);
    const isScheduleSubRoomActive = s.isActiveSubRoom !== false;
    const isShiftGenerated = s.shiftConfig?.[shiftKey]?.isGenerated === true;
    const isShiftActive = s.shiftConfig?.[shiftKey]?.isActive !== false;
    
    console.log(`  - ${subRoomName}:`);
    console.log(`      isSubRoomActive: ${isSubRoomActive} (in activeSubRoomIds)`);
    console.log(`      isScheduleSubRoomActive: ${isScheduleSubRoomActive}`);
    console.log(`      isShiftGenerated: ${isShiftGenerated}`);
    console.log(`      isShiftActive: ${isShiftActive}`);
    console.log(`      → Count this? ${isSubRoomActive && isScheduleSubRoomActive && isShiftGenerated && isShiftActive ? 'YES ✅' : 'NO ❌'}`);
    
    return isSubRoomActive && isScheduleSubRoomActive && isShiftGenerated && isShiftActive;
  }).length;

  shiftStatus[shiftKey].allHave = subRoomsWithShift >= activeSubRoomCount;
  shiftStatus[shiftKey].someHave = subRoomsWithShift > 0;
  
  console.log(`  Result: ${subRoomsWithShift}/${activeSubRoomCount} active subrooms have this shift`);
  console.log(`  allHave: ${shiftStatus[shiftKey].allHave}\n`);
});

console.log('📊 Final shift status:', shiftStatus);
console.log('');

// Step 5: Check if month is available
console.log('🎯 Checking if month 10/2025 is AVAILABLE:');

const hasSchedule = monthSchedules.length > 0;
const allSubRoomsHaveSchedule = monthSchedules.length >= activeSubRoomCount;

console.log(`  1. hasSchedule: ${hasSchedule}`);
console.log(`  2. allSubRoomsHaveSchedule: ${allSubRoomsHaveSchedule} (${monthSchedules.length}/${activeSubRoomCount})`);

if (!hasSchedule) {
  console.log('  → Month AVAILABLE (no schedule yet) ✅\n');
} else if (!allSubRoomsHaveSchedule) {
  console.log('  → Month AVAILABLE (not all active subrooms have schedule) ✅\n');
} else {
  // Check missing active shifts
  const missingActiveShifts = [];
  
  console.log('  3. Checking missing ACTIVE shifts:');
  
  if (activeShifts.morning && !shiftStatus.morning.allHave) {
    console.log('      - morning: ACTIVE in config + NOT all have → MISSING ❌');
    missingActiveShifts.push('morning');
  } else if (activeShifts.morning) {
    console.log('      - morning: ACTIVE in config + all have → OK ✅');
  } else {
    console.log('      - morning: DISABLED in config → SKIP (not counted)');
  }
  
  if (activeShifts.afternoon && !shiftStatus.afternoon.allHave) {
    console.log('      - afternoon: ACTIVE in config + NOT all have → MISSING ❌');
    missingActiveShifts.push('afternoon');
  } else if (activeShifts.afternoon) {
    console.log('      - afternoon: ACTIVE in config + all have → OK ✅');
  } else {
    console.log('      - afternoon: DISABLED in config → SKIP (not counted)');
  }
  
  if (activeShifts.evening && !shiftStatus.evening.allHave) {
    console.log('      - evening: ACTIVE in config + NOT all have → MISSING ❌');
    missingActiveShifts.push('evening');
  } else if (activeShifts.evening) {
    console.log('      - evening: ACTIVE in config + all have → OK ✅');
  } else {
    console.log('      - evening: DISABLED in config → SKIP (not counted)');
  }
  
  console.log(`\n  Missing active shifts: [${missingActiveShifts.join(', ')}]`);
  
  if (missingActiveShifts.length > 0) {
    console.log(`  → Month AVAILABLE (missing ${missingActiveShifts.length} active shift(s)) ✅\n`);
  } else {
    console.log('  → Month NOT AVAILABLE (all active shifts complete) ❌\n');
  }
}

// ==================== EXPECTED RESULT ====================

console.log('='.repeat(60));
console.log('📝 EXPECTED RESULT:');
console.log('='.repeat(60));
console.log('');
console.log('✅ Month 10/2025 should be NOT AVAILABLE because:');
console.log('  1. Buồng 1: Đầy đủ tất cả ca ĐANG BẬT (morning ✅, afternoon ✅, evening N/A)');
console.log('  2. Buồng 2: ĐÃ TẮT (isActive=false) → KHÔNG TÍNH');
console.log('  3. activeSubRoomCount = 1 (chỉ Buồng 1)');
console.log('  4. Tất cả ca ĐANG BẬT đã đủ cho activeSubRoomCount');
console.log('  5. → missingActiveShifts = [] (empty)');
console.log('  6. → Month NOT AVAILABLE ❌');
console.log('');
console.log('❌ If month 10/2025 is still AVAILABLE → Logic is WRONG → Check:');
console.log('  - Backend chưa restart?');
console.log('  - activeSubRoomIds đúng chưa?');
console.log('  - Filter logic trong monthSchedules.filter() đúng chưa?');
console.log('');

/**
 * Test Cases cho logic xử lý SubRoom trong Slot Management APIs
 * 
 * Kiểm tra các scenarios:
 * 1. Phòng có subroom - phải chỉ định subRoomId
 * 2. Phòng không có subroom - không được gửi subRoomId  
 * 3. subRoomId không thuộc về phòng đã chỉ định
 * 4. Update slots từ nhiều room/subroom khác nhau
 */

console.log('🧪 TESTING SLOT SUBROOM LOGIC');

// ===========================================
// TEST 1: API reassign-staff với subRoom logic
// ===========================================

const testReassignStaffSubRoomScenarios = [
  {
    name: '✅ SUCCESS: Phòng có subroom + đúng subRoomId',
    request: {
      method: 'POST',
      url: 'http://localhost:3002/api/slots/reassign-staff',
      body: {
        roomId: '68dd31c43df7b61e7b509e70', // Phòng có subroom
        subRoomId: '68dd2e1d3df7b61e7b509e42', // SubRoom hợp lệ
        quarter: 4,
        year: 2025,
        shifts: ['Ca Sáng'],
        dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
        nurseIds: ['68dd3147327b922b6119b8ed']
      }
    },
    expectedResult: 'SUCCESS - Phân công lại thành công'
  },
  
  {
    name: '❌ ERROR: Phòng không có subroom nhưng gửi subRoomId',
    request: {
      method: 'POST', 
      url: 'http://localhost:3002/api/slots/reassign-staff',
      body: {
        roomId: '68dd31c43df7b61e7b509e61', // Phòng KHÔNG có subroom
        subRoomId: '68dd2e1d3df7b61e7b509e42', // Nhưng vẫn gửi subRoomId
        quarter: 4,
        year: 2025,
        shifts: ['Ca Sáng'],
        dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
        nurseIds: []
      }
    },
    expectedError: 'Phòng "[TÊN PHÒNG]" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác.'
  },

  {
    name: '❌ ERROR: Phòng có subroom nhưng không chỉ định subRoomId',
    request: {
      method: 'POST',
      url: 'http://localhost:3002/api/slots/reassign-staff',
      body: {
        roomId: '68dd31c43df7b61e7b509e70', // Phòng CÓ subroom
        // Không gửi subRoomId
        quarter: 4,
        year: 2025, 
        shifts: ['Ca Sáng'],
        dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
        nurseIds: []
      }
    },
    expectedError: 'Phòng "[TÊN PHÒNG]" có X subroom. Vui lòng chỉ định subRoomId cụ thể: [DANH SÁCH ID + TÊN]'
  },

  {
    name: '❌ ERROR: subRoomId không thuộc về roomId',
    request: {
      method: 'POST',
      url: 'http://localhost:3002/api/slots/reassign-staff', 
      body: {
        roomId: '68dd31c43df7b61e7b509e70', // Phòng A
        subRoomId: '68dd2e1d3df7b61e7b509e99', // SubRoom thuộc phòng B
        quarter: 4,
        year: 2025,
        shifts: ['Ca Sáng'],
        dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
        nurseIds: []
      }
    },
    expectedError: 'SubRoom không thuộc về phòng "[TÊN PHÒNG]". Vui lòng kiểm tra lại subRoomId.'
  }
];

// ===========================================  
// TEST 2: API assign-staff với subRoom logic
// ===========================================

const testAssignStaffSubRoomScenarios = [
  {
    name: '✅ SUCCESS: Assign staff với subRoom đúng',
    request: {
      method: 'POST',
      url: 'http://localhost:3002/api/slots/assign-staff',
      body: {
        roomId: '68dd31c43df7b61e7b509e70',
        subRoomId: '68dd2e1d3df7b61e7b509e42',
        quarter: 4,
        year: 2025,
        shifts: ['Ca Chiều'],
        dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
        nurseIds: ['68dd3147327b922b6119b8ed']
      }
    },
    expectedResult: 'SUCCESS - Phân công thành công'
  },

  // Tương tự các error cases như reassign-staff
];

// ===========================================
// TEST 3: API PATCH /staff với multiple slots validation  
// ===========================================

const testUpdateSlotStaffScenarios = [
  {
    name: '✅ SUCCESS: Update slots cùng room/subroom',
    request: {
      method: 'PATCH',
      url: 'http://localhost:3002/api/slots/staff',
      body: {
        slotIds: [
          '650f0b1a2c3d4e5f67890123', // Cùng room + subroom
          '650f0b1a2c3d4e5f67890124'  // Cùng room + subroom
        ],
        dentistId: '68d9f8bab5a75931c6cd0d7d'
      }
    },
    expectedResult: 'SUCCESS - Cập nhật thành công'
  },

  {
    name: '❌ ERROR: Update slots khác room',
    request: {
      method: 'PATCH',
      url: 'http://localhost:3002/api/slots/staff',
      body: {
        slotIds: [
          '650f0b1a2c3d4e5f67890123', // Room A
          '650f0b1a2c3d4e5f67890999'  // Room B  
        ],
        dentistId: '68d9f8bab5a75931c6cd0d7d'
      }
    },
    expectedError: 'Tất cả slot phải thuộc cùng một phòng. Slot [ID] thuộc phòng khác.'
  },

  {
    name: '❌ ERROR: Update slots khác subroom',
    request: {
      method: 'PATCH',
      url: 'http://localhost:3002/api/slots/staff',
      body: {
        slotIds: [
          '650f0b1a2c3d4e5f67890123', // Cùng room, subroom A
          '650f0b1a2c3d4e5f67890888'  // Cùng room, subroom B
        ],
        dentistId: '68d9f8bab5a75931c6cd0d7d'
      }
    },
    expectedError: 'Tất cả slot phải thuộc cùng subroom. Slot đầu tiên có subroom X, nhưng slot [ID] có subroom Y.'
  }
];

// ===========================================
// EXECUTION COMMANDS  
// ===========================================

console.log(`
📋 TEST SCENARIOS PREPARED:

1️⃣ REASSIGN-STAFF API (${testReassignStaffSubRoomScenarios.length} test cases):
   ✅ Phòng có subroom + đúng subRoomId  
   ❌ Phòng không có subroom nhưng gửi subRoomId
   ❌ Phòng có subroom nhưng không chỉ định
   ❌ subRoomId không thuộc về roomId

2️⃣ ASSIGN-STAFF API (${testAssignStaffSubRoomScenarios.length} test case):
   ✅ Tương tự reassign-staff logic

3️⃣ UPDATE-SLOT-STAFF API (${testUpdateSlotStaffScenarios.length} test cases):
   ✅ Slots cùng room/subroom
   ❌ Slots khác room  
   ❌ Slots khác subroom

🚀 TO RUN TESTS:
   node TEST_SLOT_SUBROOM_LOGIC.js

📝 NOTES:
   - Thay thế roomId/subRoomId/slotIds thật từ database
   - Kiểm tra users_cache và rooms_cache có data
   - Đảm bảo có lịch làm việc cho quý 4/2025
   - Test với user role manager/admin
`);

module.exports = {
  testReassignStaffSubRoomScenarios,
  testAssignStaffSubRoomScenarios, 
  testUpdateSlotStaffScenarios
};
// Test endpoints cho slot management với validation mới

/**
 * API Documentation và Test Cases for Enhanced Slot Management
 * 
 * Tính năng mới được thêm:
 * 1. Validation quý/năm không được ở quá khứ  pastQuarterError: {
    // Same as assign-staff past quarter error
    expectedResponse: {
      success: false,
      message: "Không thể cập nhật quý 2/2025 vì đã thuộc quá khứ. Quý hiện tại là 4/2025"
    }
  },

  // TEST CASE: Lỗi subRoom logic
  subRoomMismatchError: {
    method: 'POST',
    url: '/api/slots/reassign-staff',
    body: {
      roomId: '68dd31c43df7b61e7b509e61', // Phòng không có subroom
      subRoomId: '68dd2e1d3df7b61e7b509e42', // Nhưng vẫn gửi subRoomId
      quarter: 4,
      year: 2025,
      shifts: ['Ca Sáng'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
      nurseIds: []
    },
    expectedResponse: {
      success: false,
      message: 'Phòng "Phòng khám tổng quát" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác.'
    }
  },

  // TEST CASE: Phòng có subroom nhưng không chỉ định
  missingSubRoomError: {
    method: 'POST',
    url: '/api/slots/reassign-staff', 
    body: {
      roomId: '68dd31c43df7b61e7b509e70', // Phòng có subroom
      // Không gửi subRoomId
      quarter: 4,
      year: 2025,
      shifts: ['Ca Sáng'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
      nurseIds: []
    },
    expectedResponse: {
      success: false,
      message: 'Phòng "Phòng điều trị đa khoa" có 3 subroom. Vui lòng chỉ định subRoomId cụ thể: 68dd2e1d3df7b61e7b509e42 (Khu A), 68dd2e1d3df7b61e7b509e43 (Khu B), 68dd2e1d3df7b61e7b509e44 (Khu C)'
    }
  }, Chỉ cập nhật slots ở tương lai (theo giờ VN)
 * 3. Lấy danh sách quý/năm và ca làm việc
 * 4. Cải thiện thông báo lỗi
 */

// ================== NEW API ENDPOINTS ==================

// 1. GET /api/slots/available-quarters
// Lấy danh sách quý/năm đã có lịch để phân công
const testGetAvailableQuarters = {
  method: 'GET',
  url: '/api/slots/available-quarters',
  headers: {
    'Authorization': 'Bearer <TOKEN>'
  },
  expectedResponse: {
    success: true,
    data: {
      currentQuarter: {
        quarter: 4,
        year: 2025,
        currentDate: '2025-10-01T...'
      },
      availableOptions: [
        // Chỉ những quý đã có lịch (hasSchedules: true hoặc isCreated: true)
        {
          quarter: 4,
          year: 2025,
          label: 'Quý 4/2025 (Hiện tại)',
          isCurrent: true,
          hasSchedules: true,
          isCreated: true
        },
        {
          quarter: 1,
          year: 2026,
          label: 'Quý 1/2026',
          isCurrent: false,
          hasSchedules: true,
          isCreated: true
        }
        // Các quý chưa tạo lịch sẽ không xuất hiện trong list
      ]
    }
  },
  notes: [
    'Sử dụng logic từ scheduleService.getAvailableQuarters()',
    'Chỉ trả về quý có hasSchedules=true hoặc isCreated=true',
    'Đảm bảo không phân công cho quý chưa có lịch'
  ]
};

// 2. GET /api/slots/available-shifts
// Lấy danh sách ca làm việc từ ScheduleConfig
const testGetAvailableShifts = {
  method: 'GET',
  url: '/api/slots/available-shifts',
  headers: {
    'Authorization': 'Bearer <TOKEN>'
  },
  expectedResponse: {
    success: true,
    data: [
      // Dữ liệu thực từ ScheduleConfig (morningShift, afternoonShift, eveningShift)
      // Ví dụ format:
      { value: 'Ca Sáng', label: 'Ca Sáng', timeRange: 'HH:MM - HH:MM' },
      { value: 'Ca Chiều', label: 'Ca Chiều', timeRange: 'HH:MM - HH:MM' },
      { value: 'Ca Tối', label: 'Ca Tối', timeRange: 'HH:MM - HH:MM' }
      // Chỉ trả về shift có isActive: true
    ]
  },
  notes: [
    'Dữ liệu lấy từ ScheduleConfig.getSingleton()',
    'Sử dụng config.getWorkShifts() để lọc shift active',
    'Nếu chưa có config sẽ trả error 500'
  ]
};

// ================== ENHANCED EXISTING ENDPOINTS ==================

// 3. POST /api/slots/assign-staff (Enhanced với validation)
const testAssignStaffEnhanced = {
  // TEST CASE A: Thành công - gán cho quý hiện tại
  successCase: {
    method: 'POST',
    url: '/api/slots/assign-staff',
    headers: {
      'Authorization': 'Bearer <MANAGER_TOKEN>',
      'Content-Type': 'application/json'
    },
    body: {
      roomId: '64f0c3a1e8a1b23c4d5e6f70',
      quarter: 4,
      year: 2025,
      shifts: ['Ca Sáng', 'Ca Chiều'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
      nurseIds: ['68d9f8bab5a75931c6cd0a11']
    },
    expectedResponse: {
      success: true,
      data: {
        message: 'Phân công nhân sự thành công cho X slot chưa được phân công trước đó',
        slotsUpdated: 10, // example
        shifts: ['Ca Sáng', 'Ca Chiều'],
        dentistAssigned: '68d9f8bab5a75931c6cd0d7d',
        nurseAssigned: '68d9f8bab5a75931c6cd0a11'
      }
    }
  },

  // TEST CASE B: Lỗi - quý trong quá khứ
  pastQuarterError: {
    method: 'POST',
    url: '/api/slots/assign-staff',
    body: {
      roomId: '64f0c3a1e8a1b23c4d5e6f70',
      quarter: 2, // Quý 2/2025 đã qua
      year: 2025,
      shifts: ['Ca Sáng'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
      nurseIds: []
    },
    expectedResponse: {
      success: false,
      message: 'Không thể cập nhật quý 2/2025 vì đã thuộc quá khứ. Quý hiện tại là 4/2025'
    }
  },

  // TEST CASE C: Lỗi - không có schedule
  noScheduleError: {
    method: 'POST',
    url: '/api/slots/assign-staff',
    body: {
      roomId: '64f0c3a1e8a1b23c4d5e6f70',
      quarter: 1,
      year: 2026, // Tương lai nhưng chưa có schedule
      shifts: ['Ca Sáng'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
      nurseIds: []
    },
    expectedResponse: {
      success: false,
      message: 'Không tìm thấy lịch làm việc nào cho phòng trong quý 1/2026. Vui lòng tạo lịch làm việc trước khi phân công nhân sự.'
    }
  },

  // TEST CASE D: Lỗi - không có slot phù hợp (với thông tin chi tiết)
  noSuitableSlotsError: {
    method: 'POST',
    url: '/api/slots/assign-staff',
    body: {
      roomId: '64f0c3a1e8a1b23c4d5e6f70',
      quarter: 4,
      year: 2025,
      shifts: ['Ca Sáng'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'],
      nurseIds: []
    },
    expectedResponse: {
      success: false,
      message: 'Tất cả slot trong quý 4/2025 đã được phân công nhân sự. Sử dụng API reassign-staff để thay đổi nhân sự.'
    },
    notes: [
      'Thông báo lỗi ngắn gọn và rõ ràng',
      'Hướng dẫn hành động tiếp theo cụ thể',
      'Dễ hiểu cho người dùng'
    ]
  }
};

// 4. POST /api/slots/reassign-staff (Enhanced với validation)
const testReassignStaffEnhanced = {
  // Tương tự assign-staff, nhưng chỉ làm việc với slots đã có staff
  successCase: {
    method: 'POST',
    url: '/api/slots/reassign-staff',
    headers: {
      'Authorization': 'Bearer <MANAGER_TOKEN>',
      'Content-Type': 'application/json'
    },
    body: {
      roomId: '64f0c3a1e8a1b23c4d5e6f70',
      quarter: 4,
      year: 2025,
      shifts: ['Ca Chiều'],
      dentistIds: ['68d9f8bab5a75931c6cd0d7d'], // Dentist mới
      nurseIds: []
    },
    expectedResponse: {
      success: true,
      data: {
        message: 'Đã phân công lại thành công 5 slot',
        updatedCount: 5,
        quarter: 4,
        year: 2025,
        shifts: 'Ca Chiều',
        dentistAssigned: '68d9f8bab5a75931c6cd0d7d',
        nurseAssigned: null
      }
    }
  },

  pastQuarterError: {
    // Same as assign-staff past quarter error
    expectedResponse: {
      success: false,
      message: 'Không thể cập nhật quý 2/2025 vì đã thuộc quá khứ. Quý hiện tại là 4/2025'
    }
  }
};

// 5. PATCH /api/slots/staff (Enhanced với validation thời gian)
const testUpdateSlotStaffEnhanced = {
  // TEST CASE A: Thành công - cập nhật slot tương lai
  successCase: {
    method: 'PATCH',
    url: '/api/slots/staff',
    headers: {
      'Authorization': 'Bearer <MANAGER_TOKEN>',
      'Content-Type': 'application/json'
    },
    body: {
      slotIds: ['650f0b1a2c3d4e5f67890123', '650f0b1a2c3d4e5f67890124'],
      dentistId: '68d9f8bab5a75931c6cd0d7d'
    },
    expectedResponse: {
      success: true,
      message: 'Cập nhật nhân sự cho 2 slot thành công',
      data: [
        // Array of updated slot objects
      ]
    }
  },

  // TEST CASE B: Lỗi - slot đã qua thời điểm hiện tại
  pastSlotError: {
    method: 'PATCH',
    url: '/api/slots/staff',
    body: {
      slotIds: ['650f0b1a2c3d4e5f67890123'], // Slot có startTime < now
      dentistId: '68d9f8bab5a75931c6cd0d7d'
    },
    expectedResponse: {
      success: false,
      message: 'Slot 650f0b1a2c3d4e5f67890123 đã qua thời điểm hiện tại (01/10/2025 08:30:00), không thể cập nhật'
    }
  }
};

// ================== WORKFLOW TESTING ==================

// Quy trình test hoàn chỉnh:
const testWorkflow = {
  step1: 'GET /api/slots/available-quarters - Lấy danh sách quý có thể chọn',
  step2: 'GET /api/slots/available-shifts - Lấy danh sách ca làm việc',
  step3: 'POST /api/slots/assign-staff - Phân công nhân sự cho quý phù hợp',
  step4: 'POST /api/slots/reassign-staff - Thay đổi nhân sự nếu cần',
  step5: 'PATCH /api/slots/staff - Cập nhật từng slot riêng lẻ',
  
  notes: [
    'Tất cả API đều kiểm tra thời gian theo VN timezone',
    'Không được cập nhật slot ở quá khứ',
    'Không được chọn quý ở quá khứ',
    'Cần có schedule trước khi phân công',
    'Chỉ manager/admin mới được phân công'
  ]
};

// ================== VALIDATION RULES SUMMARY ==================

const validationRules = {
  quarterYear: {
    rule: 'quarter/year không được ở quá khứ',
    example: 'Hiện tại Q4/2025, không được chọn Q1-Q3/2025 hoặc năm < 2025'
  },
  
  slotTime: {
    rule: 'Chỉ cập nhật slot có startTime > hiện tại (VN time)',
    example: 'Hôm nay 01/10/2025 10:00, không cập nhật slot 01/10/2025 09:00'
  },
  
  scheduleExists: {
    rule: 'Phải có schedule trong quý mới phân công được',
    solution: 'Tạo schedule trước hoặc chọn quý khác'
  },
  
  slotStatus: {
    assign: 'Chỉ gán cho slot chưa có dentist/nurse',
    reassign: 'Chỉ reassign slot đá có dentist hoặc nurse',
    update: 'Chỉ update slot đã có staff (có thể đã được book)'
  }
};

module.exports = {
  testGetAvailableQuarters,
  testGetAvailableShifts,
  testAssignStaffEnhanced,
  testReassignStaffEnhanced,
  testUpdateSlotStaffEnhanced,
  testWorkflow,
  validationRules
};
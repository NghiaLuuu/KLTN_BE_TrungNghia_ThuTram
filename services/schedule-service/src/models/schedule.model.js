const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    index: true
  },
  subRoomId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  
  // ⚠️ Trạng thái subroom tại thời điểm tạo lịch
  // Lưu để biết subroom có active không khi lịch được tạo
  isActiveSubRoom: {
    type: Boolean,
    default: true
  },
  
  // 🆕 Thông tin THÁNG (thay vì quý)
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
    index: true
  },
  year: {
    type: Number,
    required: true,
    index: true
  },
  
  // 🆕 Khoảng thời gian tạo lịch (cả tháng hoặc từ ngày bắt đầu → cuối tháng)
  startDate: {
    type: Date,
    required: true,
    index: true
  },
  endDate: {
    type: Date,
    required: true,
    index: true
  },
  
  // 🆕 Snapshot cấu hình 3 ca tại thời điểm tạo (LƯU CẢ 3 CA DÙ KHÔNG TẠO)
  shiftConfig: {
    morning: {
      name: { type: String, default: 'Ca Sáng' },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      slotDuration: { type: Number, default: 30 },
      isActive: { type: Boolean, default: true },
      isGenerated: { type: Boolean, default: false } // Ca này có được tạo slots không
    },
    afternoon: {
      name: { type: String, default: 'Ca Chiều' },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      slotDuration: { type: Number, default: 30 },
      isActive: { type: Boolean, default: true },
      isGenerated: { type: Boolean, default: false }
    },
    evening: {
      name: { type: String, default: 'Ca Tối' },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      slotDuration: { type: Number, default: 30 },
      isActive: { type: Boolean, default: true },
      isGenerated: { type: Boolean, default: false }
    }
  },
  
  // 🆕 Thống kê phân công nhân sự
  staffAssignment: {
    morning: {
      assigned: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    afternoon: {
      assigned: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    evening: {
      assigned: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    }
  },
  
  // Legacy fields (kept for backward compatibility)
  date: {
    type: Date,
    required: false
  },
  dateVNStr: { type: String, index: true },
  isActive: { type: Boolean, default: true },
  slotDuration: { type: Number },
  generationType: {
    type: String,
    enum: ['manual', 'quarterly', 'auto', 'monthly'],
    default: 'monthly'
  },
  
  // 🆕 User tracking
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // 🆕 Holiday snapshot - lưu thông tin ngày nghỉ tại thời điểm tạo lịch
  // Để khi tạo ca thiếu vẫn dùng đúng cấu hình cũ
  holidaySnapshot: {
    // Ngày nghỉ cố định (lặp lại mỗi tuần) có isActive = true
    recurringHolidays: [{
      name: { type: String },
      dayOfWeek: { type: Number, min: 1, max: 7 }, // 1=CN, 2=T2, ..., 7=T7
      note: { type: String }
    }],
    
    // Ngày nghỉ không cố định trong khoảng thời gian tạo lịch
    nonRecurringHolidays: [{
      name: { type: String },
      startDate: { type: Date },
      endDate: { type: Date },
      note: { type: String }
    }],
    
    // 🆕 Danh sách ngày nghỉ thực tế đã tính toán trong tháng
    // Tự động generate từ recurringHolidays và nonRecurringHolidays
    // ⚠️ Khi tạo override holiday (làm việc trong ngày nghỉ), XÓA ngày đó khỏi array này
    computedDaysOff: [{
      date: {
        type: String, // Format: YYYY-MM-DD
        required: true
      },
      reason: {
        type: String, // Tên ngày nghỉ (vd: "Nghỉ Chủ nhật", "Nghỉ tháng 11")
        required: true
      }
    }]
  }
}, {
  timestamps: true
});

// Compound index for efficient queries (UPDATED: month instead of quarter)
scheduleSchema.index({ roomId: 1, month: 1, year: 1 });
scheduleSchema.index({ roomId: 1, subRoomId: 1, month: 1, year: 1 });
scheduleSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);

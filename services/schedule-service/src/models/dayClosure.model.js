const mongoose = require('mongoose');

/**
 * Model SlotStatusChange - Theo dõi TẤT CẢ thao tác bật/tắt slot
 * Sử dụng cho: slots riêng lẻ, theo phòng, theo nha sĩ, theo ngày và đóng cửa cả ngày
 */
const dayClosureSchema = new mongoose.Schema(
  {
    // Loại thao tác
    operationType: {
      type: String,
      enum: [
        'disable_all_day',        // Tắt tất cả phòng trong 1 ngày
        'enable_all_day',         // Bật lại tất cả phòng trong 1 ngày
        'disable_flexible',       // Tắt theo tiêu chí (ngày, ca, phòng, nha sĩ)
        'enable_flexible',        // Bật theo tiêu chí
        'toggle_individual'       // Bật/tắt slot cụ thể theo ID
      ],
      required: true,
      index: true
    },

    // Hành động: bật hoặc tắt
    action: {
      type: String,
      enum: ['enable', 'disable'],
      required: true,
      index: true
    },

    // Khoảng ngày bị ảnh hưởng (cho truy vấn)
    dateFrom: {
      type: Date,
      index: true
    },
    dateTo: {
      type: Date,
      index: true
    },

    // Tiêu chí sử dụng cho thao tác linh hoạt
    criteria: {
      date: String,           // Ngày đơn (YYYY-MM-DD)
      startDate: String,      // Bắt đầu khoảng ngày
      endDate: String,        // Kết thúc khoảng ngày
      shiftName: String,      // 'Ca Sáng', 'Ca Chiều', 'Ca Tối'
      dentistId: mongoose.Schema.Types.ObjectId,
      nurseId: mongoose.Schema.Types.ObjectId,
      roomId: mongoose.Schema.Types.ObjectId,
      subRoomId: mongoose.Schema.Types.ObjectId,
      slotIds: [String]       // Cho thao tác slot riêng lẻ
    },

    // Lý do thay đổi
    reason: {
      type: String,
      required: function() {
        return this.action === 'disable'; // Bắt buộc chỉ cho thao tác vô hiệu hóa
      }
    },

    // Loại đóng cửa/thao tác
    closureType: {
      type: String,
      enum: ['emergency', 'planned', 'maintenance', 'staff_absence', 'other'],
      default: 'other'
    },

    // 🆕 Flag to distinguish appointment cancellation from slot toggle/closure
    isAppointmentCancellation: {
      type: Boolean,
      default: false
    },

    // Thống kê
    stats: {
      totalSlotsDisabled: { type: Number, default: 0 },
      affectedRoomsCount: { type: Number, default: 0 },
      appointmentsCancelledCount: { type: Number, default: 0 },
      emailsSentCount: { type: Number, default: 0 }
    },

    // Các phòng bị ảnh hưởng
    affectedRooms: [{
      roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
      roomName: String,
      slotsDisabled: Number,
      slots: [{ // Chi tiết các slot bị tắt
        slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot' },
        date: Date,
        startTime: String,
        endTime: String,
        shiftName: String,
        dentistNames: [String],
        nurseNames: [String],
        hasAppointment: Boolean
      }]
    }],

    // Thông tin chi tiết về các cuộc hẹn bị hủy
    cancelledAppointments: [{
      // Thông tin cuộc hẹn
      appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
      appointmentDate: Date,
      cancelledAt: Date, // Thời gian hủy thực tế từ appointment.cancelledAt
      shiftName: String,
      startTime: String,
      endTime: String,

      // Thông tin bệnh nhân
      patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      patientName: String,
      patientEmail: String,
      patientPhone: String,

      // Thông tin phòng
      roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Room' },
      roomName: String,

      // Thông tin nhân viên
      dentists: [{
        dentistId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        dentistName: String,
        dentistEmail: String
      }],
      nurses: [{
        nurseId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        nurseName: String,
        nurseEmail: String
      }],

      // Thông tin thanh toán & hóa đơn (tùy chọn, có thể chưa tồn tại)
      paymentInfo: {
        paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment' },
        status: String,
        amount: Number,
        method: String
      },
      invoiceInfo: {
        invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
        invoiceNumber: String,
        status: String
      },

      // Trạng thái thông báo
      emailSent: { type: Boolean, default: false },
      emailSentAt: Date
    }],

    // Nhân viên bị ảnh hưởng không có cuộc hẹn (họ đã được phân công slots nhưng không có bệnh nhân)
    affectedStaffWithoutAppointments: [{
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      name: String,
      email: String,
      role: { type: String, enum: ['dentist', 'nurse'] },
      emailSent: { type: Boolean, default: false }
    }],

    // Người thực hiện đóng cửa
    closedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      userName: String,
      userRole: String
    },

    // Theo dõi trạng thái
    status: {
      type: String,
      enum: ['active', 'partially_restored', 'fully_restored'],
      default: 'active'
    },

    // Nếu được khôi phục
    restoredAt: Date,
    restoredBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      userName: String
    },
    restorationReason: String
  },
  {
    timestamps: true
  }
);

// Indexes cho truy vấn hiệu quả
dayClosureSchema.index({ dateFrom: -1, dateTo: -1 });
dayClosureSchema.index({ operationType: 1, createdAt: -1 });
dayClosureSchema.index({ action: 1, createdAt: -1 });
dayClosureSchema.index({ status: 1, dateFrom: -1 });
dayClosureSchema.index({ 'closedBy.userId': 1 });
dayClosureSchema.index({ createdAt: -1 });
dayClosureSchema.index({ 'criteria.roomId': 1 });
dayClosureSchema.index({ 'criteria.dentistId': 1 });

// Virtual cho ngày đã định dạng
dayClosureSchema.virtual('formattedDateFrom').get(function() {
  if (!this.dateFrom) return '';
  const d = new Date(this.dateFrom);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
});

dayClosureSchema.virtual('formattedDateTo').get(function() {
  if (!this.dateTo) return '';
  const d = new Date(this.dateTo);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
});

// Virtual cho tổng số người bị ảnh hưởng
dayClosureSchema.virtual('totalAffectedPeople').get(function() {
  let count = 0;
  if (this.cancelledAppointments) {
    count += this.cancelledAppointments.length; // Patients
    const dentistIds = new Set();
    const nurseIds = new Set();
    this.cancelledAppointments.forEach(appt => {
      appt.dentists?.forEach(d => dentistIds.add(d.dentistId?.toString()));
      appt.nurses?.forEach(n => nurseIds.add(n.nurseId?.toString()));
    });
    count += dentistIds.size + nurseIds.size;
  }
  if (this.affectedStaffWithoutAppointments) {
    count += this.affectedStaffWithoutAppointments.length;
  }
  return count;
});

// Phương thức lấy tóm tắt thao tác
dayClosureSchema.methods.getSummary = function() {
  const actionText = this.action === 'disable' ? 'Tắt' : 'Bật';
  const operationNames = {
    disable_all_day: 'tất cả phòng trong ngày',
    enable_all_day: 'tất cả phòng trong ngày',
    disable_flexible: 'slots theo tiêu chí',
    enable_flexible: 'slots theo tiêu chí',
    toggle_individual: 'slots cụ thể'
  };
  
  return `${actionText} ${operationNames[this.operationType] || 'slots'}`;
};

dayClosureSchema.set('toJSON', { virtuals: true });
dayClosureSchema.set('toObject', { virtuals: true });

const SlotStatusChange = mongoose.model('SlotStatusChange', dayClosureSchema);

module.exports = SlotStatusChange;

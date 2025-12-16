const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  scheduleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: true
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  subRoomId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null, // null cho phòng không có subroom
    index: true
  },
  // Đánh dấu ngày đã lỗi thời; startTime mã hóa ngày/giờ theo UTC. Giữ tùy chọn để tương thích ngược.
  date: {
    type: Date,
    required: false,
    index: true
  },
  shiftName: {
    type: String,
    required: true,
    enum: ['Ca Sáng', 'Ca Chiều', 'Ca Tối']
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  // 🔄 Phân công nhân viên - Mảng để hỗ trợ nhiều nha sĩ/y tá cho phòng không có phòng con
  // Phòng CÓ phòng con: phân 1 nha sĩ + 1 y tá (length = 1)
  // Phòng KHÔNG CÓ phòng con: có thể phân nhiều (tới maxDoctor/maxNurse)
  dentist: {
    type: [mongoose.Schema.Types.ObjectId],
    default: []
  },
  nurse: {
    type: [mongoose.Schema.Types.ObjectId],
    default: []
  },
  // 🔄 Trạng thái đặt chỗ - Nguồn dữ liệu duy nhất
  // 'available': Slot sẵn sàng, chưa ai đặt
  // 'locked': Đang giữ chỗ tạm (reserve nhưng chưa thanh toán, có 15 phút)
  // 'booked': Đã thanh toán xong, appointment đã được tạo
  status: {
    type: String,
    enum: ['available', 'locked', 'booked'],
    default: 'available',
    required: true,
    index: true
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  // Thời gian khóa - để debug các slot bị khóa
  lockedAt: {
    type: Date,
    default: null
  },
  lockedBy: {
    type: String, // reservationId
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // 🆕 Thời lượng tính bằng phút
  duration: {
    type: Number,
    default: 30
  },
  // 🆕 Nhiệm vụ 2.3: Flag đánh dấu slot được tạo trong ngày nghỉ (override holiday)
  isHolidayOverride: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true
});

// Index kết hợp cho hiệu suất - ⚡ TỐI ƯU cho truy vấn lịch & chi tiết
// Truy vấn lịch phòng: roomId + isActive + startTime
slotSchema.index({ roomId: 1, isActive: 1, startTime: 1 });
slotSchema.index({ roomId: 1, subRoomId: 1, isActive: 1, startTime: 1 }); // Với subRoom

// ⚡ MỚI: Tối ưu cho lịch với bộ lọc chỉ tương lai
slotSchema.index({ roomId: 1, subRoomId: 1, isActive: 1, startTime: 1 }, { 
  name: 'room_calendar_future' 
});

slotSchema.index({ roomId: 1, shiftName: 1, isActive: 1, startTime: 1 }); // Chi tiết phòng

// Truy vấn lịch nhân viên: dentist/nurse + isActive + startTime
slotSchema.index({ dentist: 1, isActive: 1, startTime: 1 });
slotSchema.index({ nurse: 1, isActive: 1, startTime: 1 });

// Truy vấn chi tiết nhân viên: dentist/nurse + shiftName + isActive + startTime
slotSchema.index({ dentist: 1, shiftName: 1, isActive: 1, startTime: 1 });
slotSchema.index({ nurse: 1, shiftName: 1, isActive: 1, startTime: 1 });

// Tra cứu cuộc hẹn
slotSchema.index({ appointmentId: 1 });

// ⚡ Tối ưu truy vấn thống kê sử dụng
// Thứ tự: bằng → $in → khoảng → các trường bổ sung
slotSchema.index({ isActive: 1, roomId: 1, startTime: 1, shiftName: 1 }, {
  name: 'utilization_stats_query_v2'
});

// Truy vấn chung - Cập nhật cho trường status
slotSchema.index({ status: 1, startTime: 1, isActive: 1 });
slotSchema.index({ roomId: 1, status: 1, startTime: 1 });
slotSchema.index({ dentist: 1, status: 1, startTime: 1 });

// Virtual để lấy ngày theo múi giờ Việt Nam
slotSchema.virtual('dateVN').get(function() {
  // Lấy ngày VN từ startTime nếu có
  const base = this.startTime || this.date;
  if (!base) return null;
  const vnTime = new Date(base.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  return vnTime.toISOString().split('T')[0];
});

// Virtual để lấy giờ bắt đầu theo múi giờ Việt Nam
slotSchema.virtual('startTimeVN').get(function() {
  if (!this.startTime) return null;
  const vnTime = new Date(this.startTime.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  return vnTime.toTimeString().substr(0, 5);
});

// Virtual để lấy giờ kết thúc theo múi giờ Việt Nam
slotSchema.virtual('endTimeVN').get(function() {
  if (!this.endTime) return null;
  const vnTime = new Date(this.endTime.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  return vnTime.toTimeString().substr(0, 5);
});

// Đảm bảo virtuals được bao gồm trong kết quả JSON
slotSchema.set('toJSON', { virtuals: true });
slotSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Slot', slotSchema);

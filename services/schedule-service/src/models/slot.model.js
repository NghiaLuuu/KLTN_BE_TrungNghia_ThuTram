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
    default: null, // null for rooms without subrooms
    index: true
  },
  // Deprecated day marker; startTime encodes the day/time in UTC. Keep optional for BC.
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
  // 🔄 Staff assignment - Arrays to support multiple dentists/nurses for rooms without subrooms
  // For rooms WITH subrooms: assign 1 dentist + 1 nurse (length = 1)
  // For rooms WITHOUT subrooms: can assign multiple (up to maxDoctor/maxNurse)
  dentist: {
    type: [mongoose.Schema.Types.ObjectId],
    default: []
  },
  nurse: {
    type: [mongoose.Schema.Types.ObjectId],
    default: []
  },
  // 🔄 Booking status - Single source of truth
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
  // Locked timestamp - for debugging locked slots
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
  // 🆕 Duration in minutes
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

// Compound indexes for performance - ⚡ OPTIMIZED for calendar & details queries
// Room calendar query: roomId + isActive + startTime
slotSchema.index({ roomId: 1, isActive: 1, startTime: 1 });
slotSchema.index({ roomId: 1, subRoomId: 1, isActive: 1, startTime: 1 }); // With subRoom

// ⚡ NEW: Optimized for calendar with futureOnly filter
slotSchema.index({ roomId: 1, subRoomId: 1, isActive: 1, startTime: 1 }, { 
  name: 'room_calendar_future' 
});

slotSchema.index({ roomId: 1, shiftName: 1, isActive: 1, startTime: 1 }); // Room details

// Staff calendar queries: dentist/nurse + isActive + startTime
slotSchema.index({ dentist: 1, isActive: 1, startTime: 1 });
slotSchema.index({ nurse: 1, isActive: 1, startTime: 1 });

// Staff details queries: dentist/nurse + shiftName + isActive + startTime
slotSchema.index({ dentist: 1, shiftName: 1, isActive: 1, startTime: 1 });
slotSchema.index({ nurse: 1, shiftName: 1, isActive: 1, startTime: 1 });

// Appointment lookup
slotSchema.index({ appointmentId: 1 });

// ⚡ Utilization statistics query optimization
// Order: equality → $in → range → additional fields
slotSchema.index({ isActive: 1, roomId: 1, startTime: 1, shiftName: 1 }, {
  name: 'utilization_stats_query_v2'
});

// General queries - Updated for status field
slotSchema.index({ status: 1, startTime: 1, isActive: 1 });
slotSchema.index({ roomId: 1, status: 1, startTime: 1 });
slotSchema.index({ dentist: 1, status: 1, startTime: 1 });

// Virtual to get Vietnam timezone date
slotSchema.virtual('dateVN').get(function() {
  // Derive VN date from startTime if available
  const base = this.startTime || this.date;
  if (!base) return null;
  const vnTime = new Date(base.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  return vnTime.toISOString().split('T')[0];
});

// Virtual to get Vietnam timezone start time
slotSchema.virtual('startTimeVN').get(function() {
  if (!this.startTime) return null;
  const vnTime = new Date(this.startTime.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  return vnTime.toTimeString().substr(0, 5);
});

// Virtual to get Vietnam timezone end time
slotSchema.virtual('endTimeVN').get(function() {
  if (!this.endTime) return null;
  const vnTime = new Date(this.endTime.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
  return vnTime.toTimeString().substr(0, 5);
});

// Ensure virtuals are included in JSON output
slotSchema.set('toJSON', { virtuals: true });
slotSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Slot', slotSchema);

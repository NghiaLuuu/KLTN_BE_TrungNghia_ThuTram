const mongoose = require('mongoose');

/**
 * Schema cho từng tin nhắn trong phiên chat
 */
const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true
  },
  imageUrl: {
    type: String, // URL S3 cho ảnh được upload
    required: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

/**
 * Schema cho phiên chat
 * Lưu trữ lịch sử cuộc trò chuyện và ngữ cảnh đặt lịch
 */
const chatSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.Mixed, // Cho phép cả ObjectId và String (cho user ẩn danh)
    required: true,
    index: true
  },
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  messages: [messageSchema],
  isActive: {
    type: Boolean,
    default: true
  },
  bookingContext: {
    type: {
      isInBookingFlow: { type: Boolean, default: false }, // Đang trong luồng đặt lịch
      selectedService: { type: Object, default: null }, // Dịch vụ đã chọn
      selectedServiceAddOn: { type: Object, default: null }, // Dịch vụ phụ đã chọn
      selectedServiceItem: { type: Object, default: null }, // Dịch vụ+addon kết hợp cho danh sách phẳng
      flatServiceList: { type: Array, default: [] }, // Danh sách dịch vụ phẳng có số thứ tự
      availableDentists: { type: Array, default: [] }, // Danh sách nha sĩ
      selectedDentist: { type: Object, default: null }, // Nha sĩ đã chọn
      availableDates: { type: Array, default: [] }, // Ngày làm việc
      selectedDate: { type: String, default: null }, // Ngày đã chọn
      availableSlotGroups: { type: Array, default: [] }, // Nhóm slot trống
      selectedSlot: { type: Object, default: null }, // Slot đã chọn
      selectedSlotGroup: { type: Object, default: null }, // Nhóm slot đã chọn
      step: { 
        type: String, 
        enum: ['SERVICE_SELECTION', 'ADDON_SELECTION', 'DENTIST_SELECTION', 'DATE_SELECTION', 'SLOT_SELECTION', 'CONFIRMATION', null],
        default: null 
      },
      lastUpdated: { type: Date, default: null }
    },
    default: {
      isInBookingFlow: false,
      selectedService: null,
      selectedServiceAddOn: null,
      selectedServiceItem: null,
      flatServiceList: [],
      availableDentists: [],
      selectedDentist: null,
      availableDates: [],
      selectedDate: null,
      availableSlotGroups: [],
      selectedSlot: null,
      selectedSlotGroup: null,
      step: null,
      lastUpdated: null
    }
  }
}, {
  timestamps: true
});

// Index để truy vấn nhanh hơn
chatSessionSchema.index({ userId: 1, createdAt: -1 });

const ChatSession = mongoose.model('ChatSession', chatSessionSchema);

module.exports = ChatSession;

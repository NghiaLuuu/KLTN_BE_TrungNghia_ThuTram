const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  // ID của record đã hoàn thành
  recordId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true // Đảm bảo mỗi record chỉ có 1 conversation
  },
  
  // ID của bác sĩ
  doctorId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  // ID của bệnh nhân
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  // Thông tin bác sĩ (cache để hiển thị nhanh)
  doctorInfo: {
    name: String,
    avatar: String,
    specialization: String
  },
  
  // Thông tin bệnh nhân (cache để hiển thị nhanh)
  patientInfo: {
    name: String,
    avatar: String,
    phone: String
  },
  
  // Tin nhắn cuối cùng
  lastMessage: {
    content: String,
    senderId: mongoose.Schema.Types.ObjectId,
    senderType: {
      type: String,
      enum: ['doctor', 'patient']
    },
    timestamp: Date,
    messageType: {
      type: String,
      enum: ['text', 'image', 'file'],
      default: 'text'
    }
  },
  
  // Số tin nhắn chưa đọc của mỗi bên
  unreadCount: {
    doctor: {
      type: Number,
      default: 0
    },
    patient: {
      type: Number,
      default: 0
    }
  },
  
  // Trạng thái active của conversation
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Thời gian tạo và cập nhật
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index để tìm kiếm nhanh
conversationSchema.index({ doctorId: 1, patientId: 1 });
conversationSchema.index({ recordId: 1 });
conversationSchema.index({ 'lastMessage.timestamp': -1 });

// Middleware cập nhật updatedAt
conversationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Conversation', conversationSchema);
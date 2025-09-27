const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // ID cuộc hội thoại
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  
  // ID người gửi
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  
  // Loại người gửi
  senderType: {
    type: String,
    enum: ['doctor', 'patient'],
    required: true
  },
  
  // Nội dung tin nhắn
  content: {
    type: String,
    required: true,
    maxlength: 2000
  },
  
  // Loại tin nhắn
  messageType: {
    type: String,
    enum: ['text', 'image', 'file'],
    default: 'text'
  },
  
  // Metadata cho file/image
  fileInfo: {
    originalName: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    url: String
  },
  
  // Trạng thái đọc
  readBy: [{
    userId: mongoose.Schema.Types.ObjectId,
    userType: {
      type: String,
      enum: ['doctor', 'patient']
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Trạng thái tin nhắn
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  
  // Tin nhắn đã bị xóa
  isDeleted: {
    type: Boolean,
    default: false
  },
  
  // Thời gian xóa
  deletedAt: Date,
  
  // Thời gian tạo
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index để tìm kiếm và sắp xếp
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1 });

module.exports = mongoose.model('Message', messageSchema);
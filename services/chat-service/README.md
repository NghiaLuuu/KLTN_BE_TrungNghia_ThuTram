# Chat Service - Real-time Messaging

## Overview
Service chat realtime giữa nha sĩ và bệnh nhân sử dụng Socket.IO. Tự động tạo cuộc hội thoại khi record hoàn thành.

## Features
- ✅ Chat 1-1 giữa nha sĩ và bệnh nhân
- ✅ Real-time messaging với Socket.IO
- ✅ Tự động tạo conversation từ record hoàn thành
- ✅ Đánh dấu tin nhắn đã đọc
- ✅ Typing indicators
- ✅ Online/offline status
- ✅ Search conversations
- ✅ Message history với pagination

## Port
- **Development**: 3012
- **Production**: 3012

## Database
- **MongoDB**: `dental_clinic_chat`
- **Collections**: `conversations`, `messages`

## API Endpoints

### REST API
```
GET    /api/chat/conversations                     # Lấy danh sách conversations
GET    /api/chat/conversations/search?q=query      # Tìm kiếm conversations
GET    /api/chat/conversations/:id                 # Lấy conversation chi tiết
GET    /api/chat/conversations/:id/messages        # Lấy messages (có pagination)
POST   /api/chat/conversations/:id/messages        # Gửi tin nhắn
PUT    /api/chat/conversations/:id/read             # Đánh dấu đã đọc

# Webhook (no auth)
POST   /api/chat/webhook/record-completed          # Tạo conversation từ record
```

### Socket.IO Events

#### Client -> Server
```javascript
// Tham gia conversation
socket.emit('join_conversation', { conversationId });

// Rời conversation
socket.emit('leave_conversation', { conversationId });

// Gửi tin nhắn
socket.emit('send_message', {
  conversationId,
  content,
  messageType: 'text' // 'text', 'image', 'file'
});

// Typing indicators
socket.emit('typing_start', { conversationId });
socket.emit('typing_stop', { conversationId });

// Đánh dấu đã đọc
socket.emit('mark_as_read', { conversationId });
```

#### Server -> Client
```javascript
// Tin nhắn mới
socket.on('new_message', (data) => {
  console.log('New message:', data.data);
});

// Tin nhắn đã gửi thành công
socket.on('message_sent', (data) => {
  console.log('Message sent:', data.data);
});

// User đang typing
socket.on('user_typing', (data) => {
  console.log(`${data.userName} is typing:`, data.isTyping);
});

// Tin nhắn đã được đọc
socket.on('messages_read', (data) => {
  console.log('Messages read by:', data.userId);
});

// Conversation mới
socket.on('notification', (data) => {
  if (data.type === 'new_conversation') {
    console.log('New conversation created:', data.data);
  }
});

// Lỗi
socket.on('error', (error) => {
  console.error('Socket error:', error.message);
});
```

## Integration với Record Service

### Khi record hoàn thành, gửi message qua RabbitMQ:

```javascript
// Exchange: record_events
// Routing Key: record.completed
// Message:
{
  "recordId": "record_id",
  "doctorId": "doctor_id", 
  "patientId": "patient_id",
  "doctorInfo": {
    "name": "Dr. John Doe",
    "avatar": "avatar_url",
    "specialization": "Orthodontics"
  },
  "patientInfo": {
    "name": "Jane Smith", 
    "avatar": "avatar_url",
    "phone": "+84123456789"
  }
}
```

## Client Authentication

### JWT Token
```javascript
// HTTP Headers
Authorization: Bearer <jwt_token>

// Socket.IO
const socket = io('http://localhost:3012', {
  auth: {
    token: jwt_token
  }
});
```

## Usage Examples

### Frontend Integration
```javascript
// Connect to chat service
const socket = io('http://localhost:3012', {
  auth: { token: localStorage.getItem('token') }
});

// Join conversation
socket.emit('join_conversation', { conversationId: 'conv_id' });

// Send message
socket.emit('send_message', {
  conversationId: 'conv_id',
  content: 'Hello doctor!',
  messageType: 'text'
});

// Listen for new messages
socket.on('new_message', (data) => {
  addMessageToUI(data.data);
});
```

### Get Conversations
```javascript
fetch('/api/chat/conversations', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
})
.then(res => res.json())
.then(data => {
  console.log('Conversations:', data.data);
});
```

## Development

### Install Dependencies
```bash
cd services/chat-service
npm install
```

### Environment Variables
```bash
cp .env.example .env
# Edit .env with your configuration
```

### Start Development
```bash
npm run dev
```

### Docker
```bash
docker build -t chat-service .
docker run -p 3012:3012 chat-service
```

## Database Schema

### Conversation Model
```javascript
{
  recordId: ObjectId,           // Unique per record
  doctorId: ObjectId,
  patientId: ObjectId,
  doctorInfo: {
    name: String,
    avatar: String,
    specialization: String
  },
  patientInfo: {
    name: String,
    avatar: String,
    phone: String
  },
  lastMessage: {
    content: String,
    senderId: ObjectId,
    senderType: 'doctor|patient',
    timestamp: Date,
    messageType: 'text|image|file'
  },
  unreadCount: {
    doctor: Number,
    patient: Number
  },
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### Message Model
```javascript
{
  conversationId: ObjectId,
  senderId: ObjectId,
  senderType: 'doctor|patient',
  content: String,
  messageType: 'text|image|file',
  fileInfo: {
    originalName: String,
    fileName: String,
    fileSize: Number,
    mimeType: String,
    url: String
  },
  readBy: [{
    userId: ObjectId,
    userType: 'doctor|patient',
    readAt: Date
  }],
  status: 'sent|delivered|read',
  isDeleted: Boolean,
  deletedAt: Date,
  createdAt: Date
}
```
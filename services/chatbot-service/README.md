# 🤖 SmileCare AI Chatbot Service

Dịch vụ AI Chatbot thông minh cho phòng khám nha khoa SmileCare, sử dụng OpenAI GPT-4o.

## 📋 Tính năng

- ✅ Chat tư vấn nha khoa với GPT-4o
- ✅ Tự động từ chối câu hỏi ngoài phạm vi
- ✅ Lưu lịch sử chat vào MongoDB
- ✅ API RESTful đơn giản, dễ tích hợp
- ✅ Hỗ trợ context conversation (nhớ cuộc trò chuyện)

## 🚀 Cài đặt

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env and add your OpenAI API key

# Run development
npm run dev

# Run production
npm start
```

## 🔧 Environment Variables

```env
# Service
PORT=3013
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://admin:password123@localhost:27017/dental_clinic_chatbot?authSource=admin

# Redis (optional)
REDIS_URL=redis://localhost:6379

# OpenAI
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o
OPENAI_VISION_MODEL=gpt-4o
MAX_TOKENS=2000
TEMPERATURE=0.7

# CORS
CORS_ORIGIN=http://localhost:5173
```

## 📡 API Endpoints

### 1. Send Message
**POST** `/api/ai/chat`

Send a message and get AI response.

**Request:**
```json
{
  "message": "Tôi muốn biết về dịch vụ tẩy trắng răng",
  "userId": "optional-user-id"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Dịch vụ tẩy trắng răng tại SmileCare...",
  "sessionId": "session_123456",
  "timestamp": "2025-11-06T10:30:00.000Z"
}
```

### 2. Get Chat History
**GET** `/api/ai/history?limit=50`

Get chat history for current user.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "role": "user",
      "content": "Xin chào",
      "timestamp": "2025-11-06T10:29:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Xin chào! Tôi là trợ lý AI...",
      "timestamp": "2025-11-06T10:29:01.000Z"
    }
  ],
  "total": 2
}
```

### 3. Clear Chat History
**DELETE** `/api/ai/history`

Clear chat history for current user.

**Response:**
```json
{
  "success": true,
  "message": "Đã xóa lịch sử chat thành công"
}
```

### 4. Health Check
**GET** `/health`

Check service status.

**Response:**
```json
{
  "status": "OK",
  "service": "chatbot-service",
  "mongodb": "connected",
  "timestamp": "2025-11-06T10:30:00.000Z"
}
```

## 🧠 System Prompt

Bot được cấu hình với system prompt chuyên biệt:

- ✅ Chỉ tư vấn về nha khoa
- ✅ Từ chối lịch sự các câu hỏi ngoài phạm vi
- ✅ Thân thiện, chuyên nghiệp
- ✅ Khuyến khích đặt lịch khám

## 📁 Cấu trúc dự án

```
chatbot-service/
├── src/
│   ├── config/
│   │   ├── openai.config.js       # OpenAI client setup
│   │   └── systemPrompts.js       # AI system prompts
│   ├── models/
│   │   └── chatSession.model.js   # MongoDB model
│   ├── repositories/
│   │   └── chatSession.repository.js
│   ├── services/
│   │   └── ai.service.js          # OpenAI integration
│   ├── controllers/
│   │   └── chatbot.controller.js  # Request handlers
│   ├── routes/
│   │   └── chatbot.route.js       # API routes
│   └── index.js                   # Entry point
├── .env
├── package.json
└── README.md
```

## 🧪 Testing

```bash
# Manual test with curl
curl -X POST http://localhost:3013/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Xin chào"}'

# Get history
curl http://localhost:3013/api/ai/history

# Clear history
curl -X DELETE http://localhost:3013/api/ai/history
```

## ⚠️ Notes

1. **OpenAI API Key Required:** Service cần OpenAI API key để hoạt động
2. **MongoDB Optional:** Nếu không có MongoDB, bot vẫn hoạt động nhưng không lưu history
3. **Rate Limiting:** OpenAI có giới hạn request, cần theo dõi usage
4. **Cost:** Mỗi request tới GPT-4o có chi phí, cần kiểm soát usage

## 📝 TODO (Future)

- [ ] Tích hợp API nội bộ (service-service, schedule-service...)
- [ ] GPT Vision cho phân tích ảnh răng
- [ ] Rate limiting và caching
- [ ] Streaming response
- [ ] Multi-language support
- [ ] Analytics và logging

## 📞 Support

Nếu có vấn đề, vui lòng tạo issue hoặc liên hệ team!

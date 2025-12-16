// Tải biến môi trường trước tiên
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Import routes
const chatbotRoutes = require('./routes/chatbot.route');

const app = express();
const PORT = process.env.PORT || 3013;

// Middleware CORS
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000',
      'https://smilecare.io.vn',
      'https://www.smilecare.io.vn'
    ].filter(Boolean).flatMap(o => o.split(',').map(s => s.trim())).filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn('🚫 CORS chặn origin:', origin);
      callback(new Error('Không được phép bởi CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires', 'X-Selected-Role']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Kết nối MongoDB
const connectDB = async () => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!MONGODB_URI) {
      console.warn('⚠️  Không tìm thấy MongoDB URI, chạy không có database');
      return;
    }
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB đã kết nối thành công');
  } catch (error) {
    console.error('❌ Lỗi kết nối MongoDB:', error);
  }
};

connectDB();

// Endpoint kiểm tra health
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'chatbot-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Endpoint gốc
app.get('/', (req, res) => {
  res.json({
    service: 'SmileCare AI Chatbot Service',
    version: '1.0.0',
    status: 'Đang chạy',
    endpoints: {
      chat: 'POST /api/ai/chat',
      history: 'GET /api/ai/history',
      clearHistory: 'DELETE /api/ai/history'
    }
  });
});

// Routes chatbot
app.use('/api/ai', chatbotRoutes);

// Middleware xử lý lỗi
app.use((err, req, res, next) => {
  console.error('❌ Lỗi server:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Lỗi server nội bộ'
  });
});

app.listen(PORT, () => {
  console.log(`🤖 Chatbot Service running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/ai/chat`);
});
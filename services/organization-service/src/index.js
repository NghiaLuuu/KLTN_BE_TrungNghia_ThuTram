require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const redisClient = require('./utils/redis.client');
const orgRepo = require('./repositories/organization.repository');

const app = express();
const PORT = process.env.PORT || 3000; // Sử dụng PORT từ .env

const ORG_CACHE_KEY = 'organization_singleton';

// 🔹 MIDDLEWARE
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 🔹 ROUTES
app.use('/api/organization', require('./routes/organization.route'));

// 🔹 HEALTH CHECK
app.get('/health', (req, res) => {
  res.status(200).json({
    service: 'Organization Service',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 🔹 ERROR HANDLING
app.use((err, req, res, next) => {
  // Handle body-parser / JSON parse errors explicitly
  if (err && err.type === 'entity.parse.failed') {
    console.error('⚠️ Malformed JSON body:', err.message);
    return res.status(400).json({ success: false, message: 'Yêu cầu JSON không hợp lệ', details: err.message });
  }

  console.error('❌ Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Lỗi server không xác định' });
});

// 🔹 404 HANDLER (Express 5 - không dùng '*')
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'API endpoint không tồn tại' });
});

const pushOrganizationToRedis = async () => {
  try {
    const org = await orgRepo.getSingleton();
    if (org) {
      await redisClient.set(ORG_CACHE_KEY, JSON.stringify(org), 'EX', 3600);
      console.log('✅ Organization cached to Redis');
    } else {
      // nếu chưa có organization, xóa key cũ (nếu có)
      await redisClient.del(ORG_CACHE_KEY);
      console.log('ℹ️ No Organization found — Redis key cleared');
    }
  } catch (err) {
    console.error('❌ Failed to push Organization to Redis:', err);
  }
};

// 🔹 START SERVER
const startServer = async () => {
  try {
    await connectDB();
    
    // Push organization info to Redis on each service start
    await pushOrganizationToRedis();
    
    app.listen(PORT, () => {
      console.log(`🏥 Organization Service đang chạy tại port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`📋 API docs: http://localhost:${PORT}/api/organization`);
    });
  } catch (error) {
    console.error('❌ Lỗi khởi động server:', error);
    process.exit(1);
  }
};

startServer();

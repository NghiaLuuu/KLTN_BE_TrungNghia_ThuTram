require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const redisClient = require('./config/redis.config');

// Import routes
const statisticRoutes = require('./routes/statistic.routes');

const app = express();

// Connect to database
connectDB();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Statistic Service đang hoạt động bình thường',
    timestamp: new Date().toISOString(),
    service: 'statistic-service',
    version: '1.0.0'
  });
});

// Routes
app.use('/api/statistics', statisticRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Lỗi server nội bộ',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint không tồn tại'
  });
});

const PORT = process.env.PORT || 3010;

app.listen(PORT, () => {
  console.log(`🚀 Statistic service đang chạy trên port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  
  // Test Redis connection
  redisClient.ping().then(() => {
    console.log('✅ Redis kết nối thành công');
  }).catch((err) => {
    console.error('❌ Redis kết nối thất bại:', err.message);
  });
});

module.exports = app;

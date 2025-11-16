// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const redisClient = require('./config/redis.config');

// Connect to database
connectDB();

// Import routes
const statisticRoutes = require('./routes/statistic.routes');

const app = express();

// Connect to database
// Middleware
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000'
    ].filter(Boolean).flatMap(o => o.split(',').map(s => s.trim())).filter(Boolean);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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

// 404 handler - must be at the end
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint không tồn tại'
  });
});

const PORT = process.env.PORT || 3011;

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

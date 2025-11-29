// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');
const startRPCServer = require('./utils/user.rpc'); 
const { startEmailConsumer } = require('./services/email.consumer'); // 🆕 Email consumer
const initAdminUser = require('./utils/initAdmin'); // 🆕 Admin initialization
const { initUserCache } = require('./services/user.service'); // 🆕 Cache initialization
const cors = require('cors');

// Connect to database and initialize admin user
connectDB().then(async () => {
  // Initialize default admin user after DB connection
  await initAdminUser();
  
  // Initialize user cache
  await initUserCache();
  
  // 🔄 CACHE WARMUP: Refresh cache mỗi 5 phút để tránh expire
  setInterval(async () => {
    try {
      console.log('🔄 Scheduled user cache warmup...');
      await initUserCache();
    } catch (error) {
      console.error('❌ User cache warmup failed:', error.message);
    }
  }, 5 * 60 * 1000); // 5 phút
});

const app = express();
app.use(express.json());

// CORS configuration with multiple origins support
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc)
    if (!origin) return callback(null, true);
    
    // Build flattened allowed origins list
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000',
      'https://smilecare.io.vn',
      'https://www.smilecare.io.vn'
    ]
      .filter(Boolean) // Remove undefined
      .flatMap(o => o.split(',').map(s => s.trim())) // Split comma-separated origins
      .filter(Boolean); // Remove empty strings
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked origin: ${origin}`);
      console.log(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires', 'X-Selected-Role']
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// ✅ Error handling middleware for Multer errors
app.use((err, req, res, next) => {
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Kích thước file vượt quá giới hạn 5MB. Vui lòng chọn file nhỏ hơn.'
      });
    }
    return res.status(400).json({
      success: false,
      message: `Lỗi upload file: ${err.message}`
    });
  }
  
  // Handle other errors
  if (err.message) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
  
  next(err);
});

// Khởi chạy RPC Server với retry
async function startRpcServerWithRetry(retries = 5, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await startRPCServer();
      console.log('✅ User RPC server started');
      return;
    } catch (err) {
      console.error(`❌ Failed to start User RPC server (attempt ${i + 1}/${retries}):`, err.message);
      if (i < retries - 1) {
        console.log(`⏳ Retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.5, 30000); // Exponential backoff, max 30s
      }
    }
  }
  console.error('❌ User RPC server failed to start after all retries');
}

startRpcServerWithRetry();

// 🆕 Khởi chạy Email Consumer
startEmailConsumer()
  .then(() => console.log('✅ Email consumer started'))
  .catch(err => console.error('❌ Failed to start Email consumer:', err));

// Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});

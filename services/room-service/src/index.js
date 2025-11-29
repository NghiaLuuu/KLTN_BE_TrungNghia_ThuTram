// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const connectDB = require('./config/db');
const roomRoutes = require('./routes/room.route');
const cors = require('cors');
const startRpcServer = require('./utils/room.rpc');
const { startScheduleConsumer } = require('./utils/scheduleConsumer');
const roomService = require('./services/room.service');

// Initialize database and cache
(async () => {
  await connectDB();
  // Initialize room cache after DB connection
  await roomService.initRoomCache();
  
  // 🔄 CACHE WARMUP: Refresh cache mỗi 5 phút để tránh expire
  setInterval(async () => {
    try {
      console.log('🔄 Scheduled cache warmup...');
      await roomService.initRoomCache();
    } catch (error) {
      console.error('❌ Cache warmup failed:', error.message);
    }
  }, 5 * 60 * 1000); // 5 phút
})();

// Start RabbitMQ RPC server
startRpcServer().catch(console.error);

// Start RabbitMQ consumer for schedule updates
startScheduleConsumer().catch(console.error);

const app = express();
app.use(express.json());
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
      console.warn('🚫 CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires', 'X-Selected-Role']
}));

// Routes
app.use('/api/room', roomRoutes);

// Server
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Room service running on port ${PORT}`);
});


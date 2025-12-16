const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const connectDB = require('./config/db');
const { connectRabbitMQ } = require('./utils/rabbitmq.client');
const { setupEventListeners } = require('./utils/eventListeners');
const { startConsumer } = require('./consumers/appointment.consumer');
const { initializeSocket } = require('./utils/socket');
const { setupQueueCronJobs } = require('./utils/queueCron');
const { startAllCronJobs } = require('./utils/cronJobs');
const startRpcServer = require('./utils/rpcServer');
const appointmentRoutes = require('./routes/appointment.route');

// Kết nối MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// 🔥 Khởi tạo Socket.IO
initializeSocket(server);

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
      console.warn('🚫 CORS chặn origin:', origin);
      callback(new Error('Không được phép bởi CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires', 'X-Selected-Role']
}));
app.use(express.urlencoded({ extended: true }));

// Đăng ký routes
app.use('/api/appointments', appointmentRoutes);

// Endpoint kiểm tra health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'appointment-service' });
});

const PORT = process.env.PORT || 3006;

/**
 * Khởi động server
 * Kết nối các services và bắt đầu lắng nghe requests
 */
async function startServer() {
  try {
    // Kết nối RabbitMQ
    await connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');
    console.log('✅ RabbitMQ đã kết nối');
    
    // ❌ ĐÃ TẮT: Sử dụng consumer mới event-driven thay thế
    // await setupEventListeners();
    // console.log('✅ Event listeners đã sẵn sàng');
    
    // ✅ Khởi động consumer RabbitMQ MỚI cho payment events (event-driven)
    await startConsumer();
    console.log('✅ Appointment consumer đã khởi động');
    
    // ✅ Khởi động RPC Server cho giao tiếp giữa các service
    await startRpcServer();
    console.log('✅ Appointment RPC Server đã khởi động');
    
    // 🔥 Khởi động queue cron jobs cho auto-start
    setupQueueCronJobs();
    
    // ✅ Khởi động cron jobs: auto-progress, auto-complete, cleanup expired locks
    startAllCronJobs();
    
    server.listen(PORT, () => {
      console.log(`✅ Appointment Service đang chạy trên port ${PORT}`);
      console.log(`🔌 Socket.IO sẵn sàng cho cập nhật hàng đợi realtime`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
    });
    
  } catch (err) {
    console.error('❌ Khởi động thất bại:', err);
    process.exit(1);
  }
}

startServer();

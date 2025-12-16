// Tải biến môi trường trước tiên
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const scheduleRoutes = require('./routes/schedule.route');
const slotRoutes = require('./routes/slot.route');
const scheduleConfigRoutes = require('./routes/scheduleConfig.route');
const dayClosureRoutes = require('./routes/dayClosure.route');
const startRpcServer = require('./utils/rpcServer');
const scheduleConfigService = require('./services/scheduleConfig.service');
const { setupEventListeners } = require('./utils/eventListeners');
const rabbitmqClient = require('./utils/rabbitmq.client');
const { startConsumer } = require('./consumers/schedule.consumer');
const redisClient = require('./utils/redis.client');

connectDB();


const app = express();

// Cấu hình CORS
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

// ✅ Tăng giới hạn kích thước body cho các thao tác hàng loạt (ví dụ: tạo lịch hàng loạt)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Các Routes
app.use('/api/schedule', scheduleRoutes);
app.use('/api/slot', slotRoutes);
app.use('/api/schedule/config', scheduleConfigRoutes);
app.use('/api/day-closure', dayClosureRoutes);

startRpcServer();

// 🔥 Xóa toàn bộ cache khi khởi động để đảm bảo dữ liệu mới
setTimeout(async () => {
  try {
    console.log('🧹 Đang xóa toàn bộ cache khi khởi động...');
    
    // Xóa cache lịch
    const calendarPattern = 'room_calendar:*';
    const calendarKeys = await redisClient.keys(calendarPattern);
    if (calendarKeys.length > 0) {
      await redisClient.del(calendarKeys);
      console.log(`✅ Đã xóa ${calendarKeys.length} khóa cache lịch`);
    }
    
    // Xóa cache cấu hình lịch trình
    const scheduleConfigKey = 'schedule_config_cache';
    const hasScheduleConfig = await redisClient.exists(scheduleConfigKey);
    if (hasScheduleConfig) {
      await redisClient.del(scheduleConfigKey);
      console.log(`✅ Đã xóa cache cấu hình lịch trình`);
    }
    
    // Xóa cache cấu hình ngày nghỉ
    const holidayConfigKey = 'holiday_config_cache';
    const hasHolidayConfig = await redisClient.exists(holidayConfigKey);
    if (hasHolidayConfig) {
      await redisClient.del(holidayConfigKey);
      console.log(`✅ Cleared holiday config cache`);
    }
    
    console.log('✅ Đã xóa toàn bộ cache khi khởi động');
  } catch (error) {
    console.error('❌ Lỗi khi xóa cache khi khởi động:', error.message);
  }
}, 1000); // Đợi 1 giây cho kết nối Redis

// 🆕 Tự động khởi tạo cấu hình mặc định và ngày nghỉ khi khởi động
setTimeout(async () => {
  await scheduleConfigService.autoInitializeDefaults();
}, 2000); // Đợi 2 giây cho kết nối DB sẵn sàng

// 🆕 Cài đặt bộ lắng nghe sự kiện RabbitMQ
setTimeout(async () => {
  await setupEventListeners();
}, 3000); // Đợi 3 giây sau khi DB sẵn sàng

// 🆕 Khởi động consumer RabbitMQ cho các sự kiện thanh toán
setTimeout(async () => {
  try {
    await rabbitmqClient.connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');
    console.log('✅ RabbitMQ connected');
    
    await startConsumer();
    console.log('✅ Consumer đã khởi động');
  } catch (err) {
    console.error('❌ Không thể khởi động consumer:', err);
  }
}, 4000); // Đợi 4 giây để đảm bảo RabbitMQ sẵn sàng

// Server


const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`Schedule service running on port ${PORT}`);
});


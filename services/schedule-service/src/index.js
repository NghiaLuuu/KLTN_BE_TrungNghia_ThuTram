// Load environment variables first
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

// CORS Configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// ✅ Increase body size limit for bulk operations (e.g., bulk create schedules)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// Routes
app.use('/api/schedule', scheduleRoutes);
app.use('/api/slot', slotRoutes);
app.use('/api/schedule/config', scheduleConfigRoutes);
app.use('/api/day-closure', dayClosureRoutes);

startRpcServer();

// 🔥 Clear all caches on startup to ensure fresh data
setTimeout(async () => {
  try {
    console.log('🧹 Clearing all caches on startup...');
    
    // Clear calendar cache
    const calendarPattern = 'room_calendar:*';
    const calendarKeys = await redisClient.keys(calendarPattern);
    if (calendarKeys.length > 0) {
      await redisClient.del(calendarKeys);
      console.log(`✅ Cleared ${calendarKeys.length} calendar cache keys`);
    }
    
    // Clear schedule config cache
    const scheduleConfigKey = 'schedule_config_cache';
    const hasScheduleConfig = await redisClient.exists(scheduleConfigKey);
    if (hasScheduleConfig) {
      await redisClient.del(scheduleConfigKey);
      console.log(`✅ Cleared schedule config cache`);
    }
    
    // Clear holiday config cache
    const holidayConfigKey = 'holiday_config_cache';
    const hasHolidayConfig = await redisClient.exists(holidayConfigKey);
    if (hasHolidayConfig) {
      await redisClient.del(holidayConfigKey);
      console.log(`✅ Cleared holiday config cache`);
    }
    
    console.log('✅ All caches cleared on startup');
  } catch (error) {
    console.error('❌ Error clearing caches on startup:', error.message);
  }
}, 1000); // Wait 1s for Redis connection

// 🆕 Auto-initialize default config and holidays on startup
setTimeout(async () => {
  await scheduleConfigService.autoInitializeDefaults();
}, 2000); // Wait 2s for DB connection to be ready

// 🆕 Setup RabbitMQ event listeners
setTimeout(async () => {
  await setupEventListeners();
}, 3000); // Wait 3s after DB is ready

// 🆕 Start RabbitMQ consumer for payment events
setTimeout(async () => {
  try {
    await rabbitmqClient.connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');
    console.log('✅ RabbitMQ connected');
    
    await startConsumer();
    console.log('✅ Consumer started');
  } catch (err) {
    console.error('❌ Failed to start consumer:', err);
  }
}, 4000); // Wait 4s to ensure RabbitMQ is ready

// Server


const PORT = process.env.PORT || 3005;
app.listen(PORT, () => {
  console.log(`Schedule service running on port ${PORT}`);
});


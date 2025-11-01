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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Routes
app.use('/api/schedule', scheduleRoutes);
app.use('/api/slot', slotRoutes);
app.use('/api/schedule/config', scheduleConfigRoutes);
app.use('/api/day-closure', dayClosureRoutes);

startRpcServer();

// 🔥 Clear calendar cache on startup to ensure fresh data
setTimeout(async () => {
  try {
    console.log('🧹 Clearing calendar cache on startup...');
    const pattern = 'room_calendar:*';
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`✅ Cleared ${keys.length} calendar cache keys on startup`);
    } else {
      console.log('✅ No calendar cache to clear on startup');
    }
  } catch (error) {
    console.error('❌ Error clearing calendar cache on startup:', error.message);
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


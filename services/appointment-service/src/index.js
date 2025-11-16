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
const appointmentRoutes = require('./routes/appointment.route');

connectDB();

const app = express();
const server = http.createServer(app);

// 🔥 Initialize Socket.IO
initializeSocket(server);

app.use(express.json());
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires']
}));
app.use(express.urlencoded({ extended: true }));

app.use('/api/appointments', appointmentRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'appointment-service' });
});

const PORT = process.env.PORT || 3006;

async function startServer() {
  try {
    await connectRabbitMQ(process.env.RABBITMQ_URL || 'amqp://localhost');
    console.log('✅ RabbitMQ connected');
    
    // ❌ COMMENTED OUT: Using new event-driven consumer instead
    // await setupEventListeners();
    // console.log('✅ Event listeners ready');
    
    // ✅ Start NEW RabbitMQ consumer for payment events (event-driven)
    await startConsumer();
    console.log('✅ Appointment consumer started');
    
    // 🔥 Start queue cron jobs for auto-start
    setupQueueCronJobs();
    
    // ✅ Start cron jobs: auto-progress, auto-complete, cleanup expired locks
    startAllCronJobs();
    
    server.listen(PORT, () => {
      console.log(`✅ Appointment Service running on port ${PORT}`);
      console.log(`🔌 Socket.IO ready for realtime queue updates`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
    });
    
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
}

startServer();

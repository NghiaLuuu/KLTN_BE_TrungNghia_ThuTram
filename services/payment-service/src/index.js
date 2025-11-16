// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const paymentRoutes = require('./routes/payment.route');
const startRpcServer = require('./utils/rpcServer');
const rabbitmqClient = require('./utils/rabbitmq.client');
const redisSubscriber = require('./utils/redis.subscriber'); // ✅ NEW
const { handlePaymentCreate, handleCashPaymentConfirm } = require('./utils/eventHandlers');

connectDB();
const redis = require('./utils/redis.client');

// Initialize RabbitMQ connection for event publishing
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
rabbitmqClient.connectRabbitMQ(RABBITMQ_URL)
  .then(() => {
    console.log('✅ RabbitMQ connected');
  })
  .catch(err => {
    console.error('❌ RabbitMQ connection failed:', err);
  });

// Initialize Express app
const app = express();

// Connect to Database
connectDB().then(() => {
  console.log('✅ Database connected');
}).catch(err => {
  console.error('❌ Database connection failed:', err);
  process.exit(1);
});

// Test Redis connection
redis.ping().then(() => {
  console.log('✅ Redis connected');
}).catch(err => {
  console.error('❌ Redis connection failed:', err);
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

// Compression middleware
app.use(compression());

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // limit each IP to 100 requests per windowMs in production
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limit for payment creation
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 50, // limit payment creation
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu tạo thanh toán, vui lòng thử lại sau'
  }
});

// Apply rate limiting
app.use(limiter);
app.use('/api/payment', paymentLimiter);

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  
  // ✅ Simplified logging - only critical endpoints
  if (req.path.includes('/vnpay') || req.path.includes('/payment')) {
    console.log(`📥 ${req.method} ${req.path}`);
    
    res.on('finish', () => {
      const duration = Date.now() - start;
      const statusEmoji = res.statusCode < 400 ? '✅' : '❌';
      console.log(`${statusEmoji} ${res.statusCode} - ${duration}ms`);
    });
  }
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const dbStatus = await require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Test Redis connection
    let redisStatus = 'disconnected';
    try {
      await redis.ping();
      redisStatus = 'connected';
    } catch (err) {
      redisStatus = 'error';
    }

    res.json({
      service: 'Payment Service',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: dbStatus,
      redis: redisStatus,
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      service: 'Payment Service',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes
app.use('/api/payments', paymentRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint không tồn tại',
    path: req.originalUrl
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('❌ Payment Service Error:', error);
  
  // CORS error
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS policy violation'
    });
  }

  // Validation error
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu không hợp lệ',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }

  // Mongoose duplicate key error
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu đã tồn tại',
      field: Object.keys(error.keyPattern)[0]
    });
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token đã hết hạn'
    });
  }

  // Default error
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Lỗi server nội bộ',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Start RPC Server
startRpcServer().then(() => {
  console.log('✅ RPC server started');
}).catch(err => {
  console.error('❌ RPC server failed:', err.message);
});

// ✅ NEW: Start Redis Subscriber for expired key events
redisSubscriber.start().then(() => {
  console.log('✅ Redis Subscriber started (listening for expired temporary payments)');
}).catch(err => {
  console.error('❌ Redis Subscriber failed:', err.message);
});

// ✅ NEW: Start RabbitMQ Event Listeners
async function startEventListeners() {
  try {
    await rabbitmqClient.connectRabbitMQ(RABBITMQ_URL);
    
    // Listen for payment.create events from record-service
    let eventCounter = 0;
    await rabbitmqClient.consumeQueue('payment_event_queue', async (message) => {
      eventCounter++;
      const { event, data } = message;
      const timestamp = new Date().toISOString();
      
      console.log(`\n📨 [${timestamp}] [Event #${eventCounter}] Received from payment_event_queue: ${event}`);
      console.log(`📦 RecordId: ${data?.recordId || 'N/A'}, RecordCode: ${data?.recordCode || 'N/A'}`);
      
      if (event === 'payment.create') {
        await handlePaymentCreate(message);
      } else if (event === 'payment.cash_confirm') {
        await handleCashPaymentConfirm(message);
      } else {
        console.warn(`⚠️ Unknown payment event: ${event}`);
      }
      
      console.log(`✅ [Event #${eventCounter}] Processing completed for ${event}\n`);
    });
    
    console.log('✅ RabbitMQ event listeners started');
    console.log('   - Listening on: payment_event_queue (async events)');
  } catch (error) {
    console.error('❌ Failed to start event listeners:', error);
  }
}

startEventListeners();

// Start HTTP Server
const PORT = process.env.PORT || 3007;
const server = app.listen(PORT, () => {
  console.log(`🚀 Payment Service:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    redisSubscriber.stop(); // Stop Redis subscriber
    console.log('💀 Payment Service process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    redisSubscriber.stop(); // Stop Redis subscriber
    console.log('💀 Payment Service process terminated');
    process.exit(0);
  });
});

module.exports = app;


// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

// ============ CONFIGURATIONS ============
const connectDB = require('./config/db');
const RedisClient = require('./config/redis.config');
const RPCClient = require('./config/rpc.config');

// ============ ROUTES ============
const invoiceRoutes = require('./routes/invoice.routes');
const invoiceDetailRoutes = require('./routes/invoiceDetail.routes');

// ============ SERVICES & UTILS ============
const startRpcServer = require('./utils/rpcServer');
const { setupEventListeners } = require('./utils/eventListeners');
const rabbitmqClient = require('./utils/rabbitmq.client');
const { startConsumer } = require('./consumers/invoice.consumer');

connectDB();
const invoiceService = require('./services/invoice.service');

// ============ INITIALIZE APPLICATION ============
async function initializeApp() {
  try {
    console.log('🚀 Starting Invoice Service...');

    // Connect to MongoDB
    await     // Connect to Redis
    await RedisClient.connect();

    // Connect RPC Client
    await RPCClient.connect();

    console.log('✅ All connections established');
  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    process.exit(1);
  }
}

// ============ EXPRESS APP SETUP ============
const app = express();

// Security middleware
app.use(helmet());
app.use(compression());

// CORS configuration
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'Expires', 'X-Selected-Role']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============ HEALTH CHECK ROUTES ============
app.get('/health', async (req, res) => {
  try {
    const dbStatus = { connected: true }; // Mongoose connection check
    const redisStatus = RedisClient.getStatus();
    const rpcStatus = RPCClient.getStatus();

    const health = {
      service: 'invoice-service',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: {
        database: dbStatus,
        redis: redisStatus,
        rpc: rpcStatus
      }
    };

    res.status(200).json(health);
  } catch (error) {
    res.status(500).json({
      service: 'invoice-service',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// ============ API ROUTES ============
app.use('/api/invoices', invoiceRoutes);
app.use('/api/invoice-details', invoiceDetailRoutes);

// Legacy routes for compatibility
app.use('/api/invoice', invoiceRoutes);
app.use('/api/invoiceDetail', invoiceDetailRoutes);

// ============ PAYMENT WEBHOOK ENDPOINTS ============
// Payment success webhook - chỉ tạo invoice khi payment thành công
app.post('/api/webhooks/payment-success', async (req, res) => {
  try {
    const paymentData = req.body;
    
    console.log('🔔 Payment success webhook received:', paymentData);

    // Validate payment status
    if (paymentData.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ xử lý thanh toán hoàn thành'
      });
    }

    // Create invoice from successful payment
    const invoice = await invoiceService.createInvoiceFromPayment(paymentData);

    console.log('✅ Invoice created from payment:', invoice.invoiceNumber);

    res.json({
      success: true,
      message: 'Tạo hóa đơn từ thanh toán thành công',
      data: {
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber
      }
    });
  } catch (error) {
    console.error('❌ Payment webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi xử lý webhook thanh toán',
      error: error.message
    });
  }
});

// Payment update webhook - cập nhật invoice khi có thanh toán mới
app.post('/api/webhooks/payment-update', async (req, res) => {
  try {
    const paymentData = req.body;
    
    console.log('🔔 Payment update webhook received:', paymentData);

    if (paymentData.status === 'completed' && paymentData.invoiceId) {
      // Update existing invoice with payment info
      const updatedInvoice = await invoiceService.handlePaymentSuccess(paymentData);
      
      console.log('✅ Invoice updated with payment:', updatedInvoice.invoiceNumber);

      res.json({
        success: true,
        message: 'Cập nhật hóa đơn với thanh toán mới',
        data: updatedInvoice
      });
    } else {
      res.json({
        success: true,
        message: 'Webhook nhận được nhưng không cần xử lý'
      });
    }
  } catch (error) {
    console.error('❌ Payment update webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi xử lý webhook cập nhật thanh toán',
      error: error.message
    });
  }
});

// ============ ERROR HANDLING ============
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint không tồn tại',
    path: req.originalUrl
  });
});

app.use((error, req, res, next) => {
  console.error('💥 Unhandled error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Lỗi máy chủ nội bộ',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// ============ GRACEFUL SHUTDOWN ============
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  
  try {
    await RedisClient.disconnect();
    await RPCClient.disconnect();
    console.log('✅ Connections closed gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  
  try {
    await RedisClient.disconnect();
    await RPCClient.disconnect();
    console.log('✅ Connections closed gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

// ============ START SERVER ============
async function startServer() {
  try {
    await initializeApp();
    
    // Start RPC Server for inter-service communication
    await startRpcServer();
    
    // Setup RabbitMQ event listeners
    setTimeout(async () => {
      await setupEventListeners();
    }, 3000); // Wait 3s after connections are ready
    
    // Start Invoice Consumer for payment events
    setTimeout(async () => {
      try {
        const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost';
        await rabbitmqClient.connectRabbitMQ(rabbitmqUrl);
        console.log('✅ RabbitMQ connected');
        
        await startConsumer();
        console.log('✅ Consumer started');
      } catch (error) {
        console.error('❌ Failed to start consumer:', error);
      }
    }, 4000); // Wait 4s to ensure RabbitMQ is ready
    
    const PORT = process.env.PORT || 3008;
    
    app.listen(PORT, () => {
      console.log(`🚀 Invoice Service running on port ${PORT}`);
      console.log(`📊 Health check available at http://localhost:${PORT}/health`);
      console.log(`📄 API Documentation: http://localhost:${PORT}/api/invoices`);
      console.log('🔄 Payment webhooks active - invoices created only after successful payments');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Initialize and start the server
startServer();


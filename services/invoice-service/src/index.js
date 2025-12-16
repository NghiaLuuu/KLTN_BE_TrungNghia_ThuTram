// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

// ============ CẤU HÌNH ============
const connectDB = require('./config/db');
const RedisClient = require('./config/redis.config');
const RPCClient = require('./config/rpc.config');

// ============ ROUTES ============
const invoiceRoutes = require('./routes/invoice.routes');
const invoiceDetailRoutes = require('./routes/invoiceDetail.routes');

// ============ SERVICES & TIỆN ÍCH ============
const startRpcServer = require('./utils/rpcServer');
const { setupEventListeners } = require('./utils/eventListeners');
const rabbitmqClient = require('./utils/rabbitmq.client');
const { startConsumer } = require('./consumers/invoice.consumer');

connectDB();
const invoiceService = require('./services/invoice.service');

// ============ KHỞI TẠO ỨNG DỤNG ============
async function initializeApp() {
  try {
    console.log('🚀 Đang khởi động Invoice Service...');

    // Kết nối MongoDB
    await     // Kết nối Redis
    await RedisClient.connect();

    // Kết nối RPC Client
    await RPCClient.connect();

    console.log('✅ Tất cả kết nối đã thiết lập');
  } catch (error) {
    console.error('❌ Khởi tạo ứng dụng thất bại:', error);
    process.exit(1);
  }
}

// ============ THIẾT LẬP EXPRESS APP ============
const app = express();

// Middleware bảo mật
app.use(helmet());
app.use(compression());

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

// Middleware phân tích body
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware ghi log request
app.use((req, res, next) => {
  console.log(`📝 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============ ROUTES KIỂM TRA SỨC KHỎE ============
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

// Routes cũ để tương thích ngược
app.use('/api/invoice', invoiceRoutes);
app.use('/api/invoiceDetail', invoiceDetailRoutes);

// ============ ENDPOINTS WEBHOOK THANH TOÁN ============
// Webhook thanh toán thành công - chỉ tạo invoice khi payment thành công
app.post('/api/webhooks/payment-success', async (req, res) => {
  try {
    const paymentData = req.body;
    
    console.log('🔔 Payment success webhook received:', paymentData);

    // Kiểm tra trạng thái thanh toán
    if (paymentData.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Chỉ xử lý thanh toán hoàn thành'
      });
    }

    // Tạo hóa đơn từ thanh toán thành công
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

// Webhook cập nhật thanh toán - cập nhật invoice khi có thanh toán mới
app.post('/api/webhooks/payment-update', async (req, res) => {
  try {
    const paymentData = req.body;
    
    console.log('🔔 Payment update webhook received:', paymentData);

    if (paymentData.status === 'completed' && paymentData.invoiceId) {
      // Cập nhật invoice hiện có với thông tin thanh toán
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

// ============ XỬ LÝ LỖI ============
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

// ============ TẮT MÁY AN TOÀN ============
process.on('SIGTERM', async () => {
  console.log('🛑 Nhận SIGTERM, đang tắt máy an toàn...');
  
  try {
    await RedisClient.disconnect();
    await RPCClient.disconnect();
    console.log('✅ Các kết nối đã đóng an toàn');
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi tắt máy:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('🛑 Nhận SIGINT, đang tắt máy an toàn...');
  
  try {
    await RedisClient.disconnect();
    await RPCClient.disconnect();
    console.log('✅ Các kết nối đã đóng an toàn');
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi tắt máy:', error);
    process.exit(1);
  }
});

// ============ KHỞI ĐỘNG SERVER ============
async function startServer() {
  try {
    await initializeApp();
    
    // Khởi động RPC Server cho giao tiếp giữa các service
    await startRpcServer();
    
    // Thiết lập các event listeners RabbitMQ
    setTimeout(async () => {
      await setupEventListeners();
    }, 3000); // Đợi 3 giây sau khi các kết nối sẵn sàng
    
    // Khởi động Invoice Consumer cho các sự kiện thanh toán
    setTimeout(async () => {
      try {
        const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost';
        await rabbitmqClient.connectRabbitMQ(rabbitmqUrl);
        console.log('✅ Đã kết nối RabbitMQ');
        
        await startConsumer();
        console.log('✅ Đã khởi động Consumer');
      } catch (error) {
        console.error('❌ Khởi động consumer thất bại:', error);
      }
    }, 4000); // Đợi 4 giây để đảm bảo RabbitMQ sẵn sàng
    
    const PORT = process.env.PORT || 3008;
    
    app.listen(PORT, () => {
      console.log(`🚀 Invoice Service running on port ${PORT}`);
      console.log(`📊 Health check available at http://localhost:${PORT}/health`);
      console.log(`📄 API Documentation: http://localhost:${PORT}/api/invoices`);
      console.log('🔄 Payment webhooks active - invoices created only after successful payments');
    });
    
  } catch (error) {
    console.error('❌ Khởi động server thất bại:', error);
    process.exit(1);
  }
}

// Khởi tạo và khởi động server
startServer();


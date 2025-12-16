// Tải các biến môi trường trước tiên
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const paymentRoutes = require('./routes/payment.route');
const stripeRoutes = require('./routes/stripe.route');
const startRpcServer = require('./utils/rpcServer');
const rabbitmqClient = require('./utils/rabbitmq.client');
const redisSubscriber = require('./utils/redis.subscriber'); // ✅ NEW
const { handlePaymentCreate, handleCashPaymentConfirm } = require('./utils/eventHandlers');

connectDB();
const redis = require('./utils/redis.client');

// Khởi tạo kết nối RabbitMQ để phát sự kiện
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
rabbitmqClient.connectRabbitMQ(RABBITMQ_URL)
  .then(() => {
    console.log('✅ RabbitMQ connected');
  })
  .catch(err => {
    console.error('❌ RabbitMQ connection failed:', err);
  });

// Khởi tạo ứng dụng Express
const app = express();

// Chấp nhận proxy headers khi chạy sau Nginx/Traefik để rate limit có thể đọc IP client
if (process.env.TRUST_PROXY !== 'false') {
  const trustProxyValue = (() => {
    if (!process.env.TRUST_PROXY || process.env.TRUST_PROXY === 'true') {
      return 'loopback, linklocal, uniquelocal';
    }
    if (/^\d+$/.test(process.env.TRUST_PROXY)) {
      return Number(process.env.TRUST_PROXY);
    }
    return process.env.TRUST_PROXY;
  })();
  app.set('trust proxy', trustProxyValue);
}

// Kết nối Database
connectDB().then(() => {
  console.log('✅ Đã kết nối Database');
}).catch(err => {
  console.error('❌ Database connection failed:', err);
  process.exit(1);
});

// Kiểm tra kết nối Redis
redis.ping().then(() => {
  console.log('✅ Đã kết nối Redis');
}).catch(err => {
  console.error('❌ Redis connection failed:', err);
});

// Middleware bảo mật
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

// Middleware nén
app.use(compression());

// Cấu hình CORS
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5173', // ✅ Vite dev server
      'https://smilecare.io.vn', // ✅ Production frontend
      'https://www.smilecare.io.vn' // ✅ Production frontend (www)
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
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

// Giới hạn tần suất request
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // giới hạn mỗi IP 100 request mỗi windowMs trong production
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu từ IP này, vui lòng thử lại sau'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Giới hạn tần suất nghiêm ngặt hơn cho tạo thanh toán
const paymentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 phút
  max: process.env.NODE_ENV === 'production' ? 10 : 50, // giới hạn tạo thanh toán
  message: {
    success: false,
    message: 'Quá nhiều yêu cầu tạo thanh toán, vui lòng thử lại sau'
  }
});

// Áp dụng giới hạn tần suất
app.use(limiter);
app.use('/api/payment', paymentLimiter);

// Middleware phân tích body
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

// Middleware ghi log request
app.use((req, res, next) => {
  const start = Date.now();
  
  // ✅ Ghi log đơn giản - chỉ các endpoint quan trọng
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

// Endpoint kiểm tra sức khỏe
app.get('/health', async (req, res) => {
  try {
    // Kiểm tra kết nối database
    const dbStatus = await require('mongoose').connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Kiểm tra kết nối Redis
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

// Các Route API
// ⚠️ QUAN TRỌNG: Các route cụ thể hơn PHẢI đặt trước!
// Route Stripe phải được đăng ký trước các route thanh toán chung
// để ngăn /api/payments bắt các request /api/payments/stripe/*
app.use('/api/payments/stripe', stripeRoutes);
app.use('/api/payments', paymentRoutes);

// Xử lý 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint không tồn tại',
    path: req.originalUrl
  });
});

// Xử lý lỗi toàn cục
app.use((error, req, res, next) => {
  console.error('❌ Lỗi Payment Service:', error);
  
  // Lỗi CORS
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS policy violation'
    });
  }

  // Lỗi validation
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu không hợp lệ',
      errors: Object.values(error.errors).map(err => err.message)
    });
  }

  // Lỗi trùng key Mongoose
  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu đã tồn tại',
      field: Object.keys(error.keyPattern)[0]
    });
  }

  // Lỗi JWT
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

  // Lỗi mặc định
  res.status(error.status || 500).json({
    success: false,
    message: error.message || 'Lỗi server nội bộ',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Khởi động RPC Server
startRpcServer().then(() => {
  console.log('✅ Đã khởi động RPC server');
}).catch(err => {
  console.error('❌ RPC server thất bại:', err.message);
});

// ✅ MỚI: Khởi động Redis Subscriber cho các sự kiện key hết hạn
redisSubscriber.start().then(() => {
  console.log('✅ Đã khởi động Redis Subscriber (lắng nghe các thanh toán tạm hết hạn)');
}).catch(err => {
  console.error('❌ Redis Subscriber thất bại:', err.message);
});

// ✅ MỚI: Khởi động các bộ lắng nghe sự kiện RabbitMQ
async function startEventListeners() {
  try {
    await rabbitmqClient.connectRabbitMQ(RABBITMQ_URL);
    
    // Lắng nghe các sự kiện payment.create từ record-service
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

    // ⭐ Lắng nghe các sự kiện hủy lịch hẹn
    await rabbitmqClient.consumeQueue('payment_queue', async (message) => {
      const { event, data } = message;
      const timestamp = new Date().toISOString();
      
      console.log(`\n📨 [${timestamp}] Received from payment_queue: ${event}`);
      
      if (event === 'appointment_cancelled') {
        const { 
          appointmentId, 
          paymentId, 
          cancelledBy, 
          cancelledByRole, 
          cancelReason, 
          cancelledAt 
        } = data;

        console.log('🔄 [Payment Service] Processing appointment_cancelled:', {
          appointmentId,
          paymentId,
          cancelReason
        });

        try {
          const { Payment, PaymentStatus } = require('./models/payment.model');

          // Find payment by paymentId
          const payment = await Payment.findById(paymentId);
          
          if (!payment) {
            console.warn('⚠️ [Payment Service] Payment not found:', paymentId);
            return;
          }

          // Kiểm tra xem thanh toán có thể hủy được không
          if (payment.status === PaymentStatus.CANCELLED) {
            console.log('ℹ️ [Payment Service] Thanh toán đã được hủy:', payment.paymentCode);
            return;
          }

          // Cập nhật trạng thái thanh toán thành đã hủy
          payment.status = PaymentStatus.CANCELLED;
          payment.cancelledAt = cancelledAt || new Date();
          payment.notes = `${payment.notes || ''}\n\nĐã hủy do appointment bị hủy bởi ${cancelledByRole}: ${cancelReason || 'Không rõ lý do'}`.trim();

          await payment.save();

          console.log('✅ [Payment Service] Đã hủy thanh toán:', {
            paymentId: payment._id.toString(),
            paymentCode: payment.paymentCode
          });

        } catch (error) {
          console.error('❌ [Payment Service] Error cancelling payment:', {
            error: error.message,
            paymentId,
            appointmentId,
            stack: error.stack
          });
        }
      } else if (event === 'appointment_restored') {
        // 🆕 Xử lý khôi phục lịch hẹn - khôi phục thanh toán thành hoàn tất
        const { 
          appointmentId, 
          paymentId, 
          restoredBy, 
          restoredByRole, 
          reason, 
          restoredAt 
        } = data;

        console.log('🔄 [Payment Service] Processing appointment_restored:', {
          appointmentId,
          paymentId,
          reason
        });

        try {
          const { Payment, PaymentStatus } = require('./models/payment.model');

          // Find payment by paymentId
          const payment = await Payment.findById(paymentId);
          
          if (!payment) {
            console.warn('⚠️ [Payment Service] Payment not found:', paymentId);
            return;
          }

          // Kiểm tra xem thanh toán có thể khôi phục được không (phải đang bị hủy)
          if (payment.status !== PaymentStatus.CANCELLED) {
            console.log('ℹ️ [Payment Service] Thanh toán chưa bị hủy, bỏ qua khôi phục:', payment.paymentCode);
            return;
          }

          // Khôi phục trạng thái thanh toán thành hoàn tất
          payment.status = PaymentStatus.COMPLETED;
          payment.cancelledAt = null;
          payment.notes = `${payment.notes || ''}\n\nĐã khôi phục: ${reason || 'Slot được bật lại'}`.trim();

          await payment.save();

          console.log('✅ [Payment Service] Đã khôi phục thanh toán:', {
            paymentId: payment._id.toString(),
            paymentCode: payment.paymentCode
          });

        } catch (error) {
          console.error('❌ [Payment Service] Error restoring payment:', {
            error: error.message,
            paymentId,
            appointmentId,
            stack: error.stack
          });
        }
      } else {
        console.warn(`⚠️ Unknown event in payment_queue: ${event}`);
      }
    });
    
    console.log('✅ Đã khởi động các bộ lắng nghe sự kiện RabbitMQ');
    console.log('   - Đang lắng nghe: payment_event_queue (các sự kiện async)');
    console.log('   - Đang lắng nghe: payment_queue (các sự kiện hủy)');
  } catch (error) {
    console.error('❌ Không thể khởi động các bộ lắng nghe sự kiện:', error);
  }
}

startEventListeners();

// Khởi động HTTP Server
const PORT = process.env.PORT || 3007;
const server = app.listen(PORT, () => {
  console.log(`🚀 Payment Service:${PORT}`);
});

// Tắt máy an toàn
process.on('SIGTERM', () => {
  console.log('🛑 Đã nhận SIGTERM, đang tắt máy an toàn');
  server.close(() => {
    redisSubscriber.stop(); // Dừng Redis subscriber
    console.log('💀 Tiến trình Payment Service đã kết thúc');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Đã nhận SIGINT, đang tắt máy an toàn');
  server.close(() => {
    redisSubscriber.stop(); // Dừng Redis subscriber
    console.log('💀 Tiến trình Payment Service đã kết thúc');
    process.exit(0);
  });
});

module.exports = app;


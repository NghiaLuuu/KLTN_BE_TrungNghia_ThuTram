// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');
const startRPCServer = require('./utils/user.rpc'); 
const { startEmailConsumer } = require('./services/email.consumer'); // 🆕 Email consumer
const initAdminUser = require('./utils/initAdmin'); // 🆕 Admin initialization
const cors = require('cors');

// Connect to database and initialize admin user
connectDB().then(async () => {
  // Initialize default admin user after DB connection
  await initAdminUser();
});

const app = express();
app.use(express.json());

// CORS configuration with multiple origins support
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc)
    if (!origin) return callback(null, true);
    
    // Build flattened allowed origins list
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
      'http://localhost:5173',
      'http://localhost:3000'
    ]
      .filter(Boolean) // Remove undefined
      .flatMap(o => o.split(',').map(s => s.trim())) // Split comma-separated origins
      .filter(Boolean); // Remove empty strings
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS blocked origin: ${origin}`);
      console.log(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);

// Khởi chạy RPC Server
startRPCServer()
  .then(() => console.log('✅ User RPC server started'))
  .catch(err => console.error('❌ Failed to start User RPC server:', err));

// 🆕 Khởi chạy Email Consumer
startEmailConsumer()
  .then(() => console.log('✅ Email consumer started'))
  .catch(err => console.error('❌ Failed to start Email consumer:', err));

// Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});

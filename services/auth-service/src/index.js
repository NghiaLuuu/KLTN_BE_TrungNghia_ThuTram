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
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
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

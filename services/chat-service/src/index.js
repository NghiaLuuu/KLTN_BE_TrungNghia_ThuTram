// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const http = require('http');

connectDB();
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./config/db');
const chatRoutes = require('./routes/chat.routes');
const SocketHandler = require('./socket/socketHandler');
const rabbitmqListener = require('./utils/rabbitmq');

const app = express();
const server = http.createServer(app);

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Chat Service is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes
app.use('/api/chat', chatRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Socket.IO setup
const io = socketIo(server, {
  cors: {
    origin: process.env.SOCKET_CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Initialize Socket.IO handler
const socketHandler = new SocketHandler(io);

// Connect to database (optional for testing)
if (process.env.NODE_ENV !== 'test') {
    // Connect to RabbitMQ (optional for testing)
  rabbitmqListener.connect();
}

const PORT = process.env.PORT || 3012;

server.listen(PORT, () => {
  console.log(`🚀 Chat Service is running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💬 Socket.IO enabled for real-time messaging`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  
  // Close Socket.IO
  io.close();
  
  // Close RabbitMQ connection
  await rabbitmqListener.disconnect();
  
  // Close HTTP server
  server.close(() => {
    console.log('✅ Chat Service stopped');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  
  // Close Socket.IO
  io.close();
  
  // Close RabbitMQ connection
  await rabbitmqListener.disconnect();
  
  // Close HTTP server
  server.close(() => {
    console.log('✅ Chat Service stopped');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = { app, server, io };
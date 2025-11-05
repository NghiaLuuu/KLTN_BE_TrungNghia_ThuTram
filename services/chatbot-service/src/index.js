// Load environment variables first
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

// Import routes
const chatbotRoutes = require('./routes/chatbot.route');

const app = express();
const PORT = process.env.PORT || 3013;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB connection
const connectDB = async () => {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!MONGODB_URI) {
      console.warn('⚠️  MongoDB URI not found, running without database');
      return;
    }
    
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
  }
};

connectDB();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'chatbot-service',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'SmileCare AI Chatbot Service',
    version: '1.0.0',
    status: 'Running',
    endpoints: {
      chat: 'POST /api/ai/chat',
      history: 'GET /api/ai/history',
      clearHistory: 'DELETE /api/ai/history'
    }
  });
});

// Chatbot routes
app.use('/api/ai', chatbotRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

app.listen(PORT, () => {
  console.log(`🤖 Chatbot Service running on port ${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api/ai/chat`);
});
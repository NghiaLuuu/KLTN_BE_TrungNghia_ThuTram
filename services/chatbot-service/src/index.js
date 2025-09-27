// Load environment variables first
const dotenv = require('dotenv');
dotenv.config();
require('dotenv').config();
const express = require('express');
const cors = require('cors');

connectDB();

const app = express();
const PORT = process.env.PORT || 3013;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'chatbot-service',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Dental Clinic Chatbot Service',
    version: '1.0.0',
    status: 'Running'
  });
});

// Chatbot endpoint (placeholder)
app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  
  // Simple chatbot response (placeholder)
  res.json({
    success: true,
    response: `Xin chào! Tôi là chatbot của phòng khám nha khoa. Bạn có thể hỏi tôi về dịch vụ, lịch hẹn hoặc thông tin khác.`,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`Chatbot Service running on port ${PORT}`);
});
const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { uploadSingle, uploadMultiple } = require('../middlewares/upload.middleware');

// Simple auth middleware (check if user exists in request)
const simpleAuth = (req, res, next) => {
  // For now, accept any request with userId in body or create a default user
  if (!req.user) {
    req.user = {
      userId: req.body.userId || 'anonymous_user'
    };
  }
  next();
};

// Chat endpoints
router.post('/chat', simpleAuth, chatbotController.sendMessage);
router.get('/history', simpleAuth, chatbotController.getChatHistory);
router.delete('/history', simpleAuth, chatbotController.clearHistory);

// Image analysis endpoints
router.post('/analyze-image', simpleAuth, uploadSingle, chatbotController.analyzeImage);
router.post('/analyze-multiple-images', simpleAuth, uploadMultiple, chatbotController.analyzeMultipleImages);

// Smart Query endpoint (AI-powered MongoDB query)
router.post('/smart-query', simpleAuth, chatbotController.smartQuery);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'AI Chatbot',
    status: 'running'
  });
});

module.exports = router;

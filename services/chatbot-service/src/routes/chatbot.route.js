const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { uploadSingle, uploadMultiple } = require('../middlewares/upload.middleware');
const { rateLimiterMiddleware } = require('../middlewares/rateLimiter.middleware');
const jwt = require('jsonwebtoken');

// Optional auth middleware - Try JWT first, fallback to body or anonymous
const optionalAuth = (req, res, next) => {
  try {
    // Try to get token from header
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        req.user = {
          userId: decoded.userId || decoded.id,
          role: decoded.role,
          email: decoded.email
        };
        console.log('✅ Authenticated user:', req.user.userId);
        return next();
      } catch (error) {
        console.warn('⚠️ Invalid token, falling back to body userId');
      }
    }
    
    // Fallback: Use userId from body or anonymous
    req.user = {
      userId: req.body.userId || 'anonymous'
    };
    console.log('ℹ️ Unauthenticated request, userId:', req.user.userId);
    next();
  } catch (error) {
    console.error('❌ Optional auth error:', error);
    req.user = { userId: 'anonymous' };
    next();
  }
};

// Chat endpoints (with rate limiting)
router.post('/chat', optionalAuth, rateLimiterMiddleware, (req, res) => chatbotController.sendMessage(req, res));
router.get('/history', optionalAuth, (req, res) => chatbotController.getChatHistory(req, res));
router.delete('/history', optionalAuth, (req, res) => chatbotController.clearHistory(req, res));

// Image analysis endpoints
router.post('/analyze-image', optionalAuth, uploadSingle, (req, res) => chatbotController.analyzeImage(req, res));
router.post('/analyze-multiple-images', optionalAuth, uploadMultiple, (req, res) => chatbotController.analyzeMultipleImages(req, res));

// Smart Query endpoint (AI-powered MongoDB query)
router.post('/smart-query', optionalAuth, (req, res) => chatbotController.smartQuery(req, res));

// Booking endpoints (Chat-based booking flow)
router.post('/booking/start', optionalAuth, (req, res) => chatbotController.startBooking(req, res));
router.post('/booking/get-dentists', optionalAuth, (req, res) => chatbotController.getBookingDentists(req, res));
router.post('/booking/get-slots', optionalAuth, (req, res) => chatbotController.getBookingSlots(req, res));
router.post('/booking/confirm', optionalAuth, (req, res) => chatbotController.confirmBooking(req, res));

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'AI Chatbot',
    status: 'running'
  });
});

module.exports = router;

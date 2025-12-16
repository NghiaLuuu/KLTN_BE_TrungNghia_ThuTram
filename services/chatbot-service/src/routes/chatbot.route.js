const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbot.controller');
const { uploadSingle, uploadMultiple } = require('../middlewares/upload.middleware');
const { rateLimiterMiddleware } = require('../middlewares/rateLimiter.middleware');
const jwt = require('jsonwebtoken');

// Middleware xác thực tùy chọn - Thử JWT trước, fallback về body hoặc anonymous
const optionalAuth = (req, res, next) => {
  try {
    // Thử lấy token từ header
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
        console.log('✅ User đã xác thực:', req.user.userId);
        return next();
      } catch (error) {
        console.warn('⚠️ Token không hợp lệ, fallback về body userId');
      }
    }
    
    // Fallback: Sử dụng userId từ body hoặc anonymous
    req.user = {
      userId: req.body.userId || 'anonymous'
    };
    console.log('ℹ️ Request chưa xác thực, userId:', req.user.userId);
    next();
  } catch (error) {
    console.error('❌ Lỗi xác thực tùy chọn:', error);
    req.user = { userId: 'anonymous' };
    next();
  }
};

// Các endpoint Chat (có giới hạn tọn suất)
router.post('/chat', optionalAuth, rateLimiterMiddleware, (req, res) => chatbotController.sendMessage(req, res));
router.get('/history', optionalAuth, (req, res) => chatbotController.getChatHistory(req, res));
router.delete('/history', optionalAuth, (req, res) => chatbotController.clearHistory(req, res));

// Các endpoint phân tích ảnh
router.post('/analyze-image', optionalAuth, uploadSingle, (req, res) => chatbotController.analyzeImage(req, res));
router.post('/analyze-multiple-images', optionalAuth, uploadMultiple, (req, res) => chatbotController.analyzeMultipleImages(req, res));

// Endpoint Smart Query (truy vấn MongoDB bằng AI)
router.post('/smart-query', optionalAuth, (req, res) => chatbotController.smartQuery(req, res));

// Các endpoint Đặt lịch (luồng đặt lịch qua Chat)
router.post('/booking/start', optionalAuth, (req, res) => chatbotController.startBooking(req, res));
router.post('/booking/get-dentists', optionalAuth, (req, res) => chatbotController.getBookingDentists(req, res));
router.post('/booking/get-slots', optionalAuth, (req, res) => chatbotController.getBookingSlots(req, res));
router.post('/booking/confirm', optionalAuth, (req, res) => chatbotController.confirmBooking(req, res));

// Kiểm tra sức khỏe
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'AI Chatbot',
    status: 'running'
  });
});

module.exports = router;

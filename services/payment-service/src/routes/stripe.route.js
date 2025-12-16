const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripe.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ============ CÁC ROUTE CÔNG KHAI ============

/**
 * Lấy Stripe publishable key (cho frontend)
 * GET /api/payments/stripe/config
 */
router.get('/config', stripeController.getConfig);

/**
 * Endpoint Webhook của Stripe (Yêu cầu raw body)
 * POST /api/payments/stripe/webhook
 * QUAN TRỌNG: Route này KHÔNG ĐƯỢC sử dụng middleware express.json()
 * Raw body là bắt buộc để xác minh chữ ký
 */
router.post('/webhook', 
  express.raw({ type: 'application/json' }),
  stripeController.handleWebhook
);

/**
 * Xác minh checkout session (cho frontend/debug)
 * GET /api/payments/stripe/verify-session/:sessionId
 */
router.get('/verify-session/:sessionId', 
  stripeController.verifySession
);

/**
 * Tạo liên kết thanh toán Stripe (theo kiểu VNPay)
 * POST /api/payments/stripe/create-payment-link
 * Body: { orderId, amount, orderInfo, customerEmail?, metadata? }
 * CÔNG KHAI: Không cần xác thực (giống VNPay)
 */
router.post('/create-payment-link',
  stripeController.createPaymentLink
);

// Endpoint cũ để tương thích ngược
router.post('/create-session',
  stripeController.createPaymentLink
);

// ============ CÁC ROUTE CẦN XÁC THỰC (cho các tính năng tương lai) ============
// router.use(authMiddleware);

module.exports = router;

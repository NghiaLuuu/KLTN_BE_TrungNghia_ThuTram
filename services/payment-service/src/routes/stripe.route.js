const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripe.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ============ PUBLIC ROUTES ============

/**
 * Get Stripe publishable key (for frontend)
 * GET /api/payments/stripe/config
 */
router.get('/config', stripeController.getConfig);

/**
 * Stripe Webhook Endpoint (Raw body required)
 * POST /api/payments/stripe/webhook
 * IMPORTANT: This route must NOT use express.json() middleware
 * The raw body is required for signature verification
 */
router.post('/webhook', 
  express.raw({ type: 'application/json' }),
  stripeController.handleWebhook
);

/**
 * Verify checkout session (for frontend/debugging)
 * GET /api/payments/stripe/verify-session/:sessionId
 */
router.get('/verify-session/:sessionId', 
  stripeController.verifySession
);

/**
 * Create Stripe Payment Link (VNPay-style)
 * POST /api/payments/stripe/create-payment-link
 * Body: { orderId, amount, orderInfo, customerEmail?, metadata? }
 * PUBLIC: No auth required (same as VNPay)
 */
router.post('/create-payment-link',
  stripeController.createPaymentLink
);

// Legacy endpoint for backward compatibility
router.post('/create-session',
  stripeController.createPaymentLink
);

// ============ AUTHENTICATED ROUTES (for future features) ============
// router.use(authMiddleware);

module.exports = router;

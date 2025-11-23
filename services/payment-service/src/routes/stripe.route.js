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
 * Verify checkout session (for frontend callback after payment)
 * GET /api/payments/stripe/verify-session/:sessionId
 */
router.get('/verify-session/:sessionId', 
  stripeController.verifySession
);

// ============ AUTHENTICATED ROUTES ============

/**
 * Create Stripe Checkout Session
 * POST /api/payments/stripe/create-session
 * Body: { orderId, amount, orderInfo, customerEmail?, metadata? }
 */
router.post('/create-session',
  authMiddleware, // Optional: can be removed if patients don't need to be logged in
  stripeController.createCheckoutSession
);

/**
 * Get session details (for admin/debugging)
 * GET /api/payments/stripe/session/:sessionId
 */
router.get('/session/:sessionId',
  authMiddleware,
  stripeController.getSessionDetails
);

module.exports = router;

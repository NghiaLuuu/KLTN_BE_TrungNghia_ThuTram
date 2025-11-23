const stripeService = require('../services/stripe.service');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class StripeController {
  /**
   * Create Stripe Checkout Session
   * POST /api/payments/stripe/create-session
   * Body: { orderId, amount, orderInfo, customerEmail?, metadata? }
   */
  async createCheckoutSession(req, res) {
    try {
      console.log('🟣 [Stripe Controller] Create checkout session request:', {
        body: req.body,
        user: req.user
      });

      const { orderId, amount, orderInfo, customerEmail, metadata } = req.body;

      // Validation
      if (!orderId || !amount) {
        return res.status(400).json({
          success: false,
          message: 'orderId và amount là bắt buộc'
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Số tiền phải lớn hơn 0'
        });
      }

      // Create checkout session
      const result = await stripeService.createCheckoutSession(
        orderId,
        amount,
        orderInfo || `Thanh toán dịch vụ nha khoa - ${orderId}`,
        customerEmail,
        {
          ...metadata,
          userId: req.user?.userId,
          userRole: req.user?.role
        }
      );

      console.log('✅ [Stripe Controller] Checkout session created:', result);

      res.status(200).json({
        success: true,
        message: 'Tạo Stripe checkout session thành công',
        data: result
      });

    } catch (error) {
      console.error('❌ [Stripe Controller] Error creating checkout session:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo Stripe checkout session'
      });
    }
  }

  /**
   * Handle Stripe Webhook
   * POST /api/payments/stripe/webhook
   * Raw body required for signature verification
   */
  async handleWebhook(req, res) {
    try {
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.error('❌ [Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured');
        return res.status(500).json({
          success: false,
          message: 'Webhook secret not configured'
        });
      }

      let event;

      try {
        // Verify webhook signature
        event = stripe.webhooks.constructEvent(
          req.body, // Raw body buffer
          sig,
          webhookSecret
        );
      } catch (err) {
        console.error('❌ [Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).json({
          success: false,
          message: `Webhook signature verification failed: ${err.message}`
        });
      }

      console.log('🟣 [Stripe Webhook] Event received:', event.type);

      // Handle the event
      const result = await stripeService.handleWebhookEvent(event);

      res.status(200).json({
        success: true,
        received: true,
        ...result
      });

    } catch (error) {
      console.error('❌ [Stripe Webhook] Error handling webhook:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi xử lý Stripe webhook'
      });
    }
  }

  /**
   * Verify checkout session (for frontend callback)
   * GET /api/payments/stripe/verify-session/:sessionId
   */
  async verifySession(req, res) {
    try {
      const { sessionId } = req.params;

      console.log('🟣 [Stripe Controller] Verify session:', sessionId);

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID is required'
        });
      }

      const result = await stripeService.verifySession(sessionId);

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('❌ [Stripe Controller] Error verifying session:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi xác thực session'
      });
    }
  }

  /**
   * Get session details (for debugging/admin)
   * GET /api/payments/stripe/session/:sessionId
   */
  async getSessionDetails(req, res) {
    try {
      const { sessionId } = req.params;

      console.log('🟣 [Stripe Controller] Get session details:', sessionId);

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          message: 'Session ID is required'
        });
      }

      const result = await stripeService.getSessionDetails(sessionId);

      res.status(200).json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('❌ [Stripe Controller] Error getting session details:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thông tin session'
      });
    }
  }

  /**
   * Get Stripe publishable key (for frontend)
   * GET /api/payments/stripe/config
   */
  async getConfig(req, res) {
    try {
      res.status(200).json({
        success: true,
        data: {
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
        }
      });
    } catch (error) {
      console.error('❌ [Stripe Controller] Error getting config:', error);
      res.status(500).json({
        success: false,
        message: 'Lỗi lấy cấu hình Stripe'
      });
    }
  }
}

module.exports = new StripeController();

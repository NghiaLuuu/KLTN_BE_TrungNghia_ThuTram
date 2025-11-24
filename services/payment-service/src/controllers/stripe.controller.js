const stripeService = require('../services/stripe.service');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const redis = require('../utils/redis.client');

class StripeController {
  /**
   * Create Stripe Payment Link (VNPay-style)
   * POST /api/payments/stripe/create-payment-link
   * Body: { orderId, amount, orderInfo, customerEmail?, metadata? }
   */
  async createPaymentLink(req, res) {
    try {
      console.log('🟣 [Stripe Controller] Create payment link request:', {
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

      // Create payment link (VNPay-style)
      const userRole = req.user?.role || metadata?.userRole || 'patient';
      
      const result = await stripeService.createPaymentLink(
        orderId,
        amount,
        orderInfo || `Thanh toán dịch vụ nha khoa - ${orderId}`,
        customerEmail,
        {
          ...metadata,
          userId: req.user?.userId,
          userRole: userRole
        },
        userRole
      );

      console.log('✅ [Stripe Controller] Payment link created:', result);

      res.status(200).json({
        success: true,
        message: 'Tạo Stripe payment link thành công',
        data: result
      });

    } catch (error) {
      console.error('❌ [Stripe Controller] Error creating payment link:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo Stripe payment link'
      });
    }
  }

  /**
   * Handle Stripe Callback/Return (VNPay-style)
   * GET /api/payments/return/stripe?session_id={CHECKOUT_SESSION_ID}&status={success|cancel}
   */
  async handleCallback(req, res) {
    try {
      const { session_id, status } = req.query;

      console.log('🟣 [Stripe Callback] Handling callback:', { session_id, status });

      if (!session_id || !status) {
        return res.status(400).json({
          success: false,
          message: 'session_id và status là bắt buộc'
        });
      }

      // Process callback (VNPay-style)
      const result = await stripeService.processCallback(session_id, status);

      // Get user role from Redis to determine redirect URL (SAME AS VNPAY)
      const orderId = result.paymentCode || result.orderId;
      const roleKey = `payment:role:${orderId}`;
      let userRole = await redis.get(roleKey);
      
      // Clean up role from Redis immediately after getting it
      // This prevents memory leaks and ensures one-time use
      if (userRole) {
        await redis.del(roleKey);
        console.log('🧹 [Stripe] Cleaned up role from Redis:', roleKey);
      }
      
      console.log('='.repeat(60));
      console.log('🎯 [Stripe Return] REDIRECT DEBUG INFO');
      console.log('='.repeat(60));
      console.log('📋 Order ID:', orderId);
      console.log('🔑 Redis Key:', roleKey);
      console.log('👤 User Role from Redis:', userRole);
      console.log('📊 Role Type:', typeof userRole);
      console.log('❓ Is null/undefined?:', userRole === null || userRole === undefined);
      
      // Default to patient if not found
      if (!userRole) {
        console.log('⚠️  No role found in Redis, defaulting to patient');
        userRole = 'patient';
      }
      
      // Determine redirect path based on role (SAME AS VNPAY)
      // Always redirect to payment result page, let frontend handle role-based redirect
      let redirectPath = '/patient/payment/result';
      
      console.log('🔗 Redirect Path:', redirectPath);
      console.log('👤 User Role (stored):', userRole);
      console.log('ℹ️  Frontend will handle role-based redirect after login check');
      console.log('='.repeat(60));
      
      // Redirect to frontend with result
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      
      if (status === 'success' && result._id) {
        // Success - redirect to result page (SAME AS VNPAY)
        const redirectUrl = `${frontendUrl}${redirectPath}?payment=success&orderId=${orderId}`;
        console.log('✅ [Stripe Callback] Payment successful, redirecting:', redirectUrl);
        return res.redirect(redirectUrl);
      } else {
        // Cancel/failure - redirect to result page (SAME AS VNPAY)
        const redirectUrl = `${frontendUrl}${redirectPath}?payment=failed&orderId=${orderId}&method=stripe`;
        console.log('⏰ [Stripe Callback] Payment cancelled, redirecting:', redirectUrl);
        return res.redirect(redirectUrl);
      }

    } catch (error) {
      console.error('❌ [Stripe Callback] Error handling callback:', error);
      console.error('❌ [Stripe Callback] Error stack:', error.stack);
      console.error('❌ [Stripe Callback] Error message:', error.message);
      
      // Redirect to error page (SAME AS VNPAY)
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const errorMessage = encodeURIComponent(error.message || 'Unknown error');
      const redirectUrl = `${frontendUrl}/patient/payment/result?payment=error&error=${errorMessage}`;
      return res.redirect(redirectUrl);
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

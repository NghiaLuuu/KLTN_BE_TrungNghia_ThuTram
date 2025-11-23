const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Payment = require('../models/payment.model');
const redis = require('../utils/redis.client');
const { publishEvent } = require('../utils/rabbitmq.client');

class StripeService {
  /**
   * Create Stripe Checkout Session
   * @param {string} orderId - Reservation/appointment ID
   * @param {number} amount - Amount in VND
   * @param {string} orderInfo - Description
   * @param {string} customerEmail - Customer email (optional)
   * @param {object} metadata - Additional metadata
   * @returns {Promise<object>} - { sessionId, checkoutUrl }
   */
  async createCheckoutSession(orderId, amount, orderInfo, customerEmail = null, metadata = {}) {
    try {
      console.log('🟣 [Stripe Service] Creating checkout session:', {
        orderId,
        amount,
        orderInfo,
        customerEmail,
        metadata
      });

      // Convert VND to USD (approximate rate: 1 USD = 25,000 VND)
      // Stripe requires amount in smallest currency unit (cents)
      const amountInUSD = Math.round(amount / 25000); // Convert to USD
      const amountInCents = amountInUSD * 100; // Convert to cents

      // Create payment record first
      const payment = await Payment.create({
        orderId,
        amount,
        method: 'stripe',
        status: 'pending',
        description: orderInfo,
        metadata: {
          ...metadata,
          customerEmail,
          amountUSD: amountInUSD,
          exchangeRate: 25000
        }
      });

      console.log('✅ [Stripe Service] Payment record created:', payment._id);

      // Create Stripe Checkout Session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: orderInfo || 'Dental Clinic Service',
                description: `Order ID: ${orderId}`,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${process.env.STRIPE_SUCCESS_URL || process.env.FRONTEND_URL + '/patient/payment/success'}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.STRIPE_CANCEL_URL || process.env.FRONTEND_URL + '/patient/payment/cancel'}`,
        customer_email: customerEmail,
        client_reference_id: orderId,
        metadata: {
          paymentId: payment._id.toString(),
          orderId,
          amountVND: amount.toString(),
          ...metadata
        },
        expires_at: Math.floor(Date.now() / 1000) + (15 * 60), // 15 minutes expiry
      });

      console.log('✅ [Stripe Service] Checkout session created:', session.id);

      // Update payment with session ID
      payment.stripeSessionId = session.id;
      payment.paymentUrl = session.url;
      await payment.save();

      // Cache session info in Redis (15 minutes TTL)
      await redis.setEx(
        `stripe:session:${session.id}`,
        15 * 60,
        JSON.stringify({
          paymentId: payment._id.toString(),
          orderId,
          amount,
          sessionId: session.id,
          createdAt: new Date().toISOString()
        })
      );

      return {
        sessionId: session.id,
        checkoutUrl: session.url,
        paymentId: payment._id.toString(),
        expiresAt: new Date(session.expires_at * 1000).toISOString()
      };

    } catch (error) {
      console.error('❌ [Stripe Service] Error creating checkout session:', error);
      throw new Error(`Stripe checkout session creation failed: ${error.message}`);
    }
  }

  /**
   * Handle Stripe Webhook Events
   * @param {object} event - Stripe webhook event
   * @returns {Promise<object>} - Processing result
   */
  async handleWebhookEvent(event) {
    try {
      console.log('🟣 [Stripe Webhook] Processing event:', event.type);

      switch (event.type) {
        case 'checkout.session.completed':
          return await this.handleCheckoutSessionCompleted(event.data.object);

        case 'checkout.session.expired':
          return await this.handleCheckoutSessionExpired(event.data.object);

        case 'payment_intent.succeeded':
          return await this.handlePaymentIntentSucceeded(event.data.object);

        case 'payment_intent.payment_failed':
          return await this.handlePaymentIntentFailed(event.data.object);

        default:
          console.log(`⚠️ [Stripe Webhook] Unhandled event type: ${event.type}`);
          return { received: true };
      }

    } catch (error) {
      console.error('❌ [Stripe Webhook] Error handling webhook:', error);
      throw error;
    }
  }

  /**
   * Handle successful checkout session
   */
  async handleCheckoutSessionCompleted(session) {
    try {
      console.log('✅ [Stripe Webhook] Checkout session completed:', session.id);

      const paymentId = session.metadata.paymentId;
      const orderId = session.client_reference_id || session.metadata.orderId;

      // Get payment from cache or database
      let cachedData = await redis.get(`stripe:session:${session.id}`);
      if (cachedData) {
        cachedData = JSON.parse(cachedData);
      }

      // Update payment status
      const payment = await Payment.findById(paymentId);
      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`);
      }

      payment.status = 'completed';
      payment.paidAt = new Date();
      payment.stripePaymentIntentId = session.payment_intent;
      payment.stripePaymentStatus = session.payment_status;
      await payment.save();

      console.log('✅ [Stripe Webhook] Payment updated:', payment._id);

      // Publish payment success event to RabbitMQ
      await publishEvent('payment.completed', {
        paymentId: payment._id.toString(),
        orderId,
        amount: payment.amount,
        method: 'stripe',
        paidAt: payment.paidAt,
        sessionId: session.id
      });

      // Clear Redis cache
      await redis.del(`stripe:session:${session.id}`);

      return {
        success: true,
        paymentId: payment._id.toString(),
        status: 'completed'
      };

    } catch (error) {
      console.error('❌ [Stripe Webhook] Error handling completed session:', error);
      throw error;
    }
  }

  /**
   * Handle expired checkout session
   */
  async handleCheckoutSessionExpired(session) {
    try {
      console.log('⏰ [Stripe Webhook] Checkout session expired:', session.id);

      const paymentId = session.metadata.paymentId;
      const orderId = session.client_reference_id || session.metadata.orderId;

      const payment = await Payment.findById(paymentId);
      if (payment && payment.status === 'pending') {
        payment.status = 'expired';
        await payment.save();

        // Publish payment expired event
        await publishEvent('payment.expired', {
          paymentId: payment._id.toString(),
          orderId,
          amount: payment.amount,
          method: 'stripe',
          sessionId: session.id
        });
      }

      // Clear Redis cache
      await redis.del(`stripe:session:${session.id}`);

      return {
        success: true,
        paymentId: paymentId,
        status: 'expired'
      };

    } catch (error) {
      console.error('❌ [Stripe Webhook] Error handling expired session:', error);
      throw error;
    }
  }

  /**
   * Handle successful payment intent
   */
  async handlePaymentIntentSucceeded(paymentIntent) {
    console.log('✅ [Stripe Webhook] Payment intent succeeded:', paymentIntent.id);
    return { received: true };
  }

  /**
   * Handle failed payment intent
   */
  async handlePaymentIntentFailed(paymentIntent) {
    console.log('❌ [Stripe Webhook] Payment intent failed:', paymentIntent.id);
    
    // Try to find payment by payment intent ID
    const payment = await Payment.findOne({ 
      stripePaymentIntentId: paymentIntent.id 
    });

    if (payment) {
      payment.status = 'failed';
      payment.metadata = {
        ...payment.metadata,
        failureReason: paymentIntent.last_payment_error?.message || 'Payment failed'
      };
      await payment.save();
    }

    return { received: true };
  }

  /**
   * Retrieve checkout session details
   * @param {string} sessionId - Stripe session ID
   * @returns {Promise<object>} - Session details
   */
  async getSessionDetails(sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Get payment from database
      const payment = await Payment.findOne({ stripeSessionId: sessionId });

      return {
        session,
        payment: payment ? {
          id: payment._id,
          orderId: payment.orderId,
          amount: payment.amount,
          status: payment.status,
          paidAt: payment.paidAt
        } : null
      };

    } catch (error) {
      console.error('❌ [Stripe Service] Error retrieving session:', error);
      throw error;
    }
  }

  /**
   * Verify session status (for frontend callback)
   * @param {string} sessionId - Stripe session ID
   * @returns {Promise<object>} - Verification result
   */
  async verifySession(sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status === 'paid') {
        const payment = await Payment.findOne({ stripeSessionId: sessionId });
        
        return {
          success: true,
          status: 'completed',
          orderId: session.client_reference_id,
          amount: session.metadata.amountVND,
          paymentId: payment?._id?.toString()
        };
      } else {
        return {
          success: false,
          status: session.payment_status,
          message: 'Payment not completed'
        };
      }

    } catch (error) {
      console.error('❌ [Stripe Service] Error verifying session:', error);
      throw error;
    }
  }
}

module.exports = new StripeService();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');
const Payment = require('../models/payment.model');
const redis = require('../utils/redis.client');
const rabbitmqClient = require('../utils/rabbitmq.client');

class StripeService {
  /**
   * Create Stripe Payment Link (VNPay-style pattern)
   * Simplified flow: direct URL generation like VNPay
   * @param {string} orderId - Reservation/appointment ID  
   * @param {number} amount - Amount in VND
   * @param {string} orderInfo - Description
   * @param {string} customerEmail - Customer email (optional)
   * @param {object} metadata - Additional metadata
   * @param {string} userRole - User role for redirect (patient/staff/admin)
   * @returns {Promise<object>} - { paymentUrl, orderId, sessionId }
   */
  async createPaymentLink(orderId, amount, orderInfo, customerEmail = null, metadata = {}, userRole = 'patient') {
    try {
      console.log('🟣 [Stripe Service] Creating payment link (VNPay-style):', {
        orderId,
        amount,
        orderInfo,
        customerEmail,
        metadata,
        userRole
      });

      // Convert VND to USD (approximate rate: 1 USD = 25,000 VND)
      // Stripe requires amount in smallest currency unit (cents)
      const exchangeRate = parseFloat(process.env.STRIPE_EXCHANGE_RATE) || 25000;
      const amountInUSD = Math.round(amount / exchangeRate);
      const amountInCents = Math.max(50, amountInUSD * 100); // Stripe minimum: $0.50

      console.log('💱 [Stripe] Currency conversion:', {
        amountVND: amount,
        exchangeRate,
        amountUSD: amountInUSD,
        amountCents: amountInCents
      });

      // Create Stripe Checkout Session
      const returnUrl = process.env.STRIPE_RETURN_URL || 'http://localhost:3007/api/payments/return/stripe';
      
      // Prepare session config
      const sessionConfig = {
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: orderInfo || 'Dental Clinic Payment',
                description: `Order: ${orderId}`,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&status=success`,
        cancel_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&status=cancel`,
        client_reference_id: orderId,
        metadata: {
          orderId,
          amountVND: amount.toString(),
          amountUSD: amountInUSD.toString(),
          exchangeRate: exchangeRate.toString(),
          ...metadata
        },
        expires_at: Math.floor(Date.now() / 1000) + (30 * 60), // 30 minutes (Stripe minimum)
      };

      // Only set customer_email if it's valid (not null, not empty string)
      if (customerEmail && customerEmail.trim() !== '') {
        sessionConfig.customer_email = customerEmail.trim();
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      console.log('✅ [Stripe Service] Session created:', session.id);

      // Store user role in Redis for later use in return URL redirect (SAME AS VNPAY)
      // TTL: 30 minutes (enough time for payment process)
      const roleKey = `payment:role:${orderId}`;
      const roleToStore = userRole || 'patient';
      
      console.log('🔑 [Stripe] Redis Role Key:', roleKey);
      console.log('💾 [Stripe] Storing Role:', roleToStore);
      
      await redis.setEx(roleKey, 1800, roleToStore);
      console.log('✅ [Stripe] Role stored in Redis successfully');

      // Store temporary payment in Redis (VNPay pattern)
      const tempPaymentKey = `payment:temp:${orderId}`;
      const now = new Date();
      const expireAt = new Date(now.getTime() + 15 * 60 * 1000);
      
      const tempPaymentData = {
        tempPaymentId: tempPaymentKey,
        appointmentHoldKey: orderId,
        amount: amount,
        amountUSD: amountInUSD,
        exchangeRate: exchangeRate,
        status: 'PENDING',
        method: 'stripe',
        sessionId: session.id,
        stripeUrl: session.url,
        stripeCreatedAt: now.toISOString(),
        createdAt: now,
        expireAt,
        orderId,
        customerEmail,
        metadata,
        userRole: roleToStore
      };
      
      await redis.setEx(tempPaymentKey, 900, JSON.stringify(tempPaymentData));
      console.log('💾 [Stripe] Temp payment stored:', tempPaymentKey);

      // Store session mapping (for callback)
      await redis.setEx(`stripe:session:${session.id}`, 900, orderId);
      
      return {
        paymentUrl: session.url,
        sessionId: session.id,
        orderId,
        amount,
        amountUSD: amountInUSD,
        expiresAt: new Date(session.expires_at * 1000).toISOString()
      };

    } catch (error) {
      console.error('❌ [Stripe Service] Error creating payment link:', error);
      throw new Error(`Stripe payment link creation failed: ${error.message}`);
    }
  }

  /**
   * Process Stripe callback/return (VNPay-style pattern)
   * Handle redirect from Stripe success/cancel
   * @param {string} sessionId - Stripe session ID
   * @param {string} status - 'success' or 'cancel'
   * @returns {Promise<object>} - Processing result
   */
  async processCallback(sessionId, status) {
    try {
      console.log('🟣 [Stripe Callback] Processing:', { sessionId, status });

      // Get orderId from Redis mapping
      const orderId = await redis.get(`stripe:session:${sessionId}`);
      if (!orderId) {
        throw new Error('Session not found or expired');
      }

      // Check if this is an existing payment (from dashboard) or new booking
      const existingPaymentMapping = await redis.get(`payment:stripe:${orderId}`);
      
      if (existingPaymentMapping) {
        // This is an existing payment from dashboard
        console.log('📋 [Stripe] Processing existing payment:', { orderId, paymentId: existingPaymentMapping });
        return await this.handleExistingPaymentCallback(sessionId, orderId, existingPaymentMapping, status);
      }

      // Get temp payment from Redis (for new bookings)
      const tempPaymentKey = `payment:temp:${orderId}`;
      const tempPaymentData = await redis.get(tempPaymentKey);
      
      // Verify session with Stripe first
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (!tempPaymentData) {
        // Check if payment already exists in DB (webhook might have processed it)
        const existingPayment = await Payment.findOne({
          'gatewayResponse.additionalData.sessionId': sessionId
        });

        if (existingPayment) {
          console.log('✅ [Stripe] Payment already processed via webhook:', existingPayment._id);
          return existingPayment; // Return existing payment instead of throwing error
        }

        console.error('❌ Temporary payment not found and no existing payment:', tempPaymentKey);
        throw new Error('Temporary payment not found or expired');
      }

      const tempPayment = JSON.parse(tempPaymentData);
      
      console.log('📋 [Stripe] Session details:', {
        id: session.id,
        payment_status: session.payment_status,
        status: session.status,
        amount_total: session.amount_total,
        payment_intent: session.payment_intent
      });

      // Process based on status
      if (status === 'success' && session.payment_status === 'paid') {
        return await this.handleSuccessfulPayment(session, tempPayment, orderId);
      } else if (status === 'cancel' || session.status === 'expired') {
        return await this.handleCancelledPayment(session, tempPayment, orderId);
      } else {
        throw new Error(`Unknown payment status: ${status}`);
      }

    } catch (error) {
      console.error('❌ [Stripe Callback] Error:', error);
      throw error;
    }
  }

  /**
   * Handle successful Stripe payment (similar to VNPay success)
   */
  async handleSuccessfulPayment(session, tempPayment, orderId) {
    try {
      const reservationId = orderId;
      const amount = tempPayment.amount;

      // Get appointment hold data for patient info and services (SAME AS VNPAY)
      const appointmentHoldKey = tempPayment.appointmentHoldKey || reservationId;
      
      // Try multiple possible Redis keys (different services use different prefixes)
      const possibleKeys = [
        appointmentHoldKey,  // Direct key (e.g., "RSV1760631740748")
        `appointment_hold:${appointmentHoldKey}`,
        `reservation:${appointmentHoldKey}`,
        `temp_reservation:${appointmentHoldKey}`
      ];
      
      let patientInfo = {
        name: session.customer_details?.name || 'Customer',
        phone: '0000000000',
        email: session.customer_details?.email || tempPayment.customerEmail
      };
      let appointmentData = null;
      let foundKey = null;
      
      try {
        // Try each possible key until we find the data
        for (const key of possibleKeys) {
          const appointmentDataStr = await redis.get(key);
          if (appointmentDataStr) {
            appointmentData = JSON.parse(appointmentDataStr);
            foundKey = key;
            console.log('✅ [Stripe DEBUG] Appointment data found in Redis:', {
              key: foundKey,
              hasPatientInfo: !!appointmentData.patientInfo,
              hasSlotIds: !!appointmentData.slotIds,
              slotCount: appointmentData.slotIds?.length || 0,
              hasServiceId: !!appointmentData.serviceId,
              serviceAddOnId: appointmentData.serviceAddOnId || 'none'
            });
            break;
          }
        }
        
        if (!appointmentData) {
          console.error('❌ [Stripe DEBUG] No appointment data found in Redis. Tried keys:', possibleKeys);
          // Don't throw - continue with limited data
        }
        
        // Extract patient info from appointment data (SAME AS VNPAY)
        if (appointmentData && appointmentData.patientInfo) {
          patientInfo = {
            name: appointmentData.patientInfo.fullName || appointmentData.patientInfo.name || 'Customer',
            phone: appointmentData.patientInfo.phone || '0000000000',
            email: appointmentData.patientInfo.email || session.customer_details?.email || tempPayment.customerEmail,
            address: appointmentData.patientInfo.address || null
          };
        }
      } catch (err) {
        console.error('❌ [Stripe DEBUG] Error fetching appointment data:', err.message);
      }

      // Create permanent payment record (similar to VNPay flow)
      const payment = await Payment.create({
        paymentCode: orderId,
        appointmentId: null,
        patientId: tempPayment.patientId || null,
        patientInfo: patientInfo,
        type: 'payment',
        method: 'stripe',
        status: 'completed',
        originalAmount: amount,
        discountAmount: 0,
        taxAmount: 0,
        finalAmount: amount,
        paidAmount: amount,
        changeAmount: 0,
        externalTransactionId: session.payment_intent,
        gatewayResponse: {
          responseCode: '00',
          responseMessage: 'Success',
          additionalData: {
            reservationId,
            sessionId: session.id,
            paymentIntentId: session.payment_intent,
            paymentStatus: session.payment_status,
            currency: session.currency,
            amountUSD: tempPayment.amountUSD,
            exchangeRate: tempPayment.exchangeRate,
            stripeUrl: tempPayment.stripeUrl,
            stripeCreatedAt: tempPayment.stripeCreatedAt,
            gateway: 'stripe',
            processedAt: new Date()
          }
        },
        processedBy: new mongoose.Types.ObjectId(),
        processedByName: 'Stripe Gateway',
        processedAt: new Date(),
        description: `Stripe payment for ${orderId}`,
        notes: `Reservation ID: ${reservationId}`,
        isVerified: true,
        verifiedAt: new Date()
      });

      console.log('✅ [Stripe] Payment record created:', payment._id);
      console.log('💾 Payment data includes Stripe URL:', !!tempPayment.stripeUrl);

      // Delete temp payment from Redis
      await redis.del(`payment:temp:${orderId}`);
      await redis.del(`stripe:session:${session.id}`);
      
      // NOTE: Don't delete payment:role here - controller needs it for redirect
      // Controller will clean it up after getting the role

      // Publish events (same as VNPay) - ONLY if appointment data exists
      if (appointmentData) {
        try {
          // STEP 1: Create Invoice FIRST
          await rabbitmqClient.publishToQueue('invoice_queue', {
            event: 'payment.completed',
            data: {
              reservationId,
              paymentId: payment._id.toString(),
              paymentCode: payment.paymentCode,
              amount: amount,
              patientInfo: patientInfo,
              appointmentData: appointmentData
            }
          });

          // STEP 2: Create Appointment (will query invoice by paymentId)
          await rabbitmqClient.publishToQueue('appointment_queue', {
            event: 'payment.completed',
            data: {
              reservationId,
              paymentId: payment._id.toString(),
              paymentCode: payment.paymentCode,
              amount: amount,
              appointmentData: appointmentData
            }
          });

          // STEP 3: Mark Service/ServiceAddOn as Used
          const servicesToMark = [];
          
          if (appointmentData.serviceId) {
            servicesToMark.push({
              serviceId: appointmentData.serviceId,
              serviceAddOnId: appointmentData.serviceAddOnId || null
            });
          }
          
          if (servicesToMark.length > 0) {
            await rabbitmqClient.publishToQueue('service_queue', {
              event: 'service.mark_as_used',
              data: {
                services: servicesToMark,
                reservationId: reservationId,
                paymentId: payment._id.toString()
              }
            });
          }

          // STEP 4: Mark exam record as used (if needed)
          if (appointmentData.examRecordId) {
            await rabbitmqClient.publishToQueue('record_queue', {
              event: 'record.mark_as_used',
              data: {
                recordId: appointmentData.examRecordId,
                reservationId: reservationId,
                paymentId: payment._id.toString(),
                appointmentData: {
                  serviceId: appointmentData.serviceId,
                  serviceName: appointmentData.serviceName || 'Unknown Service'
                }
              }
            });
          }

          console.log('✅ [Stripe] Events published for appointment creation');
        } catch (eventError) {
          console.error('⚠️ [Stripe] Error publishing events:', eventError.message);
          // Don't throw - payment is already created
        }
      } else {
        console.warn('⚠️ [Stripe] appointmentData is NULL or UNDEFINED - Events NOT published!', {
          appointmentData,
          reservationId,
          tempPaymentKey: `payment:temp:${orderId}`,
          appointmentHoldKey
        });
      }

      return payment;

    } catch (error) {
      console.error('❌ [Stripe] Error handling successful payment:', error);
      throw error;
    }
  }

  /**
   * Handle cancelled/expired Stripe payment
   */
  async handleCancelledPayment(session, tempPayment, orderId) {
    try {
      console.log('⏰ [Stripe] Payment cancelled/expired:', orderId);

      // Delete temp payment
      await redis.del(`payment:temp:${orderId}`);
      await redis.del(`stripe:session:${session.id}`);
      
      // NOTE: Don't delete payment:role here - controller needs it for redirect
      // Controller will clean it up after getting the role

      return {
        success: false,
        status: 'cancelled',
        message: 'Payment cancelled or expired',
        orderId
      };

    } catch (error) {
      console.error('❌ [Stripe] Error handling cancelled payment:', error);
      throw error;
    }
  }

  /**
   * Handle callback for existing payment (dashboard staff payment)
   * Similar to VNPay's updateExistingPaymentFromVNPay
   */
  async handleExistingPaymentCallback(sessionId, orderId, paymentId, status) {
    try {
      console.log('🔄 [Stripe Existing Payment] Processing:', { sessionId, orderId, paymentId, status });

      // Verify session with Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Get payment from database
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`);
      }

      // Check if payment already completed (duplicate callback/webhook)
      if (payment.status === 'completed') {
        console.log('ℹ️ [Stripe Existing Payment] Payment already completed:', payment._id);
        
        // Clean up Redis if exists
        await redis.del(`payment:stripe:${orderId}`);
        await redis.del(`stripe:session:${sessionId}`);
        
        return {
          ...payment.toObject(),
          orderId: orderId
        };
      }

      if (status === 'success' && session.payment_status === 'paid') {
        // Update payment to completed
        payment.status = 'completed';
        payment.paidAmount = payment.finalAmount;
        payment.completedAt = new Date();
        payment.processedAt = new Date();
        payment.processedByName = 'Stripe Gateway';
        payment.externalTransactionId = session.payment_intent;
        
        // Update gateway response
        payment.gatewayResponse = payment.gatewayResponse || {};
        payment.gatewayResponse.responseCode = '00';
        payment.gatewayResponse.responseMessage = 'Success';
        payment.gatewayResponse.transactionId = session.payment_intent;
        payment.gatewayResponse.additionalData = payment.gatewayResponse.additionalData || {};
        payment.gatewayResponse.additionalData.sessionId = sessionId;
        payment.gatewayResponse.additionalData.paymentStatus = session.payment_status;
        payment.gatewayResponse.additionalData.processedAt = new Date();

        await payment.save();

        console.log('✅ [Stripe Existing Payment] Payment updated:', payment._id);

        // Clean up Redis
        await redis.del(`payment:stripe:${orderId}`);
        await redis.del(`stripe:session:${sessionId}`);
        
        // NOTE: Don't delete payment:role here - controller needs it for redirect
        // Controller will clean it up after getting the role

        // Trigger invoice creation if has recordId (same as VNPay)
        if (payment.recordId) {
          try {
            console.log('📄 [Stripe Existing Payment] Triggering invoice creation for record:', payment.recordId);
            
            const rabbitmqClient = require('../utils/rabbitmq.client');
            await rabbitmqClient.publishToQueue('invoice_queue', {
              event: 'payment.success',
              data: {
                paymentId: payment._id.toString(),
                paymentCode: payment.paymentCode,
                recordId: payment.recordId.toString(),
                appointmentId: payment.appointmentId ? payment.appointmentId.toString() : null,
                patientId: payment.patientId ? payment.patientId.toString() : null,
                patientInfo: payment.patientInfo,
                method: payment.method,
                originalAmount: payment.originalAmount,
                discountAmount: payment.discountAmount,
                finalAmount: payment.finalAmount,
                paidAmount: payment.paidAmount,
                changeAmount: payment.changeAmount || 0,
                completedAt: payment.completedAt,
                processedBy: payment.processedBy ? payment.processedBy.toString() : null,
                processedByName: payment.processedByName || 'Stripe Gateway'
              }
            });
            
            console.log('✅ [Stripe Existing Payment] Invoice creation event sent');
          } catch (err) {
            console.error('❌ [Stripe Existing Payment] Failed to send invoice event:', err);
          }
        }

        // Return payment with orderId for redirect (same as new booking)
        return {
          ...payment.toObject(),
          orderId: orderId  // Add orderId for controller redirect logic
        };
      } else {
        // Payment cancelled or failed
        payment.status = 'cancelled';
        payment.cancelReason = 'User cancelled Stripe payment';
        payment.cancelledAt = new Date();
        await payment.save();

        // Clean up Redis
        await redis.del(`payment:stripe:${orderId}`);
        await redis.del(`stripe:session:${sessionId}`);
        
        // NOTE: Don't delete payment:role here - controller needs it for redirect
        // Controller will clean it up after getting the role

        console.log('⏰ [Stripe Existing Payment] Payment cancelled:', payment._id);
        
        return {
          ...payment.toObject(),
          orderId: orderId  // Add orderId for controller redirect logic
        };
      }

    } catch (error) {
      console.error('❌ [Stripe Existing Payment] Error:', error);
      throw error;
    }
  }

  /**
   * Handle Stripe Webhook Events (backup/verification only)
   * Primary flow uses callback/return URL (VNPay-style)
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
          console.log('✅ [Stripe Webhook] Payment intent succeeded:', event.data.object.id);
          return { received: true };

        case 'payment_intent.payment_failed':
          console.log('❌ [Stripe Webhook] Payment intent failed:', event.data.object.id);
          return { received: true };

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
   * Handle completed session (webhook backup verification)
   * Primary flow handled by processCallback()
   */
  async handleCheckoutSessionCompleted(session) {
    try {
      console.log('✅ [Stripe Webhook] Session completed:', session.id);

      // Check if already processed via callback
      const orderId = await redis.get(`stripe:session:${session.id}`);
      if (!orderId) {
        console.log('ℹ️ [Stripe Webhook] Session already processed via callback');
        return { received: true, note: 'Already processed' };
      }

      // Verify payment exists
      const existingPayment = await Payment.findOne({ 
        'gatewayResponse.additionalData.sessionId': session.id 
      });

      if (existingPayment) {
        console.log('ℹ️ [Stripe Webhook] Payment already exists:', existingPayment._id);
        return { received: true, paymentId: existingPayment._id.toString() };
      }

      // Process as backup (callback might have failed)
      console.log('⚠️ [Stripe Webhook] Processing as backup...');
      const tempPaymentData = await redis.get(`payment:temp:${orderId}`);
      
      if (tempPaymentData) {
        const tempPayment = JSON.parse(tempPaymentData);
        return await this.handleSuccessfulPayment(session, tempPayment, orderId);
      } else {
        console.warn('⚠️ [Stripe Webhook] Temp payment not found for backup processing');
        return { received: true, note: 'Temp payment expired' };
      }

    } catch (error) {
      console.error('❌ [Stripe Webhook] Error handling completed session:', error);
      return { received: true, error: error.message };
    }
  }

  /**
   * Handle expired session (webhook notification)
   */
  async handleCheckoutSessionExpired(session) {
    try {
      console.log('⏰ [Stripe Webhook] Session expired:', session.id);

      const orderId = await redis.get(`stripe:session:${session.id}`);
      
      if (orderId) {
        // Clean up temp payment
        await redis.del(`payment:temp:${orderId}`);
        await redis.del(`stripe:session:${session.id}`);
        
        // Clean up role from Redis (same as VNPay)
        const roleKey = `payment:role:${orderId}`;
        await redis.del(roleKey);
        
        console.log('🧹 [Stripe Webhook] Cleaned up expired session and role');
      }

      return { received: true, status: 'expired' };

    } catch (error) {
      console.error('❌ [Stripe Webhook] Error handling expired session:', error);
      return { received: true, error: error.message };
    }
  }

  /**
   * Verify session status (for frontend/debugging)
   * @param {string} sessionId - Stripe session ID
   * @returns {Promise<object>} - Verification result
   */
  async verifySession(sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Check if payment exists in DB
      const payment = await Payment.findOne({ 
        'gatewayResponse.additionalData.sessionId': sessionId 
      });
      
      if (session.payment_status === 'paid') {
        return {
          success: true,
          status: 'completed',
          orderId: session.client_reference_id || session.metadata.orderId,
          amount: session.metadata.amountVND || session.amount_total,
          paymentId: payment?._id?.toString(),
          payment: payment ? {
            id: payment._id,
            paymentCode: payment.paymentCode,
            status: payment.status,
            paidAmount: payment.paidAmount,
            processedAt: payment.processedAt
          } : null
        };
      } else {
        return {
          success: false,
          status: session.payment_status,
          message: 'Payment not completed',
          sessionStatus: session.status
        };
      }

    } catch (error) {
      console.error('❌ [Stripe Service] Error verifying session:', error);
      throw error;
    }
  }
}

module.exports = new StripeService();

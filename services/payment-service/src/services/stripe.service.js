const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoose = require('mongoose');
const { Payment } = require('../models/payment.model');
const redis = require('../utils/redis.client');
const rabbitmqClient = require('../utils/rabbitmq.client');

class StripeService {
  /**
   * Tạo liên kết thanh toán Stripe (theo mô hình VNPay)
   * Luồng đơn giản: tạo URL trực tiếp như VNPay
   * @param {string} orderId - Mã đặt khám/lịch hẹn
   * @param {number} amount - Số tiền bằng VND
   * @param {string} orderInfo - Mô tả
   * @param {string} customerEmail - Email khách hàng (tùy chọn)
   * @param {object} metadata - Dữ liệu bổ sung
   * @param {string} userRole - Vai trò người dùng để chuyển hướng (patient/staff/admin)
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

      // Chuyển đổi VND sang USD (tỷ giá xấp xỉ: 1 USD = 25,000 VND)
      // Stripe yêu cầu số tiền theo đơn vị tiền tệ nhỏ nhất (cents)
      const exchangeRate = parseFloat(process.env.STRIPE_EXCHANGE_RATE) || 25000;
      const amountInUSD = Math.round(amount / exchangeRate);
      const amountInCents = Math.max(50, amountInUSD * 100); // Stripe minimum: $0.50

      console.log('💱 [Stripe] Currency conversion:', {
        amountVND: amount,
        exchangeRate,
        amountUSD: amountInUSD,
        amountCents: amountInCents
      });

      // Tạo Stripe Checkout Session
      const returnUrl = process.env.STRIPE_RETURN_URL || 'http://localhost:3007/api/payments/return/stripe';
      
      // Chuẩn bị cấu hình session
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

      // Chỉ đặt customer_email nếu hợp lệ (không null, không rỗng)
      if (customerEmail && customerEmail.trim() !== '') {
        sessionConfig.customer_email = customerEmail.trim();
      }

      const session = await stripe.checkout.sessions.create(sessionConfig);

      console.log('✅ [Stripe Service] Session created:', session.id);

      // Lưu vai trò người dùng vào Redis để sử dụng sau trong URL chuyển hướng (GIỐNG VNPAY)
      // TTL: 30 phút (đủ thời gian cho quá trình thanh toán)
      const roleKey = `payment:role:${orderId}`;
      const roleToStore = userRole || 'patient';
      
      console.log('🔑 [Stripe] Redis Role Key:', roleKey);
      console.log('💾 [Stripe] Storing Role:', roleToStore);
      
      await redis.setEx(roleKey, 1800, roleToStore);
      console.log('✅ [Stripe] Role stored in Redis successfully');

      // Lưu thanh toán tạm thời vào Redis (theo mô hình VNPay)
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
      
      await redis.setEx(tempPaymentKey, 180, JSON.stringify(tempPaymentData)); // 3 minutes
      console.log('💾 [Stripe] Temp payment stored:', tempPaymentKey);

      // Lưu ánh xạ session (để xử lý callback)
      await redis.setEx(`stripe:session:${session.id}`, 180, orderId); // 3 phút
      
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
   * Xử lý callback/return từ Stripe (theo mô hình VNPay)
   * Xử lý chuyển hướng từ Stripe success/cancel
   * @param {string} sessionId - Mã session Stripe
   * @param {string} status - 'success' hoặc 'cancel'
   * @returns {Promise<object>} - Kết quả xử lý
   */
  async processCallback(sessionId, status) {
    try {
      console.log('🟣 [Stripe Callback] Processing:', { sessionId, status });

      // Lấy orderId từ Redis mapping
      const orderId = await redis.get(`stripe:session:${sessionId}`);
      if (!orderId) {
        throw new Error('Session not found or expired');
      }

      // Kiểm tra đây là thanh toán hiện có (từ dashboard) hay đặt khám mới
      const existingPaymentMapping = await redis.get(`payment:stripe:${orderId}`);
      
      if (existingPaymentMapping) {
        // Đây là thanh toán hiện có từ dashboard
        console.log('📋 [Stripe] Processing existing payment:', { orderId, paymentId: existingPaymentMapping });
        return await this.handleExistingPaymentCallback(sessionId, orderId, existingPaymentMapping, status);
      }

      // Lấy thanh toán tạm từ Redis (đối với đặt khám mới)
      const tempPaymentKey = `payment:temp:${orderId}`;
      const tempPaymentData = await redis.get(tempPaymentKey);
      
      // Xác minh session với Stripe trước
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (!tempPaymentData) {
        // Kiểm tra xem thanh toán đã tồn tại trong DB chưa (webhook có thể đã xử lý)
        const existingPayment = await Payment.findOne({
          'gatewayResponse.additionalData.sessionId': sessionId
        });

        if (existingPayment) {
          console.log('✅ [Stripe] Payment already processed via webhook:', existingPayment._id);
          return existingPayment; // Trả về thanh toán hiện có thay vì throw error
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

      // Xử lý dựa trên trạng thái
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
   * Xử lý thanh toán Stripe thành công (tương tự VNPay success)
   */
  async handleSuccessfulPayment(session, tempPayment, orderId) {
    try {
      const reservationId = orderId;
      const amount = tempPayment.amount;

      // Lấy dữ liệu giữ chỗ lịch hẹn để lấy thông tin bệnh nhân và dịch vụ (GIỐNG VNPAY)
      const appointmentHoldKey = tempPayment.appointmentHoldKey || reservationId;
      
      // Thử nhiều khóa Redis có thể có (các service khác nhau sử dụng tiền tố khác nhau)
      const possibleKeys = [
        appointmentHoldKey,  // Khóa trực tiếp (ví dụ: "RSV1760631740748")
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
        // Thử từng khóa có thể có cho đến khi tìm thấy dữ liệu
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
          // Không throw - tiếp tục với dữ liệu hạn chế
        }
        
        // Trích xuất thông tin bệnh nhân từ dữ liệu lịch hẹn (GIỐNG VNPAY)
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

      // Tạo bản ghi thanh toán vĩnh viễn (tương tự luồng VNPay)
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

      // Xóa thanh toán tạm khỏi Redis
      await redis.del(`payment:temp:${orderId}`);
      await redis.del(`stripe:session:${session.id}`);
      
      // GHI CHÚ: Không xóa payment:role ở đây - controller cần nó để chuyển hướng
      // Controller sẽ dọn dẹp sau khi lấy được vai trò

      // Publish các sự kiện (giống VNPay) - CHỈ nếu dữ liệu lịch hẹn tồn tại
      if (appointmentData) {
        try {
          // BƯỚC 1: Tạo hóa đơn TRƯỚC TIÊN
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

          // BƯỚC 2: Tạo lịch hẹn (sẽ truy vấn hóa đơn theo paymentId)
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

          // BƯỚC 3: Đánh dấu Service/ServiceAddOn đã sử dụng
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

          // BƯỚC 4: Đánh dấu hồ sơ khám đã sử dụng (nếu cần)
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
          // Không throw - thanh toán đã được tạo
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
   * Xử lý thanh toán Stripe bị hủy/hết hạn
   */
  async handleCancelledPayment(session, tempPayment, orderId) {
    try {
      console.log('⏰ [Stripe] Payment cancelled/expired:', orderId);

      // Xóa thanh toán tạm
      await redis.del(`payment:temp:${orderId}`);
      await redis.del(`stripe:session:${session.id}`);
      
      // GHI CHÚ: Không xóa payment:role ở đây - controller cần nó để chuyển hướng
      // Controller sẽ dọn dẹp sau khi lấy được vai trò

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
   * Xử lý callback cho thanh toán hiện có (thanh toán nhân viên từ dashboard)
   * Tương tự updateExistingPaymentFromVNPay của VNPay
   */
  async handleExistingPaymentCallback(sessionId, orderId, paymentId, status) {
    try {
      console.log('🔄 [Stripe Existing Payment] Processing:', { sessionId, orderId, paymentId, status });

      // Xác minh session với Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Lấy thanh toán từ database
      const payment = await Payment.findById(paymentId);
      
      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`);
      }

      // Kiểm tra xem thanh toán đã hoàn thành chưa (callback/webhook trùng lặp)
      if (payment.status === 'completed') {
        console.log('ℹ️ [Stripe Existing Payment] Payment already completed:', payment._id);
        
        // Dọn dẹp Redis nếu tồn tại
        await redis.del(`payment:stripe:${orderId}`);
        await redis.del(`stripe:session:${sessionId}`);
        
        return {
          ...payment.toObject(),
          orderId: orderId
        };
      }

      if (status === 'success' && session.payment_status === 'paid') {
        // ✅ Nếu finalAmount là 0 và có recordId, lấy từ record service
        if (payment.finalAmount === 0 && payment.recordId) {
          console.log('⚠️ [Stripe Existing Payment] finalAmount is 0, fetching from record:', payment.recordId);
          
          try {
            const axios = require('axios');
            const recordServiceUrl = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
            const recordResponse = await axios.get(
              `${recordServiceUrl}/api/record/${payment.recordId}`
            );
            
            const recordData = recordResponse.data?.data || recordResponse.data;
            console.log('📋 [Stripe Existing Payment] Record data:', {
              recordId: payment.recordId,
              serviceAmount: recordData.serviceAmount,
              serviceAddOnPrice: recordData.serviceAddOnPrice,
              depositPaid: recordData.depositPaid
            });
            
            // 🔥 SỬa LỖI: Sử dụng serviceAddOnPrice (giá biến thể thực tế) thay vì servicePrice (giá gốc)
            const serviceAmount = recordData.serviceAddOnPrice || recordData.serviceAmount || 0;
            const depositAmount = recordData.depositPaid || 0;
            const calculatedAmount = Math.max(0, serviceAmount - depositAmount);
            
            // Cập nhật số tiền thanh toán
            payment.originalAmount = serviceAmount;
            payment.depositAmount = depositAmount;  // ✅ SỬa LỖI: Trường đúng!
            payment.discountAmount = 0;  // ✅ SỬa LỖI: Không có giảm giá thực sự
            payment.taxAmount = 0;
            payment.finalAmount = calculatedAmount;
            
            console.log('✅ [Stripe Existing Payment] Amount calculated from record:', { 
              serviceAmount, 
              depositAmount, 
              finalAmount: calculatedAmount 
            });
          } catch (error) {
            console.error('❌ [Stripe Existing Payment] Failed to fetch amount from record:', error.message);
          }
        }
        
        // Cập nhật thanh toán thành completed
        payment.status = 'completed';
        payment.paidAmount = payment.finalAmount;  // ✅ Bây giờ giá trị này sẽ chính xác
        payment.completedAt = new Date();
        payment.processedAt = new Date();
        payment.processedByName = 'Stripe Gateway';
        payment.externalTransactionId = session.payment_intent;
        
        // Cập nhật phản hồi gateway
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

        // Dọn dẹp Redis
        await redis.del(`payment:stripe:${orderId}`);
        await redis.del(`stripe:session:${sessionId}`);
        
        // GHI CHÚ: Không xóa payment:role ở đây - controller cần nó để chuyển hướng
        // Controller sẽ dọn dẹp sau khi lấy được vai trò

        // Kích hoạt tạo hóa đơn nếu có recordId (giống VNPay)
        if (payment.recordId) {
          try {
            console.log('📄 [Stripe Existing Payment] Triggering invoice creation for record:', payment.recordId);
            
            const rabbitmqClient = require('../utils/rabbitmq.client');
            
            const eventData = {
              paymentId: payment._id.toString(),
              paymentCode: payment.paymentCode,
              recordId: payment.recordId.toString(),
              appointmentId: payment.appointmentId ? payment.appointmentId.toString() : null,
              patientId: payment.patientId ? payment.patientId.toString() : null,
              patientInfo: payment.patientInfo,
              method: payment.method,
              originalAmount: payment.originalAmount,
              depositAmount: payment.depositAmount || 0,  // ✅ Thêm số tiền đặt cọc
              discountAmount: payment.discountAmount || 0, // ✅ Giảm giá thực sự (không phải đặt cọc)
              taxAmount: payment.taxAmount || 0,  // ✅ Thêm số tiền thuế
              finalAmount: payment.finalAmount,
              paidAmount: payment.paidAmount,
              changeAmount: payment.changeAmount || 0,
              completedAt: payment.completedAt,
              processedBy: payment.processedBy ? payment.processedBy.toString() : null,
              processedByName: payment.processedByName || 'Stripe Gateway'
            };
            
            console.log('📤 [Stripe Existing Payment] Publishing payment.success event:', eventData);
            
            await rabbitmqClient.publishToQueue('invoice_queue', {
              event: 'payment.success',
              data: eventData
            });
            
            console.log('✅ [Stripe Existing Payment] Invoice creation event sent');
          } catch (err) {
            console.error('❌ [Stripe Existing Payment] Failed to send invoice event:', err);
          }
        }

        // Return payment với orderId để chuyển hướng (giống đặt khám mới)
        return {
          ...payment.toObject(),
          orderId: orderId  // Thêm orderId cho logic chuyển hướng của controller
        };
      } else {
        // Thanh toán bị hủy hoặc thất bại
        payment.status = 'cancelled';
        payment.cancelReason = 'User cancelled Stripe payment';
        payment.cancelledAt = new Date();
        await payment.save();

        // Dọn dẹp Redis
        await redis.del(`payment:stripe:${orderId}`);
        await redis.del(`stripe:session:${sessionId}`);
        
        // GHI CHÚ: Không xóa payment:role ở đây - controller cần nó để chuyển hướng
        // Controller sẽ dọn dẹp sau khi lấy được vai trò

        console.log('⏰ [Stripe Existing Payment] Payment cancelled:', payment._id);
        
        return {
          ...payment.toObject(),
          orderId: orderId  // Thêm orderId cho logic chuyển hướng của controller
        };
      }

    } catch (error) {
      console.error('❌ [Stripe Existing Payment] Error:', error);
      throw error;
    }
  }

  /**
   * Xử lý các sự kiện Webhook của Stripe (chỉ để sao lưu/xác minh)
   * Luồng chính sử dụng callback/return URL (theo kiểu VNPay)
   * @param {object} event - Sự kiện webhook Stripe
   * @returns {Promise<object>} - Kết quả xử lý
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
   * Xử lý session hoàn thành (xác minh backup webhook)
   * Luồng chính được xử lý bởi processCallback()
   */
  async handleCheckoutSessionCompleted(session) {
    try {
      console.log('✅ [Stripe Webhook] Session completed:', session.id);

      // Kiểm tra xem đã được xử lý qua callback chưa
      const orderId = await redis.get(`stripe:session:${session.id}`);
      if (!orderId) {
        console.log('ℹ️ [Stripe Webhook] Session already processed via callback');
        return { received: true, note: 'Already processed' };
      }

      // Xác minh thanh toán tồn tại
      const existingPayment = await Payment.findOne({ 
        'gatewayResponse.additionalData.sessionId': session.id 
      });

      if (existingPayment) {
        console.log('ℹ️ [Stripe Webhook] Payment already exists:', existingPayment._id);
        return { received: true, paymentId: existingPayment._id.toString() };
      }

      // Xử lý như backup (callback có thể đã thất bại)
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
   * Xử lý session hết hạn (thông báo webhook)
   */
  async handleCheckoutSessionExpired(session) {
    try {
      console.log('⏰ [Stripe Webhook] Session expired:', session.id);

      const orderId = await redis.get(`stripe:session:${session.id}`);
      
      if (orderId) {
        // Dọn dẹp thanh toán tạm
        await redis.del(`payment:temp:${orderId}`);
        await redis.del(`stripe:session:${session.id}`);
        
        // Dọn dẹp vai trò khỏi Redis (giống VNPay)
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
   * Xác minh trạng thái session (cho frontend/debug)
   * @param {string} sessionId - Mã session Stripe
   * @returns {Promise<object>} - Kết quả xác minh
   */
  async verifySession(sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      // Kiểm tra xem thanh toán có tồn tại trong DB không
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

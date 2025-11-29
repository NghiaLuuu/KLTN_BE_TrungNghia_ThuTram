const crypto = require('crypto');
const mongoose = require('mongoose');
const axios = require('axios');
const paymentRepository = require('../repositories/payment.repository');
const Payment = require('../models/payment.model');
const { PaymentMethod, PaymentStatus, PaymentType } = require('../models/payment.model');
const config = require('../config');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const redisClient = require('../utils/redis.client');
const { createVNPayPayment } = require('../utils/payment.gateway');
const rpcClient = require('../utils/rpcClient');
const stripeService = require('./stripe.service');
const visaGateway = require('../utils/visa.gateway');
const rabbitmqClient = require('../utils/rabbitmq.client');

class PaymentService {
  constructor() {
    this.cachePrefix = 'payment:';
    this.cacheTTL = 300; // 5 minutes
  }

  // ============ CREATE METHODS ============
  async createPayment(paymentData) {
    try {
      // Validate required fields
      this.validatePaymentData(paymentData);

      // Generate payment code if not provided
      if (!paymentData.paymentCode) {
        paymentData.paymentCode = await this.generatePaymentCode();
      }

      // Set initial status
      if (!paymentData.status) {
        paymentData.status = PaymentStatus.PENDING;
      }

      // Create payment record
      const payment = await paymentRepository.create(paymentData);

      // Process payment based on method
      if (paymentData.method !== PaymentMethod.CASH) {
        await this.initiatePaymentGateway(payment);
      }

      // Clear cache for patient payments
      if (payment.patientId) {
        await this.clearPatientCache(payment.patientId);
      }

      return payment;
    } catch (error) {
      throw new Error(`Lỗi tạo thanh toán: ${error.message}`);
    }
  }

  async createCashPayment(paymentData) {
    const cashPaymentData = {
      ...paymentData,
      method: PaymentMethod.CASH,
      status: PaymentStatus.COMPLETED,
      completedAt: new Date()
    };

    return await this.createPayment(cashPaymentData);
  }

  async createRefundPayment(originalPaymentId, refundData) {
    try {
      // Get original payment
      const originalPayment = await paymentRepository.findById(originalPaymentId);
      if (!originalPayment) {
        throw new Error('Không tìm thấy thanh toán gốc');
      }

      if (originalPayment.status !== PaymentStatus.COMPLETED) {
        throw new Error('Chỉ có thể hoàn tiền từ thanh toán đã hoàn thành');
      }

      // Validate refund amount
      const maxRefundAmount = originalPayment.finalAmount;
      if (refundData.amount > maxRefundAmount) {
        throw new Error('Số tiền hoàn vượt quá số tiền thanh toán gốc');
      }

      // Create refund payment
      const refundPaymentData = {
        ...refundData,
        type: PaymentType.REFUND,
        method: originalPayment.method,
        originalPaymentId: originalPaymentId,
        patientId: originalPayment.patientId,
        patientInfo: originalPayment.patientInfo,
        appointmentId: originalPayment.appointmentId,
        invoiceId: originalPayment.invoiceId,
        recordId: originalPayment.recordId,
        status: PaymentStatus.PENDING
      };

      const refundPayment = await this.createPayment(refundPaymentData);

      // Process refund through gateway if needed
      if (originalPayment.method !== PaymentMethod.CASH) {
        await this.processRefundThroughGateway(refundPayment, originalPayment);
      } else {
        await this.completeRefund(refundPayment._id);
      }

      return refundPayment;
    } catch (error) {
      throw new Error(`Lỗi tạo hoàn tiền: ${error.message}`);
    }
  }

  /**
   * Create payment from completed record
   * Calculate finalAmount based on booking channel (online/offline)
   * - Offline: finalAmount = totalCost
   * - Online: finalAmount = totalCost - depositAmount
   */
  async createPaymentFromRecord(recordId) {
    try {
      console.log('📝 [createPaymentFromRecord] Starting for recordId:', recordId);

      // 1. Get record via RPC
      const recordResponse = await rpcClient.request('record_rpc_queue', {
        action: 'getRecordById',
        payload: { id: recordId }
      });

      if (recordResponse.error) {
        throw new Error(`RPC Error: ${recordResponse.error}`);
      }

      const record = recordResponse.record;
      if (!record) {
        throw new Error('Record not found');
      }

      console.log('📋 [createPaymentFromRecord] Record found:', {
        recordCode: record.recordCode,
        totalCost: record.totalCost,
        bookingChannel: record.bookingChannel,
        appointmentId: record.appointmentId
      });

      // 2. Validate record status
      if (record.status !== 'completed') {
        throw new Error('Record must be completed before creating payment');
      }

      if (!record.totalCost || record.totalCost <= 0) {
        throw new Error('Record totalCost must be greater than 0');
      }

      // 3. Calculate payment amount based on booking channel
      let finalAmount = record.totalCost;
      let depositAmount = 0;
      let depositPayment = null;

      if (record.bookingChannel === 'online' && record.appointmentId) {
        console.log('💰 [createPaymentFromRecord] Online booking detected, checking for deposit...');

        // Get appointment to find deposit payment
        try {
          const appointmentResponse = await rpcClient.request('appointment_rpc_queue', {
            action: 'getAppointmentById',
            payload: { id: record.appointmentId.toString() }
          });

          if (appointmentResponse.error) {
            console.warn('⚠️ Could not get appointment:', appointmentResponse.error);
          } else if (appointmentResponse.appointment && appointmentResponse.appointment.paymentId) {
            const appointment = appointmentResponse.appointment;
            console.log('🎫 [createPaymentFromRecord] Appointment found with paymentId:', appointment.paymentId);

            // Get deposit payment
            depositPayment = await this.getPaymentById(appointment.paymentId);

            if (depositPayment && depositPayment.status === PaymentStatus.COMPLETED) {
              depositAmount = depositPayment.finalAmount;
              finalAmount = Math.max(0, record.totalCost - depositAmount);

              console.log('✅ [createPaymentFromRecord] Deposit payment found:', {
                depositPaymentId: depositPayment._id,
                depositAmount: depositAmount,
                totalCost: record.totalCost,
                finalAmount: finalAmount
              });
            } else {
              console.warn('⚠️ Deposit payment exists but not completed:', depositPayment?.status);
            }
          }
        } catch (appointmentError) {
          console.warn('⚠️ Error fetching appointment:', appointmentError.message);
          // Continue without deposit - fallback to full amount
        }
      }

      // 4. Create payment
      const paymentData = {
        recordId: record._id,
        appointmentId: record.appointmentId || null,
        patientId: record.patientId || null,
        patientInfo: record.patientInfo,
        type: PaymentType.PAYMENT,
        method: PaymentMethod.CASH, // Default, will be changed by user
        status: PaymentStatus.PENDING,
        originalAmount: record.totalCost,
        depositAmount: depositAmount,  // ✅ FIXED: Deposit is separate from discount!
        discountAmount: 0,  // ✅ FIXED: No discount, only deposit deduction
        taxAmount: 0,
        finalAmount: finalAmount,
        paidAmount: 0,
        processedBy: record.dentistId,
        processedByName: record.dentistName,
        description: `Thanh toán ${record.type === 'exam' ? 'khám' : 'điều trị'} - ${record.serviceName}`,
        notes: [
          `Record: ${record.recordCode}`,
          `Booking: ${record.bookingChannel}`,
          depositAmount > 0 ? `Đã trừ tiền cọc: ${depositAmount.toLocaleString('vi-VN')} VNĐ` : 'Không có tiền cọc',
          depositPayment ? `Deposit Payment: ${depositPayment.paymentCode}` : ''
        ].filter(Boolean).join('\n')
      };

      const payment = await this.createPayment(paymentData);

      console.log('✅ [createPaymentFromRecord] Payment created:', {
        paymentId: payment._id,
        paymentCode: payment.paymentCode,
        finalAmount: payment.finalAmount
      });

      return payment;
    } catch (error) {
      console.error('❌ [createPaymentFromRecord] Error:', error);
      throw new Error(`Lỗi tạo thanh toán từ record: ${error.message}`);
    }
  }

  // ============ GET METHODS ============
  async getPaymentById(id) {
    try {
      const cacheKey = `${this.cachePrefix}${id}`;
      
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const payment = await paymentRepository.findById(id);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Cache the result
      await redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(payment));
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi lấy thông tin thanh toán: ${error.message}`);
    }
  }

  async getPaymentByCode(code) {
    try {
      const cacheKey = `${this.cachePrefix}code:${code}`;
      
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const payment = await paymentRepository.findByCode(code);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Cache the result
      await redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(payment));
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi lấy thanh toán theo mã: ${error.message}`);
    }
  }

  async getPatientPayments(patientId, options = {}) {
    try {
      const cacheKey = `${this.cachePrefix}patient:${patientId}`;
      
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached && !options.page) {
        return JSON.parse(cached);
      }

      // Get from database
      const payments = await paymentRepository.findByPatient(patientId, options);

      // Cache the result (only for first page)
      if (!options.page || options.page === 1) {
        await redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(payments));
      }
      
      return payments;
    } catch (error) {
      throw new Error(`Lỗi lấy thanh toán bệnh nhân: ${error.message}`);
    }
  }

  async getAppointmentPayments(appointmentId) {
    const payments = await paymentRepository.findByAppointment(appointmentId);
    return payments;
  }

  async getInvoicePayments(invoiceId) {
    const payments = await paymentRepository.findByInvoice(invoiceId);
    return payments;
  }

  async getPaymentsByRecordId(recordId) {
    const payments = await paymentRepository.findByRecord(recordId);
    return payments;
  }

  // ============ LIST & SEARCH METHODS ============
  async listPayments(filter = {}, options = {}) {
    return await paymentRepository.findAll(filter, options);
  }

  async searchPayments(searchTerm, options = {}) {
    return await paymentRepository.search(searchTerm, options);
  }

  async getPendingPayments(limit = 50) {
    return await paymentRepository.findPending(limit);
  }

  async getProcessingPayments() {
    return await paymentRepository.findProcessing();
  }

  async getFailedPayments(limit = 100) {
    return await paymentRepository.findFailed(limit);
  }

  async getTodayPayments() {
    const cacheKey = `${this.cachePrefix}today`;
    
    // Check cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const payments = await paymentRepository.findTodayPayments();
    
    // Cache for 10 minutes
    await redisClient.setEx(cacheKey, 600, JSON.stringify(payments));
    
    return payments;
  }

  // ============ UPDATE METHODS ============
  async updatePayment(id, updateData) {
    try {
      const payment = await paymentRepository.update(id, updateData);
      
      if (payment) {
        // Clear relevant caches
        await this.clearPaymentCache(id);
        if (payment.patientId) {
          await this.clearPatientCache(payment.patientId);
        }
      }
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi cập nhật thanh toán: ${error.message}`);
    }
  }

  async updatePaymentStatus(id, status, additionalData = {}) {
    try {
      const payment = await paymentRepository.updateStatus(id, status, additionalData);
      
      if (payment) {
        // Clear caches
        await this.clearPaymentCache(id);
        if (payment.patientId) {
          await this.clearPatientCache(payment.patientId);
        }

        // Handle status-specific logic
        await this.handleStatusChange(payment, status);
      }
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi cập nhật trạng thái thanh toán: ${error.message}`);
    }
  }

  async confirmPayment(id, gatewayResponse = {}) {
    return await this.updatePaymentStatus(id, PaymentStatus.COMPLETED, {
      gatewayResponse,
      completedAt: new Date()
    });
  }

  async failPayment(id, reason) {
    return await paymentRepository.failPayment(id, reason);
  }

  async cancelPayment(id, reason = '') {
    const updateData = {
      cancelReason: reason,
      cancelledAt: new Date()
    };
    
    return await this.updatePaymentStatus(id, PaymentStatus.CANCELLED, updateData);
  }

  async completeRefund(refundPaymentId) {
    return await this.updatePaymentStatus(refundPaymentId, PaymentStatus.COMPLETED);
  }

  async verifyPayment(id, verifiedBy) {
    return await paymentRepository.verify(id, verifiedBy);
  }

  // ============ PAYMENT GATEWAY METHODS ============
  async initiatePaymentGateway(payment) {
    try {
      let gatewayResponse;
      
      // Only VNPay is supported
      if (payment.method !== PaymentMethod.VNPAY) {
        throw new Error(`Phương thức thanh toán ${payment.method} không được hỗ trợ. Chỉ hỗ trợ VNPay.`);
      }

      // Get IP address from payment data or use default
      const ipAddr = payment.ipAddress || '127.0.0.1';
      const paymentUrl = createVNPayPayment(
        payment.paymentCode,
        payment.finalAmount,
        payment.description || `Thanh toán ${payment.paymentCode}`,
        ipAddr,
        payment.bankCode || '',
        'vn'
      );
      gatewayResponse = {
        paymentUrl,
        transactionId: payment.paymentCode
      };

      // Update payment with gateway info
      await this.updatePayment(payment._id, {
        externalTransactionId: gatewayResponse.transactionId,
        gatewayResponse: gatewayResponse,
        status: PaymentStatus.PROCESSING
      });

      return gatewayResponse;
    } catch (error) {
      // Mark payment as failed
      await this.failPayment(payment._id, error.message);
      throw error;
    }
  }

  async processGatewayCallback(callbackData) {
    try {
      const { orderId, status, transactionId, amount } = callbackData;
      
      console.log('🔍 [processGatewayCallback] Processing:', { orderId, status, transactionId });
      
      // Check if this is for an existing payment (from record)
      const mappingKey = `payment:vnpay:${orderId}`;
      const existingPaymentId = await redisClient.get(mappingKey);
      
      if (existingPaymentId) {
        console.log('📝 [processGatewayCallback] Found existing payment mapping:', existingPaymentId);
        return await this.updateExistingPaymentFromVNPay(existingPaymentId, {
          orderId,
          status,
          transactionId,
          amount
        });
      }
      
      // Otherwise, process as temporary payment (appointment booking)
      const reservationId = orderId;
      const tempPaymentKey = `payment:temp:${reservationId}`;
      
      // Get temporary payment from Redis
      const tempPaymentData = await redisClient.get(tempPaymentKey);
      if (!tempPaymentData) {
        console.error('❌ Temporary payment not found:', tempPaymentKey);
        throw new Error('Temporary payment not found or expired');
      }
      
      const tempPayment = JSON.parse(tempPaymentData);

      // Create permanent payment record in DB
      if (status === 'success') {
        // Get appointment hold data for patient info and services
        const appointmentHoldKey = tempPayment.appointmentHoldKey || reservationId;
        
        // Try multiple possible Redis keys (different services use different prefixes)
        const possibleKeys = [
          appointmentHoldKey,  // Direct key (e.g., "RSV1760631740748")
          `appointment_hold:${appointmentHoldKey}`,
          `reservation:${appointmentHoldKey}`,
          `temp_reservation:${appointmentHoldKey}`
        ];
        
        let patientInfo = {
          name: 'Bệnh nhân',
          phone: '0000000000'
        };
        let appointmentData = null;
        let foundKey = null;
        
        try {
          // Try each possible key until we find the data
          for (const key of possibleKeys) {
            const appointmentDataStr = await redisClient.get(key);
            if (appointmentDataStr) {
              appointmentData = JSON.parse(appointmentDataStr);
              foundKey = key;
              console.log('✅ [DEBUG] Appointment data found in Redis:', {
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
            console.error('❌ [DEBUG] No appointment data found in redisClient. Tried keys:', possibleKeys);
            // Don't throw - continue with limited data
          }
          
          // Extract patient info
          if (appointmentData && appointmentData.patientInfo) {
            patientInfo = {
              name: appointmentData.patientInfo.fullName || appointmentData.patientInfo.name || 'Bệnh nhân',
              phone: appointmentData.patientInfo.phone || '0000000000',
              email: appointmentData.patientInfo.email || null,
              address: appointmentData.patientInfo.address || null
            };
          }
        } catch (err) {
          console.error('❌ [DEBUG] Error fetching appointment data:', err.message);
        }
        
        const paymentAmount = amount || tempPayment.amount;
        
        const paymentData = {
          paymentCode: tempPayment.orderId,
          appointmentId: null,
          patientId: tempPayment.patientId || null,
          patientInfo: patientInfo,
          type: 'payment',
          method: 'vnpay',
          status: 'completed',
          originalAmount: paymentAmount,
          discountAmount: 0,
          taxAmount: 0,
          finalAmount: paymentAmount,
          paidAmount: paymentAmount,
          changeAmount: 0,
          externalTransactionId: transactionId,
          gatewayResponse: {
            responseCode: '00',
            responseMessage: 'Success',
            additionalData: {
              reservationId,
              vnp_TxnRef: reservationId,
              gateway: 'vnpay',
              processedAt: new Date(),
              vnpayUrl: tempPayment.vnpayUrl || null,
              vnpayCreatedAt: tempPayment.vnpayCreatedAt || null
            }
          },
          processedBy: new mongoose.Types.ObjectId(),
          processedByName: 'VNPay Gateway',
          processedAt: new Date(),
          description: `Thanh toán VNPay cho đơn hàng ${tempPayment.orderId}`,
          notes: `Reservation ID: ${reservationId}`,
          isVerified: true,
          verifiedAt: new Date()
        };
        
        console.log('💾 Payment data includes VNPay URL:', !!tempPayment.vnpayUrl);
        
        const payment = await paymentRepository.create(paymentData);
        console.log('✅ Payment created:', payment._id);
        
        // Delete temp payment from Redis
        await redisClient.del(tempPaymentKey);
        
        // Publish events after successful payment
        if (appointmentData) {
          try {
            // STEP 1: Create Invoice FIRST
            await rabbitmqClient.publishToQueue('invoice_queue', {
              event: 'payment.completed',
              data: {
                reservationId: reservationId,
                paymentId: payment._id.toString(),
                paymentCode: payment.paymentCode,
                amount: paymentAmount,
                patientInfo: patientInfo,
                appointmentData: appointmentData
              }
            });

            // STEP 2: Create Appointment (will query invoice by paymentId)
            await rabbitmqClient.publishToQueue('appointment_queue', {
              event: 'payment.completed',
              data: {
                reservationId: reservationId,
                paymentId: payment._id.toString(),
                paymentCode: payment.paymentCode,
                amount: paymentAmount,
                appointmentData: appointmentData
              }
            });

            // � STEP 3: Mark Service/ServiceAddOn as Used
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

            // STEP 3: Mark exam record as used (if needed)
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

          } catch (eventError) {
            console.error('⚠️ Error publishing events:', eventError.message);
            // Don't throw - payment already created successfully
          }
        } else {
          console.warn('⚠️ [Payment] appointmentData is NULL or UNDEFINED - Events NOT published!', {
            appointmentData,
            reservationId,
            tempPaymentKey,
            appointmentHoldKey
          });
        }
        
        return payment;
      } else {
        console.error('❌ Payment failed from gateway');
        await redisClient.del(tempPaymentKey);
        throw new Error('Payment failed from gateway');
      }
    } catch (error) {
      console.error('❌ [Process Callback] Error:', error);
      throw new Error(`Lỗi xử lý callback: ${error.message}`);
    }
  }

  async processRefundThroughGateway(refundPayment, originalPayment) {
    // Implementation depends on gateway APIs
    // For now, mark as completed (would need actual gateway integration)
    return await this.completeRefund(refundPayment._id);
  }

  // ============ STATISTICS METHODS ============
  async getPaymentStatistics(startDate, endDate, groupBy = 'day') {
    try {
      const cacheKey = `${this.cachePrefix}stats:${groupBy}:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await paymentRepository.getStatistics(startDate, endDate, groupBy);
      
      // Cache for 1 hour
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      throw new Error(`Lỗi lấy thống kê thanh toán: ${error.message}`);
    }
  }

  async getRevenueStatistics(startDate, endDate) {
    try {
      const cacheKey = `${this.cachePrefix}revenue:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await paymentRepository.getRevenueStats(startDate, endDate);
      
      // Cache for 30 minutes
      await redisClient.setEx(cacheKey, 1800, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      throw new Error(`Lỗi lấy thống kê doanh thu: ${error.message}`);
    }
  }

  async getRefundStatistics(startDate, endDate) {
    try {
      const stats = await paymentRepository.getRefundStats(startDate, endDate);
      return stats;
    } catch (error) {
      throw new Error(`Lỗi lấy thống kê hoàn tiền: ${error.message}`);
    }
  }

  // ============ RPC METHODS ============
  async createTemporaryPayment(payload) {
    const { appointmentHoldKey, amount } = payload;
    if (!appointmentHoldKey) throw new Error('appointmentHoldKey is required');

    const tempPaymentId = `payment:temp:${appointmentHoldKey}`;

    // Tạo orderId duy nhất
    const shortHash = crypto.createHash('sha256')
      .update(tempPaymentId)
      .digest('hex')
      .slice(0, 10);

    const orderId = `ORD${Date.now()}${shortHash}`.replace(/[^0-9a-zA-Z]/g, '').substring(0, 20);

    // Thời gian hiện tại
    const now = new Date();
    // Thời gian hết hạn 15 phút (match với reservation TTL)
    const expireAt = new Date(now.getTime() + 15 * 60 * 1000);

    const data = {
      tempPaymentId,
      appointmentHoldKey,
      amount: Math.round(Number(amount) || 0),
      status: 'PENDING',
      createdAt: now,
      expireAt,
      orderId
    };

    // Lưu tạm vào Redis với TTL 3 phút
    await redisClient.setEx(tempPaymentId, 180, JSON.stringify(data)); // 3 minutes

    // Return frontend payment selection URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    data.paymentUrl = `${frontendUrl}/patient/payment/select?reservationId=${appointmentHoldKey}&orderId=${orderId}`;

    console.log('✅ Temporary payment created:', { orderId, tempPaymentId, amount: data.amount });
    return data;
  }

  /**
   * Create VNPay payment URL for appointment
   * Called from frontend when user selects VNPay on payment selection page
   */
  async createVNPayPaymentUrl(orderId, amount, orderInfo, ipAddr, bankCode = '', locale = 'vn', userRole = 'patient') {
    try {
      console.log('='.repeat(60));
      console.log('🔍 [Create VNPay URL] ROLE STORAGE DEBUG');
      console.log('='.repeat(60));
      console.log('📋 Order ID:', orderId);
      console.log('👤 User Role (received):', userRole);
      console.log('📊 Role Type:', typeof userRole);
      
      const paymentUrl = createVNPayPayment(
        orderId,
        amount,
        orderInfo || `Thanh toán đơn hàng ${orderId}`,
        ipAddr,
        bankCode,
        locale
      );
      
      // Store user role in Redis for later use in return URL redirect
      // TTL: 30 minutes (enough time for payment process)
      const roleKey = `payment:role:${orderId}`;
      const roleToStore = userRole || 'patient';
      
      console.log('🔑 Redis Key:', roleKey);
      console.log('💾 Storing Role:', roleToStore);
      
      await redisClient.setEx(roleKey, 1800, roleToStore);
      
      console.log('✅ Role stored in Redis successfully');
      
      // Verify storage
      const verifyRole = await redisClient.get(roleKey);
      console.log('✔️  Verification - Role retrieved:', verifyRole);
      
      // Store VNPay URL in temp payment for later persistence
      const tempPaymentKey = `payment:temp:${orderId}`;
      const tempPaymentData = await redisClient.get(tempPaymentKey);
      if (tempPaymentData) {
        const tempPayment = JSON.parse(tempPaymentData);
        tempPayment.vnpayUrl = paymentUrl;
        tempPayment.vnpayCreatedAt = new Date().toISOString();
        await redisClient.setEx(tempPaymentKey, 180, JSON.stringify(tempPayment)); // 3 minutes
        console.log('💾 VNPay URL saved to temp payment:', tempPaymentKey);
      } else {
        console.warn('⚠️  Temp payment not found, VNPay URL not saved:', tempPaymentKey);
      }
      
      console.log('='.repeat(60));
      
      console.log('✅ VNPay payment URL created:', { orderId, amount, userRole: roleToStore });
      return { paymentUrl, orderId };
    } catch (err) {
      console.error('❌ Failed to create VNPay payment URL:', err);
      throw new Error('Cannot create VNPay payment link');
    }
  }

  /**
   * Create VNPay URL for existing payment (from record)
   * Used when staff wants to create VNPay payment for a cash payment
   */
  async createVNPayUrlForExistingPayment(paymentId, ipAddr, userRole = 'patient') {
    try {
      console.log('🔍 [Create VNPay URL for Existing Payment]:', { paymentId });
      
      // Get payment from database
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      // Validate payment status
      if (payment.status === 'completed') {
        throw new Error('Payment already completed');
      }
      
      if (payment.status === 'cancelled') {
        throw new Error('Cannot create VNPay URL for cancelled payment');
      }
      
      // Create unique orderId for VNPay
      const orderId = `PAY${Date.now()}${payment._id.toString().slice(-6)}`;
      const amount = payment.finalAmount;
      const orderInfo = `Thanh toán ${payment.paymentCode}`;
      
      console.log('📝 [Create VNPay URL] Payment details:', {
        paymentCode: payment.paymentCode,
        orderId,
        amount,
        status: payment.status
      });
      
      // Create VNPay payment URL
      const paymentUrl = createVNPayPayment(
        orderId,
        amount,
        orderInfo,
        ipAddr,
        '', // bankCode
        'vn' // locale
      );
      
      // Store mapping between orderId and paymentId in Redis
      const mappingKey = `payment:vnpay:${orderId}`;
      await redisClient.setEx(mappingKey, 1800, paymentId.toString()); // 30 min TTL
      
      // Store user role for redirect
      const roleKey = `payment:role:${orderId}`;
      await redisClient.setEx(roleKey, 1800, userRole);
      
      // Update payment with VNPay URL and orderId
      payment.gatewayResponse = payment.gatewayResponse || {};
      payment.gatewayResponse.additionalData = payment.gatewayResponse.additionalData || {};
      payment.gatewayResponse.additionalData.vnpayUrl = paymentUrl;
      payment.gatewayResponse.additionalData.vnpayOrderId = orderId;
      payment.gatewayResponse.additionalData.vnpayCreatedAt = new Date();
      payment.method = 'vnpay'; // Update method to VNPay
      payment.status = 'processing'; // Update status
      
      await payment.save();
      
      console.log('✅ [Create VNPay URL] URL created and saved:', { orderId, paymentId });
      
      return {
        paymentUrl,
        orderId,
        paymentId: payment._id,
        amount
      };
    } catch (err) {
      console.error('❌ [Create VNPay URL for Existing Payment] Error:', err);
      throw err;
    }
  }

  /**
   * Create Stripe URL for existing payment (from record)
   * Used when staff wants to create Stripe payment for a cash payment
   */
  async createStripeUrlForExistingPayment(paymentId, userRole = 'patient') {
    try {
      console.log('🔍 [Create Stripe URL for Existing Payment]:', { paymentId });
      
      // Get payment from database
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      // Validate payment status
      if (payment.status === 'completed') {
        throw new Error('Payment already completed');
      }
      
      if (payment.status === 'cancelled') {
        throw new Error('Cannot create Stripe URL for cancelled payment');
      }
      
      // Create unique orderId for Stripe
      const orderId = `PAY${Date.now()}${payment._id.toString().slice(-6)}`;
      
      // Get amount - fetch from record if payment.finalAmount is 0 (dashboard payment)
      let amount = payment.finalAmount;
      
      if (amount === 0 && payment.recordId) {
        console.log('⚠️ [Create Stripe URL] Amount is 0, fetching from record:', payment.recordId);
        
        try {
          const recordServiceUrl = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
          const recordResponse = await axios.get(
            `${recordServiceUrl}/api/record/${payment.recordId}`
          );
          
          const recordData = recordResponse.data?.data || recordResponse.data;
          console.log('📋 [Create Stripe URL] Record data:', {
            recordId: payment.recordId,
            serviceAmount: recordData.serviceAmount,
            serviceAddOnPrice: recordData.serviceAddOnPrice,
            depositPaid: recordData.depositPaid
          });
          
          // 🔥 FIX: Use serviceAddOnPrice (actual variant price) instead of servicePrice (base price)
          const serviceAmount = recordData.serviceAddOnPrice || recordData.serviceAmount || 0;
          const depositAmount = recordData.depositPaid || 0;
          amount = Math.max(0, serviceAmount - depositAmount);
          
          if (amount === 0) {
            throw new Error('Không thể tính toán số tiền thanh toán. Vui lòng kiểm tra lại thông tin dịch vụ.');
          }
          
          // Update payment with calculated amounts
          payment.originalAmount = serviceAmount;
          payment.depositAmount = depositAmount;  // ✅ FIXED: Correct field!
          payment.discountAmount = 0;  // ✅ FIXED: No real discount
          payment.taxAmount = 0;
          payment.finalAmount = amount;
          await payment.save();
          
          console.log('✅ [Create Stripe URL] Amount calculated from record:', { 
            serviceAmount, 
            depositAmount, 
            finalAmount: amount 
          });
        } catch (error) {
          console.error('❌ [Create Stripe URL] Failed to fetch amount from record:', error.message);
          throw new Error('Không thể lấy thông tin số tiền từ hồ sơ. Vui lòng thử lại.');
        }
      }
      
      if (!amount || amount <= 0) {
        throw new Error('Số tiền thanh toán không hợp lệ');
      }
      
      const orderInfo = `Thanh toan ${payment.paymentCode}`;
      
      console.log('📝 [Create Stripe URL] Payment details:', {
        paymentCode: payment.paymentCode,
        orderId,
        amount,
        status: payment.status
      });
      
      // Get patient email from payment
      const customerEmail = payment.patientInfo?.email || '';
      
      // Create Stripe payment link
      const result = await stripeService.createPaymentLink(
        orderId,
        amount,
        orderInfo,
        customerEmail,
        {
          patientName: payment.patientInfo?.name || '',
          patientPhone: payment.patientInfo?.phone || '',
          paymentCode: payment.paymentCode
        },
        userRole
      );
      
      // Store mapping between orderId and paymentId in Redis
      const mappingKey = `payment:stripe:${orderId}`;
      await redisClient.setEx(mappingKey, 1800, paymentId.toString()); // 30 min TTL
      
      // Update payment with Stripe URL and orderId
      payment.gatewayResponse = payment.gatewayResponse || {};
      payment.gatewayResponse.additionalData = payment.gatewayResponse.additionalData || {};
      payment.gatewayResponse.additionalData.stripeUrl = result.paymentUrl;
      payment.gatewayResponse.additionalData.stripeOrderId = orderId;
      payment.gatewayResponse.additionalData.stripeSessionId = result.sessionId;
      payment.gatewayResponse.additionalData.stripeCreatedAt = new Date();
      payment.method = 'stripe'; // Update method to Stripe
      payment.status = 'processing'; // Update status
      
      await payment.save();
      
      console.log('✅ [Create Stripe URL] URL created and saved:', { orderId, paymentId, sessionId: result.sessionId });
      
      return {
        paymentUrl: result.paymentUrl,
        orderId,
        paymentId: payment._id,
        sessionId: result.sessionId,
        amount
      };
    } catch (err) {
      console.error('❌ [Create Stripe URL for Existing Payment] Error:', err);
      throw err;
    }
  }

  /**
   * Update existing payment from VNPay callback
   * Used when payment was created from record
   */
  async updateExistingPaymentFromVNPay(paymentId, callbackData) {
    try {
      const { orderId, status, transactionId, amount } = callbackData;
      
      console.log('🔄 [Update Existing Payment] Starting:', { paymentId, orderId, status });
      
      // Get payment from database
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }
      
      console.log('📝 [Update Existing Payment] Current payment:', {
        paymentCode: payment.paymentCode,
        status: payment.status,
        method: payment.method,
        finalAmount: payment.finalAmount,
        recordId: payment.recordId
      });
      
      // ✅ If finalAmount is 0 and has recordId, fetch from record service
      if (payment.finalAmount === 0 && payment.recordId) {
        console.log('⚠️ [Update Existing Payment] finalAmount is 0, fetching from record:', payment.recordId);
        
        try {
          const recordServiceUrl = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
          const recordResponse = await axios.get(
            `${recordServiceUrl}/api/record/${payment.recordId}`
          );
          
          const recordData = recordResponse.data?.data || recordResponse.data;
          console.log('📋 [Update Existing Payment] Record data:', {
            recordId: payment.recordId,
            serviceAmount: recordData.serviceAmount,
            serviceAddOnPrice: recordData.serviceAddOnPrice,
            depositPaid: recordData.depositPaid
          });
          
          // 🔥 FIX: Use serviceAddOnPrice (actual variant price) instead of servicePrice (base price)
          const serviceAmount = recordData.serviceAddOnPrice || recordData.serviceAmount || 0;
          const depositAmount = recordData.depositPaid || 0;
          const calculatedAmount = Math.max(0, serviceAmount - depositAmount);
          
          // Update payment amounts
          payment.originalAmount = serviceAmount;
          payment.depositAmount = depositAmount;  // ✅ FIXED: Correct field!
          payment.discountAmount = 0;  // ✅ FIXED: No real discount
          payment.taxAmount = 0;
          payment.finalAmount = calculatedAmount;
          
          console.log('✅ [Update Existing Payment] Amount calculated from record:', { 
            serviceAmount, 
            depositAmount, 
            finalAmount: calculatedAmount 
          });
        } catch (error) {
          console.error('❌ [Update Existing Payment] Failed to fetch amount from record:', error.message);
        }
      }
      
      // Update payment based on VNPay response
      if (status === 'success') {
        payment.status = 'completed';
        payment.externalTransactionId = transactionId;
        payment.paidAmount = payment.finalAmount;  // ✅ Now this will be correct
        payment.processedAt = new Date();
        payment.completedAt = new Date();
        
        // Update gateway response
        payment.gatewayResponse = payment.gatewayResponse || {};
        payment.gatewayResponse.responseCode = '00';
        payment.gatewayResponse.responseMessage = 'Success';
        payment.gatewayResponse.transactionId = transactionId;
        payment.gatewayResponse.completedAt = new Date();
        
        console.log('✅ [Update Existing Payment] Payment completed successfully');
      } else {
        payment.status = 'failed';
        payment.gatewayResponse = payment.gatewayResponse || {};
        payment.gatewayResponse.responseCode = 'FAILED';
        payment.gatewayResponse.responseMessage = 'Payment failed';
        payment.gatewayResponse.failedAt = new Date();
        
        console.log('❌ [Update Existing Payment] Payment failed');
      }
      
      await payment.save();
      
      // Clean up Redis mapping
      const mappingKey = `payment:vnpay:${orderId}`;
      await redisClient.del(mappingKey);
      
      // If payment completed and has recordId, trigger invoice creation
      if (status === 'success' && payment.recordId) {
        try {
          console.log('📄 [Update Existing Payment] Triggering invoice creation for record:', payment.recordId);
          
          const eventData = {
            paymentId: payment._id.toString(),
            paymentCode: payment.paymentCode,
            recordId: payment.recordId.toString(),
            appointmentId: payment.appointmentId ? payment.appointmentId.toString() : null,
            patientId: payment.patientId ? payment.patientId.toString() : null,
            patientInfo: payment.patientInfo,
            method: payment.method,
            originalAmount: payment.originalAmount,
            depositAmount: payment.depositAmount || 0,  // ✅ Add deposit amount
            discountAmount: payment.discountAmount || 0, // ✅ Real discount (not deposit)
            taxAmount: payment.taxAmount || 0,  // ✅ Add tax amount
            finalAmount: payment.finalAmount,
            paidAmount: payment.paidAmount,
            changeAmount: payment.changeAmount || 0,
            completedAt: payment.completedAt,
            processedBy: payment.processedBy ? payment.processedBy.toString() : null,
            processedByName: payment.processedByName || 'System'
          };
          
          console.log('📤 [Update Existing Payment] Publishing payment.success event:', eventData);
          
          await rabbitmqClient.publishToQueue('invoice_queue', {
            event: 'payment.success',
            data: eventData
          });
          
          console.log('✅ [Update Existing Payment] Invoice creation event sent');
        } catch (err) {
          console.error('❌ [Update Existing Payment] Failed to send invoice event:', err);
        }
      }
      
      console.log('✅ [Update Existing Payment] Completed:', payment._id);
      return payment;
    } catch (err) {
      console.error('❌ [Update Existing Payment] Error:', err);
      throw err;
    }
  }

  // RPC: confirm payment (từ Redis -> DB + notify Appointment Service)
  async confirmPaymentRPC(payload) {
    if (!payload || !payload.id) throw new Error('Payment ID is required');

    // 1️⃣ Nếu temp payment
    if (payload.id.startsWith('payment:temp:')) {
      const raw = await redisClient.get(payload.id);
      if (!raw) throw new Error('Temporary payment not found or expired');
      const tempData = JSON.parse(raw);

      const savedPayment = await this.createPayment({
        amount: tempData.amount,
        method: tempData.method
      });

      await redisClient.del(payload.id);

      // Xử lý appointment
      if (tempData.appointmentHoldKey) {
        const appointmentRaw = await redisClient.get(tempData.appointmentHoldKey);
        if (appointmentRaw) {
          const appointmentData = JSON.parse(appointmentRaw);
          appointmentData.status = 'confirmed';
          await redisClient.setEx(tempData.appointmentHoldKey, 600, JSON.stringify(appointmentData));
          console.log(`✅ Temporary appointment updated to confirmed in Redis for holdKey ${tempData.appointmentHoldKey}`);
        }

        try {
          await rpcClient.request('appointment_queue', {
            action: 'confirmAppointmentWithPayment',
            payload: {
              holdKey: String(tempData.appointmentHoldKey),
              paymentId: String(savedPayment._id)
            }
          });
          console.log(`✅ Appointment creation triggered for holdKey ${tempData.appointmentHoldKey}`);
        } catch (err) {
          console.error('❌ Failed to notify Appointment Service:', err.message);
        }
      }

      return savedPayment;
    }

    // 2️⃣ Nếu payload.id là ObjectId hợp lệ, confirm MongoDB Payment
    if (payload.id.match(/^[0-9a-fA-F]{24}$/)) {
      return this.confirmPayment(payload.id);
    }

    // 3️⃣ Nếu không phải temp payment và không phải ObjectId → lỗi hợp lệ
    throw new Error('Invalid Payment ID format');
  }

  async getPaymentByIdRPC(payload) {
    console.log('🔍 [getPaymentByIdRPC] Called with payload:', payload);
    if (!payload.id) throw new Error('Payment ID is required');
    
    if (payload.id.startsWith('payment:temp:')) {
      console.log('📦 [getPaymentByIdRPC] Fetching temp payment from Redis:', payload.id);
      const raw = await redisClient.get(payload.id);
      const result = raw ? JSON.parse(raw) : null;
      console.log('✅ [getPaymentByIdRPC] Temp payment result:', result ? 'Found' : 'Not found');
      return result;
    }
    
    console.log('📊 [getPaymentByIdRPC] Fetching payment from DB:', payload.id);
    const result = await this.getPaymentById(payload.id);
    console.log('✅ [getPaymentByIdRPC] DB payment result:', result ? 'Found' : 'Not found');
    return result;
  }

  async manualConfirmPayment({ paymentId }) {
    if (!paymentId) throw new Error("Cần cung cấp paymentId");

    // 1️⃣ Lấy payment
    const payment = await paymentRepository.findById(paymentId);
    if (!payment) throw new Error(`Không tìm thấy payment với id: ${paymentId}`);

    // 2️⃣ Cập nhật trạng thái
    const updatedPayment = await paymentRepository.updateStatus(paymentId, PaymentStatus.COMPLETED);

    return { message: "Xác nhận thanh toán thành công", payment: updatedPayment };
  }

  async updateAppointmentCode(paymentId, appointmentCode) {
    if (!paymentId || !appointmentCode) {
      throw new Error('paymentId và appointmentCode là bắt buộc');
    }

    // 🔹 Lấy payment trước khi update
    const paymentBefore = await paymentRepository.findById(paymentId);
    console.log('🔹 Payment trước khi update:', paymentBefore);

    if (!paymentBefore) {
      throw new Error(`Không tìm thấy payment với id: ${paymentId}`);
    }

    // 🔹 Cập nhật appointmentCode
    const paymentAfter = await paymentRepository.update(paymentId, {
      appointmentCode: String(appointmentCode)
    });
    console.log('🔹 Payment sau khi update:', paymentAfter);

    return paymentAfter;
  }

  // ============ HELPER METHODS ============
  validatePaymentData(paymentData) {
    if (!paymentData.amount || paymentData.amount <= 0) {
      throw new Error('Số tiền thanh toán phải lớn hơn 0');
    }

    if (!paymentData.method) {
      throw new Error('Phương thức thanh toán là bắt buộc');
    }

    if (!Object.values(PaymentMethod).includes(paymentData.method)) {
      throw new Error('Phương thức thanh toán không hợp lệ');
    }

    if (!paymentData.patientInfo || !paymentData.patientInfo.name) {
      throw new Error('Thông tin bệnh nhân là bắt buộc');
    }
  }

  async generatePaymentCode() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `PAY${timestamp}${random}`;
  }

  async handleStatusChange(payment, status) {
    switch (status) {
      case PaymentStatus.COMPLETED:
        await this.handlePaymentCompleted(payment);
        break;
      case PaymentStatus.FAILED:
        await this.handlePaymentFailed(payment);
        break;
      case PaymentStatus.CANCELLED:
        await this.handlePaymentCancelled(payment);
        break;
    }
  }

  async handlePaymentCompleted(payment) {
    // Notify other services about payment completion
    try {
      if (payment.appointmentId) {
        await rpcClient.request('appointment_queue', {
          action: 'paymentCompleted',
          payload: { appointmentId: payment.appointmentId, paymentId: payment._id }
        });
      }
      
      if (payment.invoiceId) {
        await rpcClient.request('invoice_queue', {
          action: 'paymentCompleted',
          payload: { invoiceId: payment.invoiceId, paymentId: payment._id }
        });
      }
    } catch (error) {
      console.error('Error notifying services about payment completion:', error);
    }
  }

  async handlePaymentFailed(payment) {
    // Handle failed payment logic
    console.log(`Payment ${payment._id} failed`);
  }

  async handlePaymentCancelled(payment) {
    // Handle cancelled payment logic
    console.log(`Payment ${payment._id} cancelled`);
  }

  async clearPaymentCache(id) {
    await redisClient.del(`${this.cachePrefix}${id}`);
  }

  async clearPatientCache(patientId) {
    await redisClient.del(`${this.cachePrefix}patient:${patientId}`);
  }

  // ============ VISA PAYMENT PROCESSING ============
  /**
   * Process Visa card payment through sandbox gateway
   * @param {Object} paymentData - Payment data including card info and reservation
   * @returns {Object} Payment result with transaction details
   */
  async processVisaPayment(paymentData) {
    try {
      const {
        reservationId,
        cardNumber,
        cardHolder,
        expiryMonth,
        expiryYear,
        cvv,
        amount,
        patientId,
        patientInfo
      } = paymentData;

      // Validate required fields
      if (!reservationId || !cardNumber || !cardHolder || !expiryMonth || !expiryYear || !cvv) {
        throw new BadRequestError('Thiếu thông tin thanh toán');
      }

      // Get reservation from Redis
      const reservationKey = `temp_reservation:${reservationId}`;
      const reservationData = await redisClient.get(reservationKey);
      
      if (!reservationData) {
        throw new BadRequestError('Đặt khám đã hết hạn hoặc không tồn tại. Vui lòng đặt lại.');
      }

      const reservation = JSON.parse(reservationData);

      // Validate amount matches reservation
      if (amount && Math.abs(amount - reservation.totalAmount) > 0.01) {
        throw new BadRequestError('Số tiền thanh toán không khớp với đặt khám');
      }

      // Process payment through Visa gateway
      console.log('Processing Visa payment:', {
        reservationId,
        amount: reservation.totalAmount,
        cardLast4: cardNumber.slice(-4)
      });

      const paymentResult = await visaGateway.processPayment({
        cardNumber,
        cardHolder,
        expiryMonth,
        expiryYear,
        cvv,
        amount: reservation.totalAmount,
        currency: 'VND',
        description: `Payment for appointment reservation ${reservationId}`,
        metadata: {
          reservationId,
          patientId: reservation.patientId,
          serviceId: reservation.serviceId,
          doctorId: reservation.doctorId
        }
      });

      // Check payment result
      if (!paymentResult.success) {
        // Payment failed - publish event
        await rabbitmqClient.publishToQueue('payment.failed', {
          reservationId,
          reason: paymentResult.message || 'Payment declined by gateway',
          errorCode: paymentResult.errorCode,
          timestamp: new Date().toISOString()
        });

        throw new BadRequestError(
          paymentResult.message || 'Thanh toán thất bại. Vui lòng kiểm tra lại thẻ.'
        );
      }

      // Payment successful - create payment record
      const paymentCode = await this.generatePaymentCode();
      
      const payment = await Payment.create({
        paymentCode,
        patientId: reservation.patientId,
        patientInfo: {
          name: reservation.patientName,
          phone: reservation.patientPhone,
          email: patientInfo?.email || '',
          address: patientInfo?.address || ''
        },
        type: PaymentType.PAYMENT,
        method: PaymentMethod.VISA,
        status: PaymentStatus.COMPLETED,
        originalAmount: reservation.totalAmount,
        discountAmount: 0,
        taxAmount: 0,
        finalAmount: reservation.totalAmount,
        paidAmount: reservation.totalAmount,
        changeAmount: 0,
        cardInfo: {
          cardType: 'visa',
          cardLast4: paymentResult.cardLast4,
          cardHolder: cardHolder,
          authorizationCode: paymentResult.authorizationCode,
          transactionId: paymentResult.transactionId
        },
        externalTransactionId: paymentResult.transactionId,
        gatewayResponse: {
          responseCode: paymentResult.status,
          responseMessage: paymentResult.message || 'Payment successful',
          additionalData: {
            authorizationCode: paymentResult.authorizationCode,
            processedAt: new Date().toISOString()
          }
        },
        processedBy: reservation.patientId,
        processedByName: reservation.patientName,
        processedAt: new Date(),
        completedAt: new Date(),
        description: `Thanh toán đặt khám qua Visa - ${reservation.serviceName}`,
        notes: `Reservation ID: ${reservationId}`,
        isVerified: true,
        verifiedAt: new Date()
      });

      console.log('Payment record created:', payment._id);

      // Store payment in Redis temporarily (for tracking)
      const paymentRedisKey = `temp_payment:${reservationId}`;
      await redisClient.setEx(
        paymentRedisKey,
        900, // 15 minutes TTL
        JSON.stringify({
          paymentId: payment._id,
          transactionId: paymentResult.transactionId,
          amount: reservation.totalAmount,
          status: 'completed'
        })
      );

      // Publish payment.completed event to RabbitMQ
      await rabbitmqClient.publishToQueue('payment.completed', {
        reservationId,
        paymentId: payment._id.toString(),
        transactionId: paymentResult.transactionId,
        amount: reservation.totalAmount,
        paymentMethod: PaymentMethod.VISA,
        cardLast4: paymentResult.cardLast4,
        patientId: reservation.patientId.toString(),
        patientName: reservation.patientName,
        serviceId: reservation.serviceId.toString(),
        serviceName: reservation.serviceName,
        doctorId: reservation.doctorId.toString(),
        doctorName: reservation.doctorName,
        slotIds: reservation.slotIds,
        appointmentDate: reservation.appointmentDate,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        timestamp: new Date().toISOString()
      });

      console.log('payment.completed event published for reservation:', reservationId);

      // Return success response
      return {
        success: true,
        payment: {
          id: payment._id,
          paymentCode: payment.paymentCode,
          transactionId: paymentResult.transactionId,
          amount: payment.finalAmount,
          status: payment.status,
          cardLast4: paymentResult.cardLast4,
          completedAt: payment.completedAt
        },
        reservation: {
          reservationId,
          serviceName: reservation.serviceName,
          doctorName: reservation.doctorName,
          appointmentDate: reservation.appointmentDate,
          startTime: reservation.startTime,
          endTime: reservation.endTime
        },
        message: 'Thanh toán thành công'
      };

    } catch (error) {
      console.error('Error processing Visa payment:', error);
      
      // If it's not a BadRequestError, wrap it
      if (error instanceof BadRequestError) {
        throw error;
      }
      
      throw new Error(`Lỗi xử lý thanh toán Visa: ${error.message}`);
    }
  }

  /**
   * Confirm cash payment
   * Used when staff confirms cash payment after treatment completion
   */
  async confirmCashPayment(paymentId, confirmData, processedBy) {
    try {
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new NotFoundError('Không tìm thấy thanh toán');
      }

      if (payment.status === PaymentStatus.COMPLETED) {
        throw new BadRequestError('Thanh toán đã được xác nhận');
      }

      if (payment.method !== PaymentMethod.CASH) {
        throw new BadRequestError('Chỉ áp dụng cho thanh toán tiền mặt');
      }

      // Update payment
      payment.status = PaymentStatus.COMPLETED;
      payment.paidAmount = confirmData.paidAmount || payment.finalAmount;
      payment.changeAmount = Math.max(0, payment.paidAmount - payment.finalAmount);
      payment.processedBy = processedBy._id || processedBy;
      payment.processedByName = processedBy.fullName || processedBy.name || 'Staff';
      payment.completedAt = new Date();
      payment.notes = payment.notes 
        ? `${payment.notes}\n${confirmData.notes || ''}` 
        : confirmData.notes || '';

      await payment.save();

      console.log(`✅ Cash payment confirmed: ${payment.paymentCode}`);
      console.log('💰 [confirmCashPayment] Payment details before publishing event:', {
        paymentId: payment._id.toString(),
        paymentCode: payment.paymentCode,
        originalAmount: payment.originalAmount,
        depositAmount: payment.depositAmount,
        discountAmount: payment.discountAmount,
        taxAmount: payment.taxAmount,
        finalAmount: payment.finalAmount,
        paidAmount: payment.paidAmount
      });

      // Publish payment.success event to invoice-service (non-blocking)
      setImmediate(async () => {
        try {
          const eventData = {
            paymentId: payment._id.toString(),
            paymentCode: payment.paymentCode,
            recordId: payment.recordId ? payment.recordId.toString() : null,
            appointmentId: payment.appointmentId ? payment.appointmentId.toString() : null,
            patientId: payment.patientId ? payment.patientId.toString() : null,
            patientInfo: payment.patientInfo,
            method: payment.method,
            originalAmount: payment.originalAmount,
            depositAmount: payment.depositAmount || 0,  // ✅ Add deposit amount
            discountAmount: payment.discountAmount || 0, // ✅ Keep discount amount (real discount)
            taxAmount: payment.taxAmount || 0,  // ✅ Add tax amount
            finalAmount: payment.finalAmount,
            paidAmount: payment.paidAmount,
            changeAmount: payment.changeAmount,
            completedAt: payment.completedAt,
            processedBy: payment.processedBy.toString(),
            processedByName: payment.processedByName
          };
          
          console.log('📤 [confirmCashPayment] Publishing payment.success event:', eventData);
          
          await rabbitmqClient.publishToQueue('invoice_queue', {
            event: 'payment.success',
            data: eventData
          });
          console.log(`✅ Published payment.success for ${payment.paymentCode}`);
        } catch (publishError) {
          console.error('❌ Failed to publish payment.success:', publishError.message);
          // Don't fail - payment is already confirmed
        }
      });

      return payment;
    } catch (error) {
      console.error('❌ Error confirming cash payment:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();

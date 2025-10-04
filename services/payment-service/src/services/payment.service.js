const crypto = require('crypto');
const paymentRepository = require('../repositories/payment.repository');
const Payment = require('../models/payment.model');
const { PaymentMethod, PaymentStatus, PaymentType } = require('../models/payment.model');
const config = require('../config');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const redisClient = require('../utils/redis.client');
const { createVNPayPayment } = require('../utils/payment.gateway');
const rpcClient = require('../utils/rpcClient');

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

  // ============ GET METHODS ============
  async getPaymentById(id) {
    try {
      const cacheKey = `${this.cachePrefix}${id}`;
      
      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const payment = await paymentRepository.findById(id);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Cache the result
      await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(payment));
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi lấy thông tin thanh toán: ${error.message}`);
    }
  }

  async getPaymentByCode(code) {
    try {
      const cacheKey = `${this.cachePrefix}code:${code}`;
      
      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get from database
      const payment = await paymentRepository.findByCode(code);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Cache the result
      await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(payment));
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi lấy thanh toán theo mã: ${error.message}`);
    }
  }

  async getPatientPayments(patientId, options = {}) {
    try {
      const cacheKey = `${this.cachePrefix}patient:${patientId}`;
      
      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached && !options.page) {
        return JSON.parse(cached);
      }

      // Get from database
      const payments = await paymentRepository.findByPatient(patientId, options);

      // Cache the result (only for first page)
      if (!options.page || options.page === 1) {
        await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(payments));
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
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const payments = await paymentRepository.findTodayPayments();
    
    // Cache for 10 minutes
    await redis.setex(cacheKey, 600, JSON.stringify(payments));
    
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
      const { orderId, status, transactionId } = callbackData;
      
      // Find payment by code
      const payment = await paymentRepository.findByCode(orderId);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Update payment status based on gateway response
      if (status === 'success') {
        await this.confirmPayment(payment._id, callbackData);
      } else {
        await this.failPayment(payment._id, 'Thanh toán thất bại từ cổng thanh toán');
      }

      return payment;
    } catch (error) {
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
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await paymentRepository.getStatistics(startDate, endDate, groupBy);
      
      // Cache for 1 hour
      await redis.setex(cacheKey, 3600, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      throw new Error(`Lỗi lấy thống kê thanh toán: ${error.message}`);
    }
  }

  async getRevenueStatistics(startDate, endDate) {
    try {
      const cacheKey = `${this.cachePrefix}revenue:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      // Check cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await paymentRepository.getRevenueStats(startDate, endDate);
      
      // Cache for 30 minutes
      await redis.setex(cacheKey, 1800, JSON.stringify(stats));
      
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
    const paymentMethod = 'momo'; // mặc định 'momo'

    // Tạo orderId duy nhất
    const shortHash = crypto.createHash('sha256')
      .update(tempPaymentId)
      .digest('hex')
      .slice(0, 10);

    const orderId = `ORD${Date.now()}${shortHash}`.replace(/[^0-9a-zA-Z]/g, '').substring(0, 20);

    // Thời gian hiện tại
    const now = new Date();
    // Thời gian hết hạn 10 phút
    const expireAt = new Date(now.getTime() + 10 * 60 * 1000);

    const data = {
      tempPaymentId,
      appointmentHoldKey,
      amount: Math.round(Number(amount) || 0),
      method: paymentMethod,
      status: 'PENDING',
      createdAt: now,
      expireAt,      // thời gian hết hạn
      orderId
    };

    // Lưu tạm vào Redis với TTL 10 phút
    await redis.setex(tempPaymentId, 600, JSON.stringify(data));

    // Tạo VNPay payment URL nếu method = 'vnpay'
    if (paymentMethod === 'vnpay') {
      try {
        const ipAddr = '127.0.0.1'; // Hoặc lấy từ request
        const paymentUrl = createVNPayPayment(
          orderId,
          data.amount,
          `Thanh toán appointment`,
          ipAddr,
          '', // bankCode
          'vn'
        );
        data.paymentUrl = paymentUrl;
        data.orderId = orderId;
      } catch (err) {
        console.error('❌ Failed to create VNPay payment URL:', err);
        throw new Error('Cannot create VNPay payment link');
      }
    }

    console.log('Temporary payment created (VNPay):', data);
    return data;
  }

  // RPC: confirm payment (từ Redis -> DB + notify Appointment Service)
  async confirmPaymentRPC(payload) {
    if (!payload || !payload.id) throw new Error('Payment ID is required');

    // 1️⃣ Nếu temp payment
    if (payload.id.startsWith('payment:temp:')) {
      const raw = await redis.get(payload.id);
      if (!raw) throw new Error('Temporary payment not found or expired');
      const tempData = JSON.parse(raw);

      const savedPayment = await this.createPayment({
        amount: tempData.amount,
        method: tempData.method
      });

      await redis.del(payload.id);

      // Xử lý appointment
      if (tempData.appointmentHoldKey) {
        const appointmentRaw = await redis.get(tempData.appointmentHoldKey);
        if (appointmentRaw) {
          const appointmentData = JSON.parse(appointmentRaw);
          appointmentData.status = 'confirmed';
          await redis.setex(tempData.appointmentHoldKey, 600, JSON.stringify(appointmentData));
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
    if (!payload.id) throw new Error('Payment ID is required');
    if (payload.id.startsWith('payment:temp:')) {
      const raw = await redis.get(payload.id);
      return raw ? JSON.parse(raw) : null;
    }
    return this.getPaymentById(payload.id);
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
    await redis.del(`${this.cachePrefix}${id}`);
  }

  async clearPatientCache(patientId) {
    await redis.del(`${this.cachePrefix}patient:${patientId}`);
  }
}

module.exports = new PaymentService();

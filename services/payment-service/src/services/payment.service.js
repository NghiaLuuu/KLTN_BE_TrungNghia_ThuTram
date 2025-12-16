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

  // ============ CÁC PHƯƠNG THỨC TẠO ============
  async createPayment(paymentData) {
    try {
      // Kiểm tra các trường bắt buộc
      this.validatePaymentData(paymentData);

      // Tạo mã thanh toán nếu chưa có
      if (!paymentData.paymentCode) {
        paymentData.paymentCode = await this.generatePaymentCode();
      }

      // Đặt trạng thái ban đầu
      if (!paymentData.status) {
        paymentData.status = PaymentStatus.PENDING;
      }

      // Tạo bản ghi thanh toán
      const payment = await paymentRepository.create(paymentData);

      // Xử lý thanh toán theo phương thức
      if (paymentData.method !== PaymentMethod.CASH) {
        await this.initiatePaymentGateway(payment);
      }

      // Xóa cache cho các thanh toán của bệnh nhân
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
      // Lấy thanh toán gốc
      const originalPayment = await paymentRepository.findById(originalPaymentId);
      if (!originalPayment) {
        throw new Error('Không tìm thấy thanh toán gốc');
      }

      if (originalPayment.status !== PaymentStatus.COMPLETED) {
        throw new Error('Chỉ có thể hoàn tiền từ thanh toán đã hoàn thành');
      }

      // Kiểm tra số tiền hoàn
      const maxRefundAmount = originalPayment.finalAmount;
      if (refundData.amount > maxRefundAmount) {
        throw new Error('Số tiền hoàn vượt quá số tiền thanh toán gốc');
      }

      // Tạo thanh toán hoàn tiền
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

      // Xử lý hoàn tiền qua gateway nếu cần
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
   * Tạo thanh toán từ hồ sơ đã hoàn tất
   * Tính finalAmount dựa trên kênh đặt lịch (online/offline)
   * - Offline: finalAmount = totalCost
   * - Online: finalAmount = totalCost - depositAmount
   */
  async createPaymentFromRecord(recordId) {
    try {
      console.log('📝 [createPaymentFromRecord] Bắt đầu cho recordId:', recordId);

      // 1. Lấy hồ sơ qua RPC
      const recordResponse = await rpcClient.request('record_rpc_queue', {
        action: 'getRecordById',
        payload: { id: recordId }
      });

      if (recordResponse.error) {
        throw new Error(`Lỗi RPC: ${recordResponse.error}`);
      }

      const record = recordResponse.record;
      if (!record) {
        throw new Error('Không tìm thấy hồ sơ');
      }

      console.log('📋 [createPaymentFromRecord] Tìm thấy hồ sơ:', {
        recordCode: record.recordCode,
        totalCost: record.totalCost,
        bookingChannel: record.bookingChannel,
        appointmentId: record.appointmentId
      });

      // 2. Kiểm tra trạng thái hồ sơ
      if (record.status !== 'completed') {
        throw new Error('Hồ sơ phải hoàn tất trước khi tạo thanh toán');
      }

      if (!record.totalCost || record.totalCost <= 0) {
        throw new Error('totalCost của hồ sơ phải lớn hơn 0');
      }

      // 3. Tính số tiền thanh toán dựa trên kênh đặt lịch
      let finalAmount = record.totalCost;
      let depositAmount = 0;
      let depositPayment = null;

      if (record.bookingChannel === 'online' && record.appointmentId) {
        console.log('💰 [createPaymentFromRecord] Phát hiện đặt lịch online, kiểm tra tiền cọc...');

        // Lấy lịch hẹn để tìm thanh toán cọc
        try {
          const appointmentResponse = await rpcClient.request('appointment_rpc_queue', {
            action: 'getAppointmentById',
            payload: { id: record.appointmentId.toString() }
          });

          if (appointmentResponse.error) {
            console.warn('⚠️ Không thể lấy lịch hẹn:', appointmentResponse.error);
          } else if (appointmentResponse.appointment && appointmentResponse.appointment.paymentId) {
            const appointment = appointmentResponse.appointment;
            console.log('🎫 [createPaymentFromRecord] Tìm thấy lịch hẹn với paymentId:', appointment.paymentId);

            // Lấy thanh toán cọc
            depositPayment = await this.getPaymentById(appointment.paymentId);

            if (depositPayment && depositPayment.status === PaymentStatus.COMPLETED) {
              depositAmount = depositPayment.finalAmount;
              finalAmount = Math.max(0, record.totalCost - depositAmount);

              console.log('✅ [createPaymentFromRecord] Tìm thấy thanh toán cọc:', {
                depositPaymentId: depositPayment._id,
                depositAmount: depositAmount,
                totalCost: record.totalCost,
                finalAmount: finalAmount
              });
            } else {
              console.warn('⚠️ Thanh toán cọc tồn tại nhưng chưa hoàn tất:', depositPayment?.status);
            }
          }
        } catch (appointmentError) {
          console.warn('⚠️ Lỗi lấy lịch hẹn:', appointmentError.message);
          // Tiếp tục không có tiền cọc - fallback về số tiền đầy đủ
        }
      }

      // 4. Tạo thanh toán
      const paymentData = {
        recordId: record._id,
        appointmentId: record.appointmentId || null,
        patientId: record.patientId || null,
        patientInfo: record.patientInfo,
        type: PaymentType.PAYMENT,
        method: PaymentMethod.CASH, // Mặc định, sẽ được người dùng thay đổi
        status: PaymentStatus.PENDING,
        originalAmount: record.totalCost,
        depositAmount: depositAmount,  // ✅ ĐÃ SỬA: Tiền cọc tách biệt khỏi giảm giá!
        discountAmount: 0,  // ✅ ĐÃ SỬA: Không có giảm giá, chỉ trừ tiền cọc
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

      console.log('✅ [createPaymentFromRecord] Đã tạo thanh toán:', {
        paymentId: payment._id,
        paymentCode: payment.paymentCode,
        finalAmount: payment.finalAmount
      });

      return payment;
    } catch (error) {
      console.error('❌ [createPaymentFromRecord] Lỗi:', error);
      throw new Error(`Lỗi tạo thanh toán từ record: ${error.message}`);
    }
  }

  // ============ CÁC PHƯƠNG THỨC LẤY DỮ LIỆU ============
  async getPaymentById(id) {
    try {
      const cacheKey = `${this.cachePrefix}${id}`;
      
      // Kiểm tra cache trước
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Lấy từ database
      const payment = await paymentRepository.findById(id);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Cache kết quả
      await redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(payment));
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi lấy thông tin thanh toán: ${error.message}`);
    }
  }

  async getPaymentByCode(code) {
    try {
      const cacheKey = `${this.cachePrefix}code:${code}`;
      
      // Kiểm tra cache trước
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Lấy từ database
      const payment = await paymentRepository.findByCode(code);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }

      // Cache kết quả
      await redisClient.setEx(cacheKey, this.cacheTTL, JSON.stringify(payment));
      
      return payment;
    } catch (error) {
      throw new Error(`Lỗi lấy thanh toán theo mã: ${error.message}`);
    }
  }

  async getPatientPayments(patientId, options = {}) {
    try {
      const cacheKey = `${this.cachePrefix}patient:${patientId}`;
      
      // Kiểm tra cache trước
      const cached = await redisClient.get(cacheKey);
      if (cached && !options.page) {
        return JSON.parse(cached);
      }

      // Lấy từ database
      const payments = await paymentRepository.findByPatient(patientId, options);

      // Cache kết quả (chỉ cho trang đầu)
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

  // ============ CÁC PHƯƠNG THỨC DANH SÁCH & TÌM KIẾ̂M ============
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
    
    // Kiểm tra cache trước
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const payments = await paymentRepository.findTodayPayments();
    
    // Cache trong 10 phút
    await redisClient.setEx(cacheKey, 600, JSON.stringify(payments));
    
    return payments;
  }

  // ============ CÁC PHƯƠNG THỨC CẬP NHẬT ============
  async updatePayment(id, updateData) {
    try {
      const payment = await paymentRepository.update(id, updateData);
      
      if (payment) {
        // Xóa các cache liên quan
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
        // Xóa các cache
        await this.clearPaymentCache(id);
        if (payment.patientId) {
          await this.clearPatientCache(payment.patientId);
        }

        // Xử lý logic theo trạng thái
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

  // ============ CÁC PHƯƠNG THỨC CỔNG THANH TOÁN ============
  async initiatePaymentGateway(payment) {
    try {
      let gatewayResponse;
      
      // Chỉ hỗ trợ VNPay
      if (payment.method !== PaymentMethod.VNPAY) {
        throw new Error(`Phương thức thanh toán ${payment.method} không được hỗ trợ. Chỉ hỗ trợ VNPay.`);
      }

      // Lấy địa chỉ IP từ dữ liệu thanh toán hoặc dùng mặc định
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

      // Cập nhật thanh toán với thông tin gateway
      await this.updatePayment(payment._id, {
        externalTransactionId: gatewayResponse.transactionId,
        gatewayResponse: gatewayResponse,
        status: PaymentStatus.PROCESSING
      });

      return gatewayResponse;
    } catch (error) {
      // Đánh dấu thanh toán thất bại
      await this.failPayment(payment._id, error.message);
      throw error;
    }
  }

  async processGatewayCallback(callbackData) {
    try {
      const { orderId, status, transactionId, amount } = callbackData;
      
      console.log('🔍 [processGatewayCallback] Đang xử lý:', { orderId, status, transactionId });
      
      // Kiểm tra xem đây có phải cho thanh toán đã tồn tại không (từ record)
      const mappingKey = `payment:vnpay:${orderId}`;
      const existingPaymentId = await redisClient.get(mappingKey);
      
      if (existingPaymentId) {
        console.log('📝 [processGatewayCallback] Tìm thấy mapping thanh toán đã tồn tại:', existingPaymentId);
        return await this.updateExistingPaymentFromVNPay(existingPaymentId, {
          orderId,
          status,
          transactionId,
          amount
        });
      }
      
      // Nếu không, xử lý như thanh toán tạm (từ đặt lịch)
      const reservationId = orderId;
      const tempPaymentKey = `payment:temp:${reservationId}`;
      
      // Lấy thanh toán tạm từ Redis
      const tempPaymentData = await redisClient.get(tempPaymentKey);
      if (!tempPaymentData) {
        console.error('❌ Không tìm thấy thanh toán tạm:', tempPaymentKey);
        throw new Error('Không tìm thấy hoặc thanh toán tạm đã hết hạn');
      }
      
      const tempPayment = JSON.parse(tempPaymentData);

      // Tạo bản ghi thanh toán vĩnh viễn trong DB
      if (status === 'success') {
        // Lấy dữ liệu giữ lịch hẹn cho thông tin bệnh nhân và dịch vụ
        const appointmentHoldKey = tempPayment.appointmentHoldKey || reservationId;
        
        // Thử nhiều key Redis có thể (các service khác nhau dùng prefix khác nhau)
        const possibleKeys = [
          appointmentHoldKey,  // Key trực tiếp (ví dụ: "RSV1760631740748")
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
          // Thử từng key có thể cho đến khi tìm thấy dữ liệu
          for (const key of possibleKeys) {
            const appointmentDataStr = await redisClient.get(key);
            if (appointmentDataStr) {
              appointmentData = JSON.parse(appointmentDataStr);
              foundKey = key;
              console.log('✅ [DEBUG] Tìm thấy dữ liệu lịch hẹn trong Redis:', {
                key: foundKey,
                hasPatientInfo: !!appointmentData.patientInfo,
                hasSlotIds: !!appointmentData.slotIds,
                slotCount: appointmentData.slotIds?.length || 0,
                hasServiceId: !!appointmentData.serviceId,
                serviceAddOnId: appointmentData.serviceAddOnId || 'không có'
              });
              break;
            }
          }
          
          if (!appointmentData) {
            console.error('❌ [DEBUG] Không tìm thấy dữ liệu lịch hẹn trong redisClient. Các key đã thử:', possibleKeys);
            // Không throw - tiếp tục với dữ liệu hạn chế
          }
          
          // Trích xuất thông tin bệnh nhân
          if (appointmentData && appointmentData.patientInfo) {
            patientInfo = {
              name: appointmentData.patientInfo.fullName || appointmentData.patientInfo.name || 'Bệnh nhân',
              phone: appointmentData.patientInfo.phone || '0000000000',
              email: appointmentData.patientInfo.email || null,
              address: appointmentData.patientInfo.address || null
            };
          }
        } catch (err) {
          console.error('❌ [DEBUG] Lỗi lấy dữ liệu lịch hẹn:', err.message);
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
        
        console.log('💾 Dữ liệu thanh toán bao gồm VNPay URL:', !!tempPayment.vnpayUrl);
        
        const payment = await paymentRepository.create(paymentData);
        console.log('✅ Đã tạo thanh toán:', payment._id);
        
        // Xóa thanh toán tạm từ Redis
        await redisClient.del(tempPaymentKey);
        
        // Phát sự kiện sau khi thanh toán thành công
        if (appointmentData) {
          try {
            // BƯỚC 1: Tạo Hóa đơn TRƯỚC
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

            // BƯỚC 2: Tạo Lịch hẹn (sẽ query hóa đơn theo paymentId)
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

            // BƯỚC 3: Đánh dấu hồ sơ khám đã sử dụng (nếu cần)
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
            console.error('⚠️ Lỗi phát sự kiện:', eventError.message);
            // Không throw - thanh toán đã tạo thành công
          }
        } else {
          console.warn('⚠️ [Payment] appointmentData là NULL hoặc UNDEFINED - Sự kiện KHÔNG được phát!', {
            appointmentData,
            reservationId,
            tempPaymentKey,
            appointmentHoldKey
          });
        }
        
        return payment;
      } else {
        console.error('❌ Thanh toán thất bại từ gateway');
        await redisClient.del(tempPaymentKey);
        throw new Error('Thanh toán thất bại từ gateway');
      }
    } catch (error) {
      console.error('❌ [Process Callback] Lỗi:', error);
      throw new Error(`Lỗi xử lý callback: ${error.message}`);
    }
  }

  async processRefundThroughGateway(refundPayment, originalPayment) {
    // Triển khai phụ thuộc vào API của gateway
    // Hiện tại, đánh dấu là hoàn tất (cần tích hợp gateway thực tế)
    return await this.completeRefund(refundPayment._id);
  }

  // ============ CÁC PHƯƠNG THỨC THỐNG KÊ ============
  async getPaymentStatistics(startDate, endDate, groupBy = 'day') {
    try {
      const cacheKey = `${this.cachePrefix}stats:${groupBy}:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      // Kiểm tra cache trước
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await paymentRepository.getStatistics(startDate, endDate, groupBy);
      
      // Cache trong 1 giờ
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      throw new Error(`Lỗi lấy thống kê thanh toán: ${error.message}`);
    }
  }

  async getRevenueStatistics(startDate, endDate) {
    try {
      const cacheKey = `${this.cachePrefix}revenue:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      // Kiểm tra cache trước
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await paymentRepository.getRevenueStats(startDate, endDate);
      
      // Cache trong 30 phút
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

  // ============ CÁC PHƯƠNG THỨC RPC ============
  async createTemporaryPayment(payload) {
    const { appointmentHoldKey, amount } = payload;
    if (!appointmentHoldKey) throw new Error('appointmentHoldKey là bắt buộc');

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
    await redisClient.setEx(tempPaymentId, 180, JSON.stringify(data)); // 3 phút

    // Trả về URL chọn phương thức thanh toán frontend
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    data.paymentUrl = `${frontendUrl}/patient/payment/select?reservationId=${appointmentHoldKey}&orderId=${orderId}`;

    console.log('✅ Đã tạo thanh toán tạm:', { orderId, tempPaymentId, amount: data.amount });
    return data;
  }

  /**
   * Tạo URL thanh toán VNPay cho lịch hẹn
   * Gọi từ frontend khi người dùng chọn VNPay trên trang chọn phương thức thanh toán
   */
  async createVNPayPaymentUrl(orderId, amount, orderInfo, ipAddr, bankCode = '', locale = 'vn', userRole = 'patient') {
    try {
      console.log('='.repeat(60));
      console.log('🔍 [Tạo VNPay URL] DEBUG LƯU TRỮ ROLE');
      console.log('='.repeat(60));
      console.log('📋 Order ID:', orderId);
      console.log('👤 User Role (nhận được):', userRole);
      console.log('📊 Kiểu Role:', typeof userRole);
      
      const paymentUrl = createVNPayPayment(
        orderId,
        amount,
        orderInfo || `Thanh toán đơn hàng ${orderId}`,
        ipAddr,
        bankCode,
        locale
      );
      
      // Lưu user role vào Redis để sử dụng sau trong redirect return URL
      // TTL: 30 phút (đủ thời gian cho quá trình thanh toán)
      const roleKey = `payment:role:${orderId}`;
      const roleToStore = userRole || 'patient';
      
      console.log('🔑 Redis Key:', roleKey);
      console.log('💾 Đang lưu Role:', roleToStore);
      
      await redisClient.setEx(roleKey, 1800, roleToStore);
      
      console.log('✅ Đã lưu role vào Redis thành công');
      
      // Xác minh lưu trữ
      const verifyRole = await redisClient.get(roleKey);
      console.log('✔️  Xác minh - Role lấy được:', verifyRole);
      
      // Lưu VNPay URL vào thanh toán tạm để lưu trữ sau
      const tempPaymentKey = `payment:temp:${orderId}`;
      const tempPaymentData = await redisClient.get(tempPaymentKey);
      if (tempPaymentData) {
        const tempPayment = JSON.parse(tempPaymentData);
        tempPayment.vnpayUrl = paymentUrl;
        tempPayment.vnpayCreatedAt = new Date().toISOString();
        await redisClient.setEx(tempPaymentKey, 180, JSON.stringify(tempPayment)); // 3 phút
        console.log('💾 Đã lưu VNPay URL vào thanh toán tạm:', tempPaymentKey);
      } else {
        console.warn('⚠️  Không tìm thấy thanh toán tạm, VNPay URL không được lưu:', tempPaymentKey);
      }
      
      console.log('='.repeat(60));
      
      console.log('✅ Đã tạo URL thanh toán VNPay:', { orderId, amount, userRole: roleToStore });
      return { paymentUrl, orderId };
    } catch (err) {
      console.error('❌ Tạo URL thanh toán VNPay thất bại:', err);
      throw new Error('Không thể tạo liên kết thanh toán VNPay');
    }
  }

  /**
   * Tạo URL VNPay cho thanh toán đã tồn tại (từ record)
   * Sử dụng khi nhân viên muốn tạo thanh toán VNPay cho thanh toán tiền mặt
   */
  async createVNPayUrlForExistingPayment(paymentId, ipAddr, userRole = 'patient') {
    try {
      console.log('🔍 [Tạo VNPay URL cho Thanh Toán Đã Tồn Tại]:', { paymentId });
      
      // Lấy thanh toán từ database
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }
      
      // Kiểm tra trạng thái thanh toán
      if (payment.status === 'completed') {
        throw new Error('Thanh toán đã hoàn tất');
      }
      
      if (payment.status === 'cancelled') {
        throw new Error('Không thể tạo URL VNPay cho thanh toán đã hủy');
      }
      
      // Tạo orderId duy nhất cho VNPay
      const orderId = `PAY${Date.now()}${payment._id.toString().slice(-6)}`;
      const amount = payment.finalAmount;
      const orderInfo = `Thanh toán ${payment.paymentCode}`;
      
      console.log('📝 [Tạo VNPay URL] Chi tiết thanh toán:', {
        paymentCode: payment.paymentCode,
        orderId,
        amount,
        status: payment.status
      });
      
      // Tạo URL thanh toán VNPay
      const paymentUrl = createVNPayPayment(
        orderId,
        amount,
        orderInfo,
        ipAddr,
        '', // bankCode
        'vn' // locale
      );
      
      // Lưu mapping giữa orderId và paymentId trong Redis
      const mappingKey = `payment:vnpay:${orderId}`;
      await redisClient.setEx(mappingKey, 1800, paymentId.toString()); // TTL 30 phút
      
      // Lưu user role để redirect
      const roleKey = `payment:role:${orderId}`;
      await redisClient.setEx(roleKey, 1800, userRole);
      
      // Cập nhật thanh toán với VNPay URL và orderId
      payment.gatewayResponse = payment.gatewayResponse || {};
      payment.gatewayResponse.additionalData = payment.gatewayResponse.additionalData || {};
      payment.gatewayResponse.additionalData.vnpayUrl = paymentUrl;
      payment.gatewayResponse.additionalData.vnpayOrderId = orderId;
      payment.gatewayResponse.additionalData.vnpayCreatedAt = new Date();
      payment.method = 'vnpay'; // Cập nhật phương thức thành VNPay
      payment.status = 'processing'; // Cập nhật trạng thái
      
      await payment.save();
      
      console.log('✅ [Tạo VNPay URL] Đã tạo và lưu URL:', { orderId, paymentId });
      
      return {
        paymentUrl,
        orderId,
        paymentId: payment._id,
        amount
      };
    } catch (err) {
      console.error('❌ [Tạo VNPay URL cho Thanh Toán Đã Tồn Tại] Lỗi:', err);
      throw err;
    }
  }

  /**
   * Tạo URL Stripe cho thanh toán đã tồn tại (từ record)
   * Sử dụng khi nhân viên muốn tạo thanh toán Stripe cho thanh toán tiền mặt
   */
  async createStripeUrlForExistingPayment(paymentId, userRole = 'patient') {
    try {
      console.log('🔍 [Tạo Stripe URL cho Thanh Toán Đã Tồn Tại]:', { paymentId });
      
      // Lấy thanh toán từ database
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }
      
      // Kiểm tra trạng thái thanh toán
      if (payment.status === 'completed') {
        throw new Error('Thanh toán đã hoàn tất');
      }
      
      if (payment.status === 'cancelled') {
        throw new Error('Không thể tạo URL Stripe cho thanh toán đã hủy');
      }
      
      // Tạo orderId duy nhất cho Stripe
      const orderId = `PAY${Date.now()}${payment._id.toString().slice(-6)}`;
      
      // Lấy số tiền - nếu payment.finalAmount là 0 (thanh toán dashboard), lấy từ record
      let amount = payment.finalAmount;
      
      if (amount === 0 && payment.recordId) {
        console.log('⚠️ [Tạo Stripe URL] Số tiền là 0, đang lấy từ record:', payment.recordId);
        
        try {
          const recordServiceUrl = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
          const recordResponse = await axios.get(
            `${recordServiceUrl}/api/record/${payment.recordId}`
          );
          
          const recordData = recordResponse.data?.data || recordResponse.data;
          console.log('📋 [Tạo Stripe URL] Dữ liệu record:', {
            recordId: payment.recordId,
            serviceAmount: recordData.serviceAmount,
            serviceAddOnPrice: recordData.serviceAddOnPrice,
            depositPaid: recordData.depositPaid
          });
          
          // 🔥 SỬA: Sử dụng serviceAddOnPrice (giá variant thực tế) thay vì servicePrice (giá gốc)
          const serviceAmount = recordData.serviceAddOnPrice || recordData.serviceAmount || 0;
          const depositAmount = recordData.depositPaid || 0;
          amount = Math.max(0, serviceAmount - depositAmount);
          
          if (amount === 0) {
            throw new Error('Không thể tính toán số tiền thanh toán. Vui lòng kiểm tra lại thông tin dịch vụ.');
          }
          
          // Cập nhật thanh toán với số tiền đã tính
          payment.originalAmount = serviceAmount;
          payment.depositAmount = depositAmount;  // ✅ ĐÃ SỬA: Trường đúng!
          payment.discountAmount = 0;  // ✅ ĐÃ SỬA: Không có giảm giá thực tế
          payment.taxAmount = 0;
          payment.finalAmount = amount;
          await payment.save();
          
          console.log('✅ [Tạo Stripe URL] Số tiền tính từ record:', { 
            serviceAmount, 
            depositAmount, 
            finalAmount: amount 
          });
        } catch (error) {
          console.error('❌ [Tạo Stripe URL] Lấy số tiền từ record thất bại:', error.message);
          throw new Error('Không thể lấy thông tin số tiền từ hồ sơ. Vui lòng thử lại.');
        }
      }
      
      if (!amount || amount <= 0) {
        throw new Error('Số tiền thanh toán không hợp lệ');
      }
      
      const orderInfo = `Thanh toan ${payment.paymentCode}`;
      
      console.log('📝 [Tạo Stripe URL] Chi tiết thanh toán:', {
        paymentCode: payment.paymentCode,
        orderId,
        amount,
        status: payment.status
      });
      
      // Lấy email bệnh nhân từ thanh toán
      const customerEmail = payment.patientInfo?.email || '';
      
      // Tạo liên kết thanh toán Stripe
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
      
      // Lưu mapping giữa orderId và paymentId trong Redis
      const mappingKey = `payment:stripe:${orderId}`;
      await redisClient.setEx(mappingKey, 1800, paymentId.toString()); // TTL 30 phút
      
      // Cập nhật thanh toán với Stripe URL và orderId
      payment.gatewayResponse = payment.gatewayResponse || {};
      payment.gatewayResponse.additionalData = payment.gatewayResponse.additionalData || {};
      payment.gatewayResponse.additionalData.stripeUrl = result.paymentUrl;
      payment.gatewayResponse.additionalData.stripeOrderId = orderId;
      payment.gatewayResponse.additionalData.stripeSessionId = result.sessionId;
      payment.gatewayResponse.additionalData.stripeCreatedAt = new Date();
      payment.method = 'stripe'; // Cập nhật phương thức thành Stripe
      payment.status = 'processing'; // Cập nhật trạng thái
      
      await payment.save();
      
      console.log('✅ [Tạo Stripe URL] Đã tạo và lưu URL:', { orderId, paymentId, sessionId: result.sessionId });
      
      return {
        paymentUrl: result.paymentUrl,
        orderId,
        paymentId: payment._id,
        sessionId: result.sessionId,
        amount
      };
    } catch (err) {
      console.error('❌ [Tạo Stripe URL cho Thanh Toán Đã Tồn Tại] Lỗi:', err);
      throw err;
    }
  }

  /**
   * Cập nhật thanh toán đã tồn tại từ VNPay callback
   * Sử dụng khi thanh toán được tạo từ record
   */
  async updateExistingPaymentFromVNPay(paymentId, callbackData) {
    try {
      const { orderId, status, transactionId, amount } = callbackData;
      
      console.log('🔄 [Cập Nhật Thanh Toán Đã Tồn Tại] Bắt đầu:', { paymentId, orderId, status });
      
      // Lấy thanh toán từ database
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new Error('Không tìm thấy thanh toán');
      }
      
      console.log('📝 [Cập Nhật Thanh Toán Đã Tồn Tại] Thanh toán hiện tại:', {
        paymentCode: payment.paymentCode,
        status: payment.status,
        method: payment.method,
        finalAmount: payment.finalAmount,
        recordId: payment.recordId
      });
      
      // ✅ Nếu finalAmount là 0 và có recordId, lấy từ record service
      if (payment.finalAmount === 0 && payment.recordId) {
        console.log('⚠️ [Cập Nhật Thanh Toán Đã Tồn Tại] finalAmount là 0, đang lấy từ record:', payment.recordId);
        
        try {
          const recordServiceUrl = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
          const recordResponse = await axios.get(
            `${recordServiceUrl}/api/record/${payment.recordId}`
          );
          
          const recordData = recordResponse.data?.data || recordResponse.data;
          console.log('📋 [Cập Nhật Thanh Toán Đã Tồn Tại] Dữ liệu record:', {
            recordId: payment.recordId,
            serviceAmount: recordData.serviceAmount,
            serviceAddOnPrice: recordData.serviceAddOnPrice,
            depositPaid: recordData.depositPaid
          });
          
          // 🔥 SỬA: Sử dụng serviceAddOnPrice (giá variant thực tế) thay vì servicePrice (giá gốc)
          const serviceAmount = recordData.serviceAddOnPrice || recordData.serviceAmount || 0;
          const depositAmount = recordData.depositPaid || 0;
          const calculatedAmount = Math.max(0, serviceAmount - depositAmount);
          
          // Cập nhật số tiền thanh toán
          payment.originalAmount = serviceAmount;
          payment.depositAmount = depositAmount;  // ✅ ĐÃ SỬA: Trường đúng!
          payment.discountAmount = 0;  // ✅ ĐÃ SỬA: Không có giảm giá thực tế
          payment.taxAmount = 0;
          payment.finalAmount = calculatedAmount;
          
          console.log('✅ [Cập Nhật Thanh Toán Đã Tồn Tại] Số tiền tính từ record:', { 
            serviceAmount, 
            depositAmount, 
            finalAmount: calculatedAmount 
          });
        } catch (error) {
          console.error('❌ [Cập Nhật Thanh Toán Đã Tồn Tại] Lấy số tiền từ record thất bại:', error.message);
        }
      }
      
      // Cập nhật thanh toán dựa trên phản hồi VNPay
      if (status === 'success') {
        payment.status = 'completed';
        payment.externalTransactionId = transactionId;
        payment.paidAmount = payment.finalAmount;  // ✅ Bây giờ sẽ đúng
        payment.processedAt = new Date();
        payment.completedAt = new Date();
        
        // Cập nhật phản hồi gateway
        payment.gatewayResponse = payment.gatewayResponse || {};
        payment.gatewayResponse.responseCode = '00';
        payment.gatewayResponse.responseMessage = 'Thành công';
        payment.gatewayResponse.transactionId = transactionId;
        payment.gatewayResponse.completedAt = new Date();
        
        console.log('✅ [Cập Nhật Thanh Toán Đã Tồn Tại] Thanh toán hoàn tất thành công');
      } else {
        payment.status = 'failed';
        payment.gatewayResponse = payment.gatewayResponse || {};
        payment.gatewayResponse.responseCode = 'FAILED';
        payment.gatewayResponse.responseMessage = 'Thanh toán thất bại';
        payment.gatewayResponse.failedAt = new Date();
        
        console.log('❌ [Cập Nhật Thanh Toán Đã Tồn Tại] Thanh toán thất bại');
      }
      
      await payment.save();
      
      // Dọn dẹp Redis mapping
      const mappingKey = `payment:vnpay:${orderId}`;
      await redisClient.del(mappingKey);
      
      // Nếu thanh toán hoàn tất và có recordId, kích hoạt tạo hóa đơn
      if (status === 'success' && payment.recordId) {
        try {
          console.log('📄 [Cập Nhật Thanh Toán Đã Tồn Tại] Kích hoạt tạo hóa đơn cho record:', payment.recordId);
          
          const eventData = {
            paymentId: payment._id.toString(),
            paymentCode: payment.paymentCode,
            recordId: payment.recordId.toString(),
            appointmentId: payment.appointmentId ? payment.appointmentId.toString() : null,
            patientId: payment.patientId ? payment.patientId.toString() : null,
            patientInfo: payment.patientInfo,
            method: payment.method,
            originalAmount: payment.originalAmount,
            depositAmount: payment.depositAmount || 0,  // ✅ Thêm số tiền cọc
            discountAmount: payment.discountAmount || 0, // ✅ Giảm giá thực tế (không phải cọc)
            taxAmount: payment.taxAmount || 0,  // ✅ Thêm thuế
            finalAmount: payment.finalAmount,
            paidAmount: payment.paidAmount,
            changeAmount: payment.changeAmount || 0,
            completedAt: payment.completedAt,
            processedBy: payment.processedBy ? payment.processedBy.toString() : null,
            processedByName: payment.processedByName || 'Hệ thống'
          };
          
          console.log('📤 [Cập Nhật Thanh Toán Đã Tồn Tại] Đang phát sự kiện payment.success:', eventData);
          
          await rabbitmqClient.publishToQueue('invoice_queue', {
            event: 'payment.success',
            data: eventData
          });
          
          console.log('✅ [Cập Nhật Thanh Toán Đã Tồn Tại] Đã gửi sự kiện tạo hóa đơn');
        } catch (err) {
          console.error('❌ [Cập Nhật Thanh Toán Đã Tồn Tại] Gửi sự kiện hóa đơn thất bại:', err);
        }
      }
      
      console.log('✅ [Cập Nhật Thanh Toán Đã Tồn Tại] Hoàn tất:', payment._id);
      return payment;
    } catch (err) {
      console.error('❌ [Cập Nhật Thanh Toán Đã Tồn Tại] Lỗi:', err);
      throw err;
    }
  }

  // RPC: xác nhận thanh toán (từ Redis -> DB + thông báo Appointment Service)
  async confirmPaymentRPC(payload) {
    if (!payload || !payload.id) throw new Error('Payment ID là bắt buộc');

    // 1️⃣ Nếu temp payment
    if (payload.id.startsWith('payment:temp:')) {
      const raw = await redisClient.get(payload.id);
      if (!raw) throw new Error('Không tìm thấy hoặc thanh toán tạm đã hết hạn');
      const tempData = JSON.parse(raw);

      const savedPayment = await this.createPayment({
        amount: tempData.amount,
        method: tempData.method
      });

      await redisClient.del(payload.id);

      // Xử lý lịch hẹn
      if (tempData.appointmentHoldKey) {
        const appointmentRaw = await redisClient.get(tempData.appointmentHoldKey);
        if (appointmentRaw) {
          const appointmentData = JSON.parse(appointmentRaw);
          appointmentData.status = 'confirmed';
          await redisClient.setEx(tempData.appointmentHoldKey, 600, JSON.stringify(appointmentData));
          console.log(`✅ Lịch hẹn tạm đã cập nhật thành confirmed trong Redis cho holdKey ${tempData.appointmentHoldKey}`);
        }

        try {
          await rpcClient.request('appointment_queue', {
            action: 'confirmAppointmentWithPayment',
            payload: {
              holdKey: String(tempData.appointmentHoldKey),
              paymentId: String(savedPayment._id)
            }
          });
          console.log(`✅ Đã kích hoạt tạo lịch hẹn cho holdKey ${tempData.appointmentHoldKey}`);
        } catch (err) {
          console.error('❌ Thông báo Appointment Service thất bại:', err.message);
        }
      }

      return savedPayment;
    }

    // 2️⃣ Nếu payload.id là ObjectId hợp lệ, xác nhận MongoDB Payment
    if (payload.id.match(/^[0-9a-fA-F]{24}$/)) {
      return this.confirmPayment(payload.id);
    }

    // 3️⃣ Nếu không phải temp payment và không phải ObjectId → lỗi hợp lệ
    throw new Error('Định dạng Payment ID không hợp lệ');
  }

  async getPaymentByIdRPC(payload) {
    console.log('🔍 [getPaymentByIdRPC] Được gọi với payload:', payload);
    if (!payload.id) throw new Error('Payment ID là bắt buộc');
    
    if (payload.id.startsWith('payment:temp:')) {
      console.log('📦 [getPaymentByIdRPC] Lấy thanh toán tạm từ Redis:', payload.id);
      const raw = await redisClient.get(payload.id);
      const result = raw ? JSON.parse(raw) : null;
      console.log('✅ [getPaymentByIdRPC] Kết quả thanh toán tạm:', result ? 'Tìm thấy' : 'Không tìm thấy');
      return result;
    }
    
    console.log('📊 [getPaymentByIdRPC] Lấy thanh toán từ DB:', payload.id);
    const result = await this.getPaymentById(payload.id);
    console.log('✅ [getPaymentByIdRPC] Kết quả thanh toán DB:', result ? 'Tìm thấy' : 'Không tìm thấy');
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

    // 🔹 Lấy payment trước khi cập nhật
    const paymentBefore = await paymentRepository.findById(paymentId);
    console.log('🔹 Payment trước khi cập nhật:', paymentBefore);

    if (!paymentBefore) {
      throw new Error(`Không tìm thấy payment với id: ${paymentId}`);
    }

    // 🔹 Cập nhật appointmentCode
    const paymentAfter = await paymentRepository.update(paymentId, {
      appointmentCode: String(appointmentCode)
    });
    console.log('🔹 Payment sau khi cập nhật:', paymentAfter);

    return paymentAfter;
  }

  // ============ CÁC PHƯƠNG THỨC HỖ TRỢ ============
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
    // Thông báo các service khác về việc thanh toán hoàn tất
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
      console.error('Lỗi thông báo các service về việc thanh toán hoàn tất:', error);
    }
  }

  async handlePaymentFailed(payment) {
    // Xử lý logic khi thanh toán thất bại
    console.log(`Thanh toán ${payment._id} thất bại`);
  }

  async handlePaymentCancelled(payment) {
    // Xử lý logic khi thanh toán bị hủy
    console.log(`Thanh toán ${payment._id} đã hủy`);
  }

  async clearPaymentCache(id) {
    await redisClient.del(`${this.cachePrefix}${id}`);
  }

  async clearPatientCache(patientId) {
    await redisClient.del(`${this.cachePrefix}patient:${patientId}`);
  }

  // ============ Xử LÝ THANH TOÁN VISA ============
  /**
   * Xử lý thanh toán thẻ Visa qua cổng sandbox
   * @param {Object} paymentData - Dữ liệu thanh toán bao gồm thông tin thẻ và reservation
   * @returns {Object} Kết quả thanh toán với chi tiết giao dịch
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

      // Kiểm tra các trường bắt buộc
      if (!reservationId || !cardNumber || !cardHolder || !expiryMonth || !expiryYear || !cvv) {
        throw new BadRequestError('Thiếu thông tin thanh toán');
      }

      // Lấy reservation từ Redis
      const reservationKey = `temp_reservation:${reservationId}`;
      const reservationData = await redisClient.get(reservationKey);
      
      if (!reservationData) {
        throw new BadRequestError('Đặt khám đã hết hạn hoặc không tồn tại. Vui lòng đặt lại.');
      }

      const reservation = JSON.parse(reservationData);

      // Kiểm tra số tiền khớp với reservation
      if (amount && Math.abs(amount - reservation.totalAmount) > 0.01) {
        throw new BadRequestError('Số tiền thanh toán không khớp với đặt khám');
      }

      // Xử lý thanh toán qua cổng Visa
      console.log('Đang xử lý thanh toán Visa:', {
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

      // Kiểm tra kết quả thanh toán
      if (!paymentResult.success) {
        // Thanh toán thất bại - phát sự kiện
        await rabbitmqClient.publishToQueue('payment.failed', {
          reservationId,
          reason: paymentResult.message || 'Thanh toán bị từ chối bởi gateway',
          errorCode: paymentResult.errorCode,
          timestamp: new Date().toISOString()
        });

        throw new BadRequestError(
          paymentResult.message || 'Thanh toán thất bại. Vui lòng kiểm tra lại thẻ.'
        );
      }

      // Thanh toán thành công - tạo bản ghi thanh toán
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

      console.log('Đã tạo bản ghi thanh toán:', payment._id);

      // Lưu thanh toán vào Redis tạm thời (để theo dõi)
      const paymentRedisKey = `temp_payment:${reservationId}`;
      await redisClient.setEx(
        paymentRedisKey,
        900, // TTL 15 phút
        JSON.stringify({
          paymentId: payment._id,
          transactionId: paymentResult.transactionId,
          amount: reservation.totalAmount,
          status: 'completed'
        })
      );

      // Phát sự kiện payment.completed đến RabbitMQ
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

      console.log('Đã phát sự kiện payment.completed cho reservation:', reservationId);

      // Trả về phản hồi thành công
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
      console.error('Lỗi xử lý thanh toán Visa:', error);
      
      // Nếu không phải BadRequestError, bao bọc lại
      if (error instanceof BadRequestError) {
        throw error;
      }
      
      throw new Error(`Lỗi xử lý thanh toán Visa: ${error.message}`);
    }
  }

  /**
   * Xác nhận thanh toán tiền mặt
   * Sử dụng khi nhân viên xác nhận thanh toán tiền mặt sau khi hoàn tất điều trị
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

      // Cập nhật thanh toán
      payment.status = PaymentStatus.COMPLETED;
      payment.paidAmount = confirmData.paidAmount || payment.finalAmount;
      payment.changeAmount = Math.max(0, payment.paidAmount - payment.finalAmount);
      payment.processedBy = processedBy._id || processedBy;
      payment.processedByName = processedBy.fullName || processedBy.name || 'Nhân viên';
      payment.completedAt = new Date();
      payment.notes = payment.notes 
        ? `${payment.notes}\n${confirmData.notes || ''}` 
        : confirmData.notes || '';

      await payment.save();

      console.log(`✅ Đã xác nhận thanh toán tiền mặt: ${payment.paymentCode}`);
      console.log('💰 [confirmCashPayment] Chi tiết thanh toán trước khi phát sự kiện:', {
        paymentId: payment._id.toString(),
        paymentCode: payment.paymentCode,
        originalAmount: payment.originalAmount,
        depositAmount: payment.depositAmount,
        discountAmount: payment.discountAmount,
        taxAmount: payment.taxAmount,
        finalAmount: payment.finalAmount,
        paidAmount: payment.paidAmount
      });

      // Phát sự kiện payment.success đến invoice-service (không chặn)
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
            depositAmount: payment.depositAmount || 0,  // ✅ Thêm số tiền cọc
            discountAmount: payment.discountAmount || 0, // ✅ Giữ số tiền giảm (giảm thực tế)
            taxAmount: payment.taxAmount || 0,  // ✅ Thêm thuế
            finalAmount: payment.finalAmount,
            paidAmount: payment.paidAmount,
            changeAmount: payment.changeAmount,
            completedAt: payment.completedAt,
            processedBy: payment.processedBy.toString(),
            processedByName: payment.processedByName
          };
          
          console.log('📤 [confirmCashPayment] Đang phát sự kiện payment.success:', eventData);
          
          await rabbitmqClient.publishToQueue('invoice_queue', {
            event: 'payment.success',
            data: eventData
          });
          console.log(`✅ Đã phát payment.success cho ${payment.paymentCode}`);
        } catch (publishError) {
          console.error('❌ Phát payment.success thất bại:', publishError.message);
          // Không thất bại - thanh toán đã được xác nhận
        }
      });

      return payment;
    } catch (error) {
      console.error('❌ Lỗi xác nhận thanh toán tiền mặt:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();

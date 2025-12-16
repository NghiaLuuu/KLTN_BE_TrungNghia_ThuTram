const paymentService = require('../services/payment.service');
const redis = require('../utils/redis.client');
const crypto = require('crypto');
const { verifyVNPayCallback } = require('../utils/vnpay.utils');

class PaymentController {
  // ============ CÁC PHƯƠNG THỨC TẠO THANH TOÁN ============
  
  /**
   * Tạo thanh toán tạm thời cho reservation lịch hẹn
   * Được sử dụng bởi appointment-service qua HTTP
   */
  async createTemporaryPayment(req, res) {
    try {
      const { appointmentHoldKey, amount } = req.body;

      if (!appointmentHoldKey) {
        return res.status(400).json({
          success: false,
          message: 'appointmentHoldKey là bắt buộc'
        });
      }

      const result = await paymentService.createTemporaryPayment({
        appointmentHoldKey,
        amount
      });

      res.status(201).json({
        success: true,
        message: 'Tạo temporary payment thành công',
        data: result
      });
    } catch (error) {
      console.error('❌ Lỗi tạo thanh toán tạm thời:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo thanh toán tạm thời'
      });
    }
  }

  /**
   * Tạo URL thanh toán VNPay
   * POST /api/payments/vnpay/create-url
   * Body: { orderId, amount, orderInfo, bankCode?, locale? }
   */
  async createVNPayUrl(req, res) {
    try {
      console.log('🔵 [VNPay URL] Request received:', {
        body: req.body,
        user: req.user,
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent']
        }
      });

      const { orderId, amount, orderInfo, bankCode, locale } = req.body;

      if (!orderId || !amount) {
        return res.status(400).json({
          success: false,
          message: 'orderId và amount là bắt buộc'
        });
      }

      // Get IP address, convert IPv6 localhost to IPv4
      let ipAddr = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      
      // Convert IPv6 localhost to IPv4
      if (ipAddr === '::1' || ipAddr === '::ffff:127.0.0.1') {
        ipAddr = '127.0.0.1';
      }

      const result = await paymentService.createVNPayPaymentUrl(
        orderId,
        amount,
        orderInfo || `Thanh toán đơn hàng ${orderId}`,
        ipAddr,
        bankCode || '',
        locale || 'vn',
        req.user?.role // Pass user role to service
      );

      res.status(200).json({
        success: true,
        message: 'Tạo VNPay payment URL thành công',
        data: result
      });
    } catch (error) {
      console.error('❌ Lỗi tạo VNPay URL:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo VNPay payment URL'
      });
    }
  }

  async createPayment(req, res) {
    try {
      const paymentData = {
        ...req.body,
        createdBy: req.user?.userId,
        createdByRole: req.user?.role
      };

      const payment = await paymentService.createPayment(paymentData);
      
      res.status(201).json({
        success: true,
        message: 'Tạo thanh toán thành công',
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo thanh toán'
      });
    }
  }

  async createCashPayment(req, res) {
    try {
      const paymentData = {
        ...req.body,
        createdBy: req.user?.userId,
        createdByRole: req.user?.role
      };

      const payment = await paymentService.createCashPayment(paymentData);
      
      res.status(201).json({
        success: true,
        message: 'Tạo thanh toán tiền mặt thành công',
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo thanh toán tiền mặt'
      });
    }
  }

  async createRefundPayment(req, res) {
    try {
      const { originalPaymentId } = req.params;
      const refundData = {
        ...req.body,
        processedBy: req.user?.userId,
        processedByRole: req.user?.role
      };

      const refund = await paymentService.createRefundPayment(originalPaymentId, refundData);
      
      res.status(201).json({
        success: true,
        message: 'Tạo hoàn tiền thành công',
        data: refund
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tạo hoàn tiền'
      });
    }
  }

  /**
   * Create VNPay URL for existing payment (from record)
   * POST /api/payments/:id/vnpay-url
   */
  async createVNPayUrlForPayment(req, res) {
    try {
      const { id } = req.params;
      
      console.log('🔵 [Create VNPay URL for Payment] Request:', { paymentId: id });
      
      // Get IP address
      let ipAddr = req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      
      if (ipAddr === '::1' || ipAddr === '::ffff:127.0.0.1') {
        ipAddr = '127.0.0.1';
      }
      
      const result = await paymentService.createVNPayUrlForExistingPayment(
        id,
        ipAddr,
        req.user?.role || 'patient'
      );
      
      res.status(200).json({
        success: true,
        message: 'Tạo VNPay URL thành công',
        data: result
      });
    } catch (error) {
      console.error('❌ [Tạo VNPay URL cho Thanh Toán] Lỗi:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Không thể tạo VNPay URL'
      });
    }
  }

  /**
   * Tạo Stripe URL cho thanh toán đã tồn tại (từ record)
   * POST /api/payments/:id/stripe-url
   */
  async createStripeUrlForPayment(req, res) {
    try {
      const { id } = req.params;
      
      console.log('🟣 [Tạo Stripe URL cho Thanh Toán] Request:', { paymentId: id });
      
      const result = await paymentService.createStripeUrlForExistingPayment(
        id,
        req.user?.role || 'patient'
      );
      
      res.status(200).json({
        success: true,
        message: 'Tạo Stripe URL thành công',
        data: result
      });
    } catch (error) {
      console.error('❌ [Tạo Stripe URL cho Thanh Toán] Lỗi:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Không thể tạo Stripe URL'
      });
    }
  }

  // ============ CÁC PHƯƠNG THỨC LẤY THANH TOÁN ============
  async getPaymentById(req, res) {
    try {
      const payment = await paymentService.getPaymentById(req.params.id);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy thanh toán'
        });
      }

      res.json({
        success: true,
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thông tin thanh toán'
      });
    }
  }

  async getPaymentByCode(req, res) {
    try {
      const payment = await paymentService.getPaymentByCode(req.params.code);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy thanh toán'
        });
      }

      res.json({
        success: true,
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán theo mã'
      });
    }
  }

  async getPatientPayments(req, res) {
    try {
      const { patientId } = req.params;
      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        status: req.query.status
      };

      const payments = await paymentService.getPatientPayments(patientId, options);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán bệnh nhân'
      });
    }
  }

  async getAppointmentPayments(req, res) {
    try {
      const { appointmentId } = req.params;
      const payments = await paymentService.getAppointmentPayments(appointmentId);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán cuộc hẹn'
      });
    }
  }

  async getInvoicePayments(req, res) {
    try {
      const { invoiceId } = req.params;
      const payments = await paymentService.getInvoicePayments(invoiceId);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán hóa đơn'
      });
    }
  }

  /**
   * Lấy thanh toán theo recordId
   * Nếu không có thanh toán tồn tại, tự động tạo một cái từ record
   * GET /api/payments/record/:recordId
   */
  async getPaymentByRecordId(req, res) {
    try {
      const { recordId } = req.params;
      
      console.log(`🔍 [Lấy Thanh Toán theo Record] Đang kiểm tra record ${recordId}`);
      
      // Đầu tiên, thử lấy thanh toán đã tồn tại
      let payments = await paymentService.getPaymentsByRecordId(recordId);
      
      // Nếu không có thanh toán tồn tại, tạo một cái tự động
      if (!payments || payments.length === 0) {
        console.log(`📝 [Lấy Thanh Toán theo Record] Không tìm thấy thanh toán, đang tạo từ record ${recordId}`);
        
        try {
          const newPayment = await paymentService.createPaymentFromRecord(recordId);
          
          console.log(`✅ [Lấy Thanh Toán theo Record] Đã tạo thanh toán ${newPayment.paymentCode}`);
          
          return res.status(201).json({
            success: true,
            message: 'Tạo thanh toán từ record thành công',
            data: newPayment,
            isNewlyCreated: true
          });
        } catch (createError) {
          console.error(`❌ [Lấy Thanh Toán theo Record] Tạo thanh toán thất bại:`, createError);
          return res.status(400).json({
            success: false,
            message: createError.message || 'Không thể tạo thanh toán từ record'
          });
        }
      }
      
      console.log(`✅ [Lấy Thanh Toán theo Record] Tìm thấy thanh toán đã tồn tại ${payments[0].paymentCode}`);
      
      res.json({
        success: true,
        data: payments[0], // Trả về thanh toán đầu tiên (thường chỉ có một)
        total: payments.length,
        isNewlyCreated: false
      });
    } catch (error) {
      console.error(`❌ [Lấy Thanh Toán theo Record] Lỗi:`, error);
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán theo recordId'
      });
    }
  }

  // ============ CÁC PHƯƠNG THỨC DANH SÁCH & TÌM KIẾ̂M ============
  async listPayments(req, res) {
    try {
      const filter = {
        keyword: req.query.keyword,
        status: req.query.status,
        method: req.query.method,
        type: req.query.type,
        patientId: req.query.patientId,
        appointmentId: req.query.appointmentId,
        invoiceId: req.query.invoiceId,
        recordId: req.query.recordId,
        dateFrom: req.query.fromDate || req.query.dateFrom,
        dateTo: req.query.toDate || req.query.dateTo,
        minAmount: req.query.minAmount ? parseFloat(req.query.minAmount) : undefined,
        maxAmount: req.query.maxAmount ? parseFloat(req.query.maxAmount) : undefined,
        phone: req.query.phone,
        patientName: req.query.patientName,
        isVerified: req.query.isVerified !== undefined ? req.query.isVerified === 'true' : undefined
      };

      // Xoá các giá trị undefined
      Object.keys(filter).forEach(key => {
        if (filter[key] === undefined) {
          delete filter[key];
        }
      });

      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        sortBy: req.query.sortBy || 'processedAt',
        sortOrder: req.query.sortOrder || 'desc'
      };

      const payments = await paymentService.listPayments(filter, options);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy danh sách thanh toán'
      });
    }
  }

  async searchPayments(req, res) {
    try {
      const { q: searchTerm } = req.query;
      
      if (!searchTerm) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng nhập từ khóa tìm kiếm'
        });
      }

      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      };

      const payments = await paymentService.searchPayments(searchTerm, options);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi tìm kiếm thanh toán'
      });
    }
  }

  async getPendingPayments(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const payments = await paymentService.getPendingPayments(limit);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán chờ xử lý'
      });
    }
  }

  async getProcessingPayments(req, res) {
    try {
      const payments = await paymentService.getProcessingPayments();
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán đang xử lý'
      });
    }
  }

  async getFailedPayments(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const payments = await paymentService.getFailedPayments(limit);
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán thất bại'
      });
    }
  }

  async getTodayPayments(req, res) {
    try {
      const payments = await paymentService.getTodayPayments();
      
      res.json({
        success: true,
        data: payments
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thanh toán hôm nay'
      });
    }
  }

  // ============ CÁC PHƯƠNG THỨC CẬP NHẬT THANH TOÁN ============
  async updatePayment(req, res) {
    try {
      const payment = await paymentService.updatePayment(req.params.id, req.body);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy thanh toán'
        });
      }

      res.json({
        success: true,
        message: 'Cập nhật thanh toán thành công',
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi cập nhật thanh toán'
      });
    }
  }

  async confirmPayment(req, res) {
    try {
      const payment = await paymentService.confirmPayment(req.params.id, req.body);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy thanh toán'
        });
      }

      res.json({
        success: true,
        message: 'Xác nhận thanh toán thành công',
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi xác nhận thanh toán'
      });
    }
  }

  async cancelPayment(req, res) {
    try {
      const { reason } = req.body;
      const payment = await paymentService.cancelPayment(req.params.id, reason);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy thanh toán'
        });
      }

      res.json({
        success: true,
        message: 'Hủy thanh toán thành công',
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi hủy thanh toán'
      });
    }
  }

  async verifyPayment(req, res) {
    try {
      const verifiedBy = req.user?.userId;
      const payment = await paymentService.verifyPayment(req.params.id, verifiedBy);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Không tìm thấy thanh toán'
        });
      }

      res.json({
        success: true,
        message: 'Xác minh thanh toán thành công',
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi xác minh thanh toán'
      });
    }
  }

  // ============ CÁC PHƯƠNG THỨC THỐNG KÊ ============
  async getPaymentStatistics(req, res) {
    try {
      const { startDate, endDate, groupBy = 'day' } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng cung cấp startDate và endDate'
        });
      }

      const stats = await paymentService.getPaymentStatistics(
        new Date(startDate),
        new Date(endDate),
        groupBy
      );
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thống kê thanh toán'
      });
    }
  }

  async getRevenueStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng cung cấp startDate và endDate'
        });
      }

      const stats = await paymentService.getRevenueStatistics(
        new Date(startDate),
        new Date(endDate)
      );
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thống kê doanh thu'
      });
    }
  }

  async getRefundStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'Vui lòng cung cấp startDate và endDate'
        });
      }

      const stats = await paymentService.getRefundStatistics(
        new Date(startDate),
        new Date(endDate)
      );
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message || 'Lỗi lấy thống kê hoàn tiền'
      });
    }
  }

  // ============ PHƯƠNG THỨC RPC ============
  async confirmPaymentRPC(req, res) {
    try {
      const payment = await paymentService.confirmPaymentRPC({ id: req.params.id });
      res.json({
        success: true,
        data: payment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  async manualConfirmPayment(req, res) {
    try {
      const paymentId = req.params.id;
      const user = req.user;

      const allowedRoles = ["admin", "manager", "receptionist"];
      const userRoles = user?.roles || (user?.role ? [user.role] : []); // Hỗ trợ cả mảng roles và role đơn lẻ (legacy)
      const hasPermission = allowedRoles.some(role => userRoles.includes(role));
      
      if (!user || !hasPermission) {
        return res.status(403).json({
          success: false,
          message: "Chỉ admin, manager hoặc receptionist mới được confirm thanh toán thủ công"
        });
      }

      const result = await paymentService.manualConfirmPayment({ paymentId });
      res.status(200).json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error("❌ manualConfirmPayment error:", error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // ============ PHƯƠNG THỨC WEBHOOK CỔNG THANH TOÁN ============
  async vnpayReturn(req, res) {
    try {
      console.log('🔵 [VNPay Return] Received callback');
      console.log('🔵 [VNPay Return] Query params:', req.query);
      console.log('🔵 [VNPay Return] Full URL:', req.originalUrl);
      
      const vnpParams = req.query;
      console.log('💬 VNPay return params:', vnpParams);

      // Xác thực chữ ký
      const secretKey = process.env.VNPAY_HASH_SECRET || 'LGJNHZSLMX362UGJOKERT14VR4MF3JBD';
      console.log('🔵 [VNPay Return] Verifying signature with secret key:', secretKey);
      
      const isValid = verifyVNPayCallback(vnpParams, secretKey);

      if (!isValid) {
        console.error('❌ Invalid VNPay signature');
        return res.redirect(`${process.env.FRONTEND_URL}/patient/appointments?payment=error&message=Invalid+signature`);
      }

      const { vnp_TxnRef, vnp_ResponseCode, vnp_TransactionNo, vnp_Amount } = vnpParams;
      
      // Lấy vai trò người dùng từ Redis để xác định URL chuyển hướng
      const roleKey = `payment:role:${vnp_TxnRef}`;
      let userRole = await redis.get(roleKey);
      
      console.log('='.repeat(60));
      console.log('� [VNPay Return] REDIRECT DEBUG INFO');
      console.log('='.repeat(60));
      console.log('📋 Order ID (vnp_TxnRef):', vnp_TxnRef);
      console.log('🔑 Redis Key:', roleKey);
      console.log('👤 User Role from Redis:', userRole);
      console.log('📊 Role Type:', typeof userRole);
      console.log('❓ Is null/undefined?:', userRole === null || userRole === undefined);
      
      // Mặc định là patient nếu không tìm thấy
      if (!userRole) {
        console.log('⚠️  No role found in Redis, defaulting to patient');
        userRole = 'patient';
      }
      
      // Xác định đường dẫn chuyển hướng dựa trên vai trò
      // Luôn chuyển hướng đến trang kết quả thanh toán, để frontend xử lý chuyển hướng theo vai trò
      let redirectPath = '/patient/payment/result';
      
      console.log('🔗 Redirect Path:', redirectPath);
      console.log('� User Role (stored):', userRole);
      console.log('ℹ️  Frontend will handle role-based redirect after login check');
      console.log('='.repeat(60));
      
      // Xử lý callback thanh toán
      if (vnp_ResponseCode === '00') {
        const callbackData = {
          orderId: vnp_TxnRef,
          status: 'success',
          transactionId: vnp_TransactionNo,
          amount: parseInt(vnp_Amount) / 100
        };

        try {
          const payment = await paymentService.processGatewayCallback(callbackData);
          console.log('✅ Payment processed successfully:', payment._id);
          
          // Xóa vai trò khỏi Redis
          await redis.del(roleKey);
          
          // Các sự kiện được gửi qua RabbitMQ trong processGatewayCallback
          // Không cần gọi HTTP ở đây
          
          return res.redirect(`${process.env.FRONTEND_URL}${redirectPath}?payment=success&orderId=${vnp_TxnRef}`);
        } catch (error) {
          console.error('❌ Error processing payment callback:', error);
          return res.redirect(`${process.env.FRONTEND_URL}${redirectPath}?payment=error&orderId=${vnp_TxnRef}`);
        }
      } else {
        // Xóa vai trò khỏi Redis ngay cả khi thất bại
        await redis.del(roleKey);
        return res.redirect(`${process.env.FRONTEND_URL}${redirectPath}?payment=failed&orderId=${vnp_TxnRef}&code=${vnp_ResponseCode}`);
      }
    } catch (error) {
      console.error('❌ VNPay return error:', error);
      return res.redirect(`${process.env.FRONTEND_URL}/patient/appointments?payment=error`);
    }
  }

  // ============ Xử LÝ THANH TOÁN THẺ VISA ============
  /**
   * Xử lý thanh toán bằng thẻ Visa
   * POST /api/payment/visa/process
   */
  async processVisaPayment(req, res) {
    try {
      const {
        reservationId,
        cardNumber,
        cardHolder,
        expiryMonth,
        expiryYear,
        cvv,
        amount
      } = req.body;

      // Kiểm tra các trường bắt buộc
      if (!reservationId) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu mã đặt khám'
        });
      }

      if (!cardNumber || !cardHolder || !expiryMonth || !expiryYear || !cvv) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu thông tin thẻ thanh toán'
        });
      }

      // Lấy thông tin bệnh nhân từ req.user nếu đã xác thực
      const patientInfo = req.user ? {
        email: req.user.email,
        address: req.user.address
      } : {};

      // Xử lý thanh toán
      const result = await paymentService.processVisaPayment({
        reservationId,
        cardNumber,
        cardHolder,
        expiryMonth,
        expiryYear,
        cvv,
        amount,
        patientId: req.user?.userId,
        patientInfo
      });

      // Trả về phản hồi thành công
      res.status(201).json({
        success: true,
        message: result.message,
        data: {
          payment: result.payment,
          reservation: result.reservation
        }
      });

    } catch (error) {
      console.error('Visa payment controller error:', error);
      
      // Xử lý các loại lỗi khác nhau
      if (error.message.includes('hết hạn') || error.message.includes('không tồn tại')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      if (error.message.includes('Thanh toán thất bại')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      res.status(500).json({
        success: false,
        message: 'Lỗi xử lý thanh toán. Vui lòng thử lại sau.'
      });
    }
  }

  /**
   * Xác nhận thanh toán tiền mặt
   * POST /api/payments/:id/confirm-cash
   */
  async confirmCashPayment(req, res) {
    try {
      const { id } = req.params;
      const { paidAmount, notes } = req.body;

      if (!paidAmount || paidAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Số tiền thanh toán không hợp lệ'
        });
      }

      const user = req.user || {};
      const processedBy = {
        _id: user.userId || user._id || user.id || user.toString?.() || null,
        fullName: user.fullName || user.name || user.username || user.email || 'Staff'
      };

      if (!processedBy._id) {
        return res.status(401).json({
          success: false,
          message: 'Không xác định được người xác nhận thanh toán'
        });
      }

      const payment = await paymentService.confirmCashPayment(
        id,
        { paidAmount, notes },
        processedBy
      );

      res.status(200).json({
        success: true,
        message: 'Xác nhận thanh toán tiền mặt thành công',
        data: {
          paymentCode: payment.paymentCode,
          paidAmount: payment.paidAmount,
          finalAmount: payment.finalAmount,
          changeAmount: payment.changeAmount,
          completedAt: payment.completedAt
        }
      });
    } catch (error) {
      console.error('❌ Error confirming cash payment:', error);
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || 'Lỗi xác nhận thanh toán'
      });
    }
  }
}

module.exports = new PaymentController();

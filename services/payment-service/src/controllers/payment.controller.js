const paymentService = require('../services/payment.service');
const redis = require('../utils/redis.client');
const crypto = require('crypto');
const { generateMoMoSignature } = require('../utils/momo.utils');

class PaymentController {
  // ============ CREATE PAYMENT METHODS ============
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

  // ============ GET PAYMENT METHODS ============
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

  // ============ LIST & SEARCH METHODS ============
  async listPayments(req, res) {
    try {
      const filter = {
        status: req.query.status,
        method: req.query.method,
        type: req.query.type,
        patientId: req.query.patientId,
        appointmentId: req.query.appointmentId,
        invoiceId: req.query.invoiceId,
        recordId: req.query.recordId,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        minAmount: req.query.minAmount ? parseFloat(req.query.minAmount) : undefined,
        maxAmount: req.query.maxAmount ? parseFloat(req.query.maxAmount) : undefined,
        phone: req.query.phone,
        patientName: req.query.patientName,
        isVerified: req.query.isVerified !== undefined ? req.query.isVerified === 'true' : undefined
      };

      // Remove undefined values
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

  // ============ UPDATE PAYMENT METHODS ============
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

  // ============ STATISTICS METHODS ============
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

  // ============ RPC METHODS ============
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
      if (!user || !allowedRoles.includes(user.role)) {
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

  // ============ GATEWAY WEBHOOK METHODS ============
  async momoWebhook(req, res) {
    try {
      const data = req.body;
      console.log('💬 MoMo webhook payload:', data);

      const { orderId, amount, extraData, resultCode } = data;
      if (!extraData) return res.status(400).send('Missing extraData');

      // 1️⃣ Lấy temp payment từ Redis
      const tempPaymentId = extraData;
      const tempDataRaw = await redis.get(tempPaymentId);
      if (!tempDataRaw) {
        console.warn(`❌ Temp payment not found for key ${tempPaymentId}`);
        return res.status(404).send('Temp payment not found');
      }

      // 2️⃣ Xử lý payment
      if (resultCode === 0) {
        const savedPayment = await paymentService.confirmPaymentRPC({ id: tempPaymentId });
        await redis.del(tempPaymentId);
        return res.json({ 
          success: true,
          message: 'Payment success', 
          orderId, 
          paymentId: savedPayment._id 
        });
      } else {
        await redis.del(tempPaymentId);
        return res.json({ 
          success: false,
          message: 'Payment failed', 
          orderId 
        });
      }
    } catch (error) {
      console.error('MoMo webhook error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }

  async momoReturn(req, res) {
    res.send('Thank you! Payment process finished. Please check your order status.');
  }

  async zalopayWebhook(req, res) {
    try {
      const data = req.body;
      console.log('💬 ZaloPay webhook payload:', data);
      
      // Process ZaloPay webhook
      const callbackData = {
        orderId: data.app_trans_id,
        status: data.return_code === 1 ? 'success' : 'failed',
        transactionId: data.zp_trans_id
      };

      const payment = await paymentService.processGatewayCallback(callbackData);
      
      res.json({
        return_code: 1,
        return_message: 'success'
      });
    } catch (error) {
      console.error('ZaloPay webhook error:', error);
      res.json({
        return_code: -1,
        return_message: 'error'
      });
    }
  }

  async vnpayReturn(req, res) {
    try {
      const vnpParams = req.query;
      
      // Process VNPay return
      const callbackData = {
        orderId: vnpParams.vnp_TxnRef,
        status: vnpParams.vnp_ResponseCode === '00' ? 'success' : 'failed',
        transactionId: vnpParams.vnp_TransactionNo
      };

      const payment = await paymentService.processGatewayCallback(callbackData);
      
      res.redirect(`${process.env.FRONTEND_URL}/payment/result?status=${callbackData.status}&orderId=${callbackData.orderId}`);
    } catch (error) {
      console.error('VNPay return error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/payment/result?status=error`);
    }
  }






}

module.exports = new PaymentController();

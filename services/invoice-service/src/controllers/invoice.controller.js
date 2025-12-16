const invoiceService = require("../services/invoice.service");
const invoiceDetailService = require("../services/invoiceDetail.service");

class InvoiceController {
  // ============ THAO TÁC CRUD HÓA ĐƠN ============
  async createInvoice(req, res) {
    try {
      const userId = req.user.id;
      const invoice = await invoiceService.createInvoice(req.body, userId);
      
      res.status(201).json({
        success: true,
        message: "Tạo hóa đơn thành công",
        data: invoice
      });
    } catch (error) {
      console.error("❌ Lỗi tạo hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi tạo hóa đơn"
      });
    }
  }

  async getInvoices(req, res) {
    try {
      const { page, limit, status, patientId, startDate, endDate, keyword, ...filters } = req.query;
      
      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc'
      };

      const filter = {
        ...filters,
        ...(status && { status }),
        ...(patientId && { patientId }),
        ...(startDate && { dateFrom: startDate }),
        ...(endDate && { dateTo: endDate })
      };

      // Thêm tìm kiếm theo từ khóa nếu có
      if (keyword && keyword.trim()) {
        filter.keyword = keyword.trim();
      }

      const result = await invoiceService.getInvoices(filter, options);

      res.json({
        success: true,
        message: "Lấy danh sách hóa đơn thành công",
        data: result
      });
    } catch (error) {
      console.error("❌ Lỗi lấy danh sách hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy danh sách hóa đơn"
      });
    }
  }

  // Lấy hóa đơn của bệnh nhân hiện tại
  async getMyInvoices(req, res) {
    try {
      const patientId = req.user.id; // Lấy ID bệnh nhân từ user đã xác thực
      const { page, limit, status, dateFrom, dateTo, paymentMethod } = req.query;
      
      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20,
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc'
      };

      const filter = {
        patientId, // Buộc lọc theo bệnh nhân hiện tại
        ...(status && { status }),
        ...(paymentMethod && { paymentMethod }),
        ...(dateFrom && { dateFrom: new Date(dateFrom) }),
        ...(dateTo && { dateTo: new Date(dateTo) })
      };

      const result = await invoiceService.getInvoices(filter, options);

      res.json({
        success: true,
        message: "Lấy danh sách hóa đơn thành công",
        data: result
      });
    } catch (error) {
      console.error("❌ Lỗi lấy hóa đơn của tôi:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy danh sách hóa đơn"
      });
    }
  }

  // Lấy hóa đơn theo paymentId (cho gọi nội bộ giữa các service)
  async getInvoiceByPaymentId(req, res) {
    try {
      const { paymentId } = req.params;
      
      const invoiceRepository = require('../repositories/invoice.repository');
      const invoice = await invoiceRepository.findOne({ 
        'paymentSummary.paymentIds': paymentId 
      });

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Không tìm thấy hóa đơn cho paymentId này"
        });
      }

      res.json({
        success: true,
        message: "Lấy thông tin hóa đơn thành công",
        data: invoice
      });
    } catch (error) {
      console.error("❌ Lỗi lấy hóa đơn theo paymentId:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy thông tin hóa đơn"
      });
    }
  }

  async getInvoiceById(req, res) {
    try {
      const { id } = req.params;
      const invoice = await invoiceService.getInvoiceById(id);

      if (!invoice) {
        return res.status(404).json({
          success: false,
          message: "Hóa đơn không tồn tại"
        });
      }

      res.json({
        success: true,
        message: "Lấy thông tin hóa đơn thành công",
        data: invoice
      });
    } catch (error) {
      console.error("❌ Lỗi lấy hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy thông tin hóa đơn"
      });
    }
  }

  async updateInvoice(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      
      const updatedInvoice = await invoiceService.updateInvoice(id, req.body, userId);

      res.json({
        success: true,
        message: "Cập nhật hóa đơn thành công",
        data: updatedInvoice
      });
    } catch (error) {
      console.error("❌ Lỗi cập nhật hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi cập nhật hóa đơn"
      });
    }
  }

  async searchInvoices(req, res) {
    try {
      const { q: searchTerm, page, limit } = req.query;
      
      if (!searchTerm) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng nhập từ khóa tìm kiếm"
        });
      }

      const options = {
        page: parseInt(page) || 1,
        limit: parseInt(limit) || 20
      };

      const result = await invoiceService.searchInvoices(searchTerm, options);

      res.json({
        success: true,
        message: "Tìm kiếm hóa đơn thành công",
        data: result
      });
    } catch (error) {
      console.error("❌ Lỗi tìm kiếm hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi tìm kiếm hóa đơn"
      });
    }
  }

  // ============ ENDPOINTS TÍCH HỢP THANH TOÁN ============
  async handlePaymentSuccess(req, res) {
    try {
      const { invoiceId, paymentId, amount, paymentMethod } = req.body;

      if (!invoiceId || !paymentId || !amount) {
        return res.status(400).json({
          success: false,
          message: "Thiếu thông tin thanh toán"
        });
      }

      const updatedInvoice = await invoiceService.handlePaymentSuccess({
        invoiceId,
        paymentId,
        amount,
        paymentMethod
      });

      res.json({
        success: true,
        message: "Xử lý thanh toán thành công",
        data: updatedInvoice
      });
    } catch (error) {
      console.error("❌ Lỗi xử lý thanh toán thành công:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi xử lý thanh toán"
      });
    }
  }

  async createInvoiceFromPayment(req, res) {
    try {
      const paymentData = req.body;

      if (!paymentData || paymentData.status !== 'completed') {
        return res.status(400).json({
          success: false,
          message: "Thanh toán chưa hoàn thành"
        });
      }

      const invoice = await invoiceService.createInvoiceFromPayment(paymentData);

      res.status(201).json({
        success: true,
        message: "Tạo hóa đơn từ thanh toán thành công",
        data: invoice
      });
    } catch (error) {
      console.error("❌ Lỗi tạo hóa đơn từ thanh toán:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi tạo hóa đơn từ thanh toán"
      });
    }
  }

  // ============ ENDPOINTS NGHIỆP VỤ ============
  async finalizeInvoice(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const finalizedInvoice = await invoiceService.finalizeInvoice(id, userId);

      res.json({
        success: true,
        message: "Hoàn thiện hóa đơn thành công",
        data: finalizedInvoice
      });
    } catch (error) {
      console.error("❌ Lỗi hoàn thiện hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi hoàn thiện hóa đơn"
      });
    }
  }

  async cancelInvoice(req, res) {
    try {
      const { id } = req.params;
      const { cancelReason } = req.body;
      const userId = req.user.id;

      if (!cancelReason) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng nhập lý do hủy"
        });
      }

      const cancelledInvoice = await invoiceService.cancelInvoice(id, cancelReason, userId);

      res.json({
        success: true,
        message: "Hủy hóa đơn thành công",
        data: cancelledInvoice
      });
    } catch (error) {
      console.error("❌ Lỗi hủy hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi hủy hóa đơn"
      });
    }
  }

  async recalculateInvoice(req, res) {
    try {
      const { id } = req.params;
      
      const updatedInvoice = await invoiceService.recalculateInvoiceAmounts(id);

      res.json({
        success: true,
        message: "Tính lại số tiền hóa đơn thành công",
        data: updatedInvoice
      });
    } catch (error) {
      console.error("❌ Lỗi tính lại hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi tính lại số tiền"
      });
    }
  }

  // ============ ENDPOINTS CHI TIẾT HÓA ĐƠN ============
  async createInvoiceDetail(req, res) {
    try {
      const { invoiceId } = req.params;
      const userId = req.user.id;
      
      const detailData = {
        ...req.body,
        invoiceId
      };

      const detail = await invoiceDetailService.createDetail(detailData, userId);

      res.status(201).json({
        success: true,
        message: "Thêm chi tiết hóa đơn thành công",
        data: detail
      });
    } catch (error) {
      console.error("❌ Lỗi tạo chi tiết hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi thêm chi tiết hóa đơn"
      });
    }
  }

  async getInvoiceDetails(req, res) {
    try {
      const { invoiceId } = req.params;
      const { populateService, sortBy, sortOrder } = req.query;
      
      const options = {
        populateService: populateService === 'true',
        sortBy: sortBy || 'createdAt',
        sortOrder: sortOrder || 'asc'
      };

      const details = await invoiceDetailService.getDetailsByInvoice(invoiceId, options);

      res.json({
        success: true,
        message: "Lấy chi tiết hóa đơn thành công",
        data: details
      });
    } catch (error) {
      console.error("❌ Lỗi lấy chi tiết hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy chi tiết hóa đơn"
      });
    }
  }

  async updateInvoiceDetail(req, res) {
    try {
      const { detailId } = req.params;
      const userId = req.user.id;

      const updatedDetail = await invoiceDetailService.updateDetail(detailId, req.body, userId);

      res.json({
        success: true,
        message: "Cập nhật chi tiết hóa đơn thành công",
        data: updatedDetail
      });
    } catch (error) {
      console.error("❌ Lỗi cập nhật chi tiết hóa đơn:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi cập nhật chi tiết"
      });
    }
  }

  // ============ ENDPOINTS THỐNG KÊ & BÁO CÁO ============
  async getInvoiceStatistics(req, res) {
    try {
      const { startDate, endDate, groupBy = 'day' } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng cung cấp ngày bắt đầu và kết thúc"
        });
      }

      const stats = await invoiceService.getInvoiceStatistics(
        new Date(startDate),
        new Date(endDate),
        groupBy
      );

      res.json({
        success: true,
        message: "Lấy thống kê hóa đơn thành công",
        data: stats
      });
    } catch (error) {
      console.error("❌ Lỗi lấy thống kê:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy thống kê"
      });
    }
  }

  async getRevenueStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng cung cấp ngày bắt đầu và kết thúc"
        });
      }

      const stats = await invoiceService.getRevenueStats(
        new Date(startDate),
        new Date(endDate)
      );

      res.json({
        success: true,
        message: "Lấy thống kê doanh thu thành công",
        data: stats
      });
    } catch (error) {
      console.error("❌ Lỗi lấy thống kê doanh thu:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy thống kê doanh thu"
      });
    }
  }

  async getDashboardData(req, res) {
    try {
      const dashboardData = await invoiceService.getDashboardData();

      res.json({
        success: true,
        message: "Lấy dữ liệu dashboard thành công",
        data: dashboardData
      });
    } catch (error) {
      console.error("❌ Lỗi lấy dữ liệu dashboard:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy dữ liệu dashboard"
      });
    }
  }

  async getServiceStatistics(req, res) {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng cung cấp ngày bắt đầu và kết thúc"
        });
      }

      const stats = await invoiceDetailService.getServiceStatistics(
        new Date(startDate),
        new Date(endDate)
      );

      res.json({
        success: true,
        message: "Lấy thống kê dịch vụ thành công",
        data: stats
      });
    } catch (error) {
      console.error("❌ Lỗi lấy thống kê dịch vụ:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi lấy thống kê dịch vụ"
      });
    }
  }

  // ============ ENDPOINTS THEO DÕI ĐIỀU TRỊ ============
  async markTreatmentCompleted(req, res) {
    try {
      const { detailId } = req.params;
      const userId = req.user.id;
      
      const updatedDetail = await invoiceDetailService.markTreatmentCompleted(
        detailId, 
        req.body, 
        userId
      );

      res.json({
        success: true,
        message: "Đánh dấu điều trị hoàn thành",
        data: updatedDetail
      });
    } catch (error) {
      console.error("❌ Lỗi đánh dấu điều trị hoàn thành:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi đánh dấu hoàn thành"
      });
    }
  }

  async updateTreatmentProgress(req, res) {
    try {
      const { detailId } = req.params;
      const userId = req.user.id;
      
      const updatedDetail = await invoiceDetailService.updateTreatmentProgress(
        detailId, 
        req.body, 
        userId
      );

      res.json({
        success: true,
        message: "Cập nhật tiến trình điều trị thành công",
        data: updatedDetail
      });
    } catch (error) {
      console.error("❌ Lỗi cập nhật tiến trình điều trị:", error);
      res.status(400).json({
        success: false,
        message: error.message || "Lỗi khi cập nhật tiến trình"
      });
    }
  }

  // ============ KIỂM TRA SỨC KHỎe ============
  async healthCheck(req, res) {
    try {
      res.json({
        success: true,
        message: "Invoice Service đang hoạt động bình thường",
        timestamp: new Date().toISOString(),
        service: "invoice-service"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Lỗi hệ thống",
        error: error.message
      });
    }
  }
}

module.exports = new InvoiceController();

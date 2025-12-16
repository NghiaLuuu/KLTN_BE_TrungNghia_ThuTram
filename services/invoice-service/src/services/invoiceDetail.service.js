const invoiceDetailRepo = require("../repositories/invoiceDetail.repository");
const invoiceRepo = require("../repositories/invoice.repository");
const RedisClient = require("../config/redis.config");
const RPCClient = require("../config/rpc.config");
const { ServiceType, ServiceCategory } = require("../models/invoiceDetail.model");

class InvoiceDetailService {
  constructor() {
    this.redis = RedisClient;
    this.rpcClient = RPCClient;
    this.cacheTimeout = 300; // 5 phút
  }

  // ============ THAO TÁC CHI TIẾT CHÍNH ============
  async createDetail(detailData, userId) {
    try {
      // Kiểm tra hóa đơn tồn tại
      const invoice = await invoiceRepo.findById(detailData.invoiceId);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Kiểm tra dịch vụ tồn tại qua RPC
      if (detailData.serviceId) {
        const service = await this.rpcClient.call('service-service', 'getService', {
          serviceId: detailData.serviceId
        });

        if (!service) {
          throw new Error('Dịch vụ không tồn tại');
        }

        // Tự động điền thông tin dịch vụ
        detailData.serviceInfo = {
          name: service.name,
          description: service.description,
          category: service.category,
          estimatedDuration: service.estimatedDuration
        };

        if (!detailData.unitPrice) {
          detailData.unitPrice = service.price;
        }
      }

      detailData.createdBy = userId;

      const detail = await invoiceDetailRepo.create(detailData);

      // Tính lại số tiền hóa đơn
      await this.recalculateInvoiceTotals(detailData.invoiceId);

      // Xóa cache
      await this.clearDetailCache(detailData.invoiceId);

      console.log("✅ Đã tạo chi tiết hóa đơn:", detail);
      return detail;
    } catch (error) {
      console.error("❌ Lỗi tạo chi tiết hóa đơn:", error);
      throw error;
    }
  }

  async updateDetail(id, updateData, userId) {
    try {
      const detail = await invoiceDetailRepo.findById(id);
      if (!detail) {
        throw new Error('Chi tiết hóa đơn không tồn tại');
      }

      // Kiểm tra hóa đơn có cho phép cập nhật không
      const invoice = await invoiceRepo.findById(detail.invoiceId);
      if (invoice.status === 'paid') {
        throw new Error('Không thể cập nhật chi tiết hóa đơn đã thanh toán');
      }

      updateData.updatedBy = userId;
      const updatedDetail = await invoiceDetailRepo.update(id, updateData);

      // Tính lại số tiền hóa đơn nếu giá thay đổi
      if (updateData.quantity || updateData.unitPrice || updateData.discountInfo) {
        await this.recalculateInvoiceTotals(detail.invoiceId);
      }

      await this.clearDetailCache(detail.invoiceId);

      return updatedDetail;
    } catch (error) {
      console.error("❌ Lỗi cập nhật chi tiết hóa đơn:", error);
      throw error;
    }
  }

  async getDetailsByInvoice(invoiceId, options = {}) {
    try {
      console.log(`🔍 [InvoiceDetail Service] Lấy chi tiết cho hóa đơn: ${invoiceId}`);
      
      // ⚠️ Tạm thời tắt cache để debug
      const useCache = false;
      const cacheKey = `invoice_details:${invoiceId}:${JSON.stringify(options)}`;
      
      if (useCache) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          console.log(`✅ [InvoiceDetail Service] Tìm thấy chi tiết trong cache`);
          return JSON.parse(cached);
        }
      }

      const details = await invoiceDetailRepo.findByInvoice(invoiceId, options);
      console.log(`📋 [InvoiceDetail Service] Tìm thấy ${details.length} chi tiết cho hóa đơn ${invoiceId}`);
      
      if (useCache) {
        await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(details));
      }

      return details;
    } catch (error) {
      console.error("❌ Lỗi lấy chi tiết hóa đơn:", error);
      throw error;
    }
  }

  async getDetailById(id) {
    try {
      const cacheKey = `detail:${id}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const detail = await invoiceDetailRepo.findById(id);
      if (!detail) {
        throw new Error('Chi tiết hóa đơn không tồn tại');
      }

      await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(detail));

      return detail;
    } catch (error) {
      console.error("❌ Lỗi lấy chi tiết:", error);
      throw error;
    }
  }

  // ============ THEO DÕI ĐIỀU TRỊ ============
  async markTreatmentCompleted(detailId, completionData, userId) {
    try {
      const completionInfo = {
        ...completionData,
        completedBy: userId
      };

      const updatedDetail = await invoiceDetailRepo.markTreatmentCompleted(detailId, completionInfo);

      await this.clearDetailCache(updatedDetail.invoiceId);

      return updatedDetail;
    } catch (error) {
      console.error("❌ Lỗi đánh dấu điều trị hoàn thành:", error);
      throw error;
    }
  }

  async updateTreatmentProgress(detailId, progressData, userId) {
    try {
      const progressInfo = {
        ...progressData,
        updatedBy: userId
      };

      const updatedDetail = await invoiceDetailRepo.updateTreatmentProgress(detailId, progressInfo);

      await this.clearDetailCache(updatedDetail.invoiceId);

      return updatedDetail;
    } catch (error) {
      console.error("❌ Lỗi cập nhật tiến trình điều trị:", error);
      throw error;
    }
  }

  // ============ THỐNG KÊ & BÁO CÁO ============
  async getServiceStatistics(startDate, endDate) {
    try {
      const cacheKey = `service_stats:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await invoiceDetailRepo.getServiceStatistics(startDate, endDate);
      
      await this.redis.setex(cacheKey, 1800, JSON.stringify(stats)); // 30 minutes

      return stats;
    } catch (error) {
      console.error("❌ Lỗi lấy thống kê dịch vụ:", error);
      throw error;
    }
  }

  // ============ CÁC PHƯƠNG THỨC HỖ TRỢ ============
  async recalculateInvoiceTotals(invoiceId) {
    try {
      // Lấy tất cả chi tiết đang hoạt động của hóa đơn này
      const details = await invoiceDetailRepo.findByInvoice(invoiceId);
      
      // Tính subtotal từ tất cả chi tiết
      const subtotal = details.reduce((sum, detail) => sum + detail.totalAmount, 0);

      // Lấy hóa đơn hiện tại để giữ thông tin thuế và giảm giá
      const invoice = await invoiceRepo.findById(invoiceId);
      if (!invoice) return;

      const taxAmount = invoice.taxInfo?.taxAmount || 0;
      const discountAmount = invoice.discountInfo?.discountAmount || 0;
      const totalAmount = subtotal + taxAmount - discountAmount;

      // Cập nhật tổng hóa đơn
      await invoiceRepo.update(invoiceId, {
        subtotalAmount: subtotal,
        totalAmount: Math.max(0, totalAmount) // Đảm bảo tổng không âm
      });

      console.log(`✅ Đã tính lại tổng hóa đơn ${invoiceId}: ${totalAmount}`);
    } catch (error) {
      console.error("❌ Lỗi tính lại tổng hóa đơn:", error);
      throw error;
    }
  }

  async clearDetailCache(invoiceId) {
    try {
      // Xóa cache chi tiết hóa đơn
      const detailKeys = await this.redis.keys(`invoice_details:${invoiceId}:*`);
      if (detailKeys.length > 0) {
        await this.redis.del(...detailKeys);
      }

      // Xóa cache thống kê
      const statsKeys = await this.redis.keys('service_stats:*');
      if (statsKeys.length > 0) {
        await this.redis.del(...statsKeys);
      }
    } catch (error) {
      console.warn("⚠️ Cảnh báo: Không thể xóa cache chi tiết:", error.message);
    }
  }
}

module.exports = new InvoiceDetailService();

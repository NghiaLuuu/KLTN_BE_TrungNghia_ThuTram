const invoiceDetailRepo = require("../repositories/invoiceDetail.repository");
const invoiceRepo = require("../repositories/invoice.repository");
const RedisClient = require("../config/redis.config");
const RPCClient = require("../config/rpc.config");
const { ServiceType, ServiceCategory } = require("../models/invoiceDetail.model");

class InvoiceDetailService {
  constructor() {
    this.redis = RedisClient;
    this.rpcClient = RPCClient;
    this.cacheTimeout = 300; // 5 minutes
  }

  // ============ CORE DETAIL OPERATIONS ============
  async createDetail(detailData, userId) {
    try {
      // Validate invoice exists
      const invoice = await invoiceRepo.findById(detailData.invoiceId);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Validate service exists via RPC
      if (detailData.serviceId) {
        const service = await this.rpcClient.call('service-service', 'getService', {
          serviceId: detailData.serviceId
        });

        if (!service) {
          throw new Error('Dịch vụ không tồn tại');
        }

        // Auto-fill service info
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

      // Recalculate invoice amounts
      await this.recalculateInvoiceTotals(detailData.invoiceId);

      // Clear cache
      await this.clearDetailCache(detailData.invoiceId);

      console.log("✅ Invoice detail created:", detail);
      return detail;
    } catch (error) {
      console.error("❌ Error creating invoice detail:", error);
      throw error;
    }
  }

  async updateDetail(id, updateData, userId) {
    try {
      const detail = await invoiceDetailRepo.findById(id);
      if (!detail) {
        throw new Error('Chi tiết hóa đơn không tồn tại');
      }

      // Check if invoice allows updates
      const invoice = await invoiceRepo.findById(detail.invoiceId);
      if (invoice.status === 'paid') {
        throw new Error('Không thể cập nhật chi tiết hóa đơn đã thanh toán');
      }

      updateData.updatedBy = userId;
      const updatedDetail = await invoiceDetailRepo.update(id, updateData);

      // Recalculate invoice amounts if pricing changed
      if (updateData.quantity || updateData.unitPrice || updateData.discountInfo) {
        await this.recalculateInvoiceTotals(detail.invoiceId);
      }

      await this.clearDetailCache(detail.invoiceId);

      return updatedDetail;
    } catch (error) {
      console.error("❌ Error updating invoice detail:", error);
      throw error;
    }
  }

  async getDetailsByInvoice(invoiceId, options = {}) {
    try {
      const cacheKey = `invoice_details:${invoiceId}:${JSON.stringify(options)}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const details = await invoiceDetailRepo.findByInvoice(invoiceId, options);
      
      await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(details));

      return details;
    } catch (error) {
      console.error("❌ Error getting invoice details:", error);
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
      console.error("❌ Error getting detail:", error);
      throw error;
    }
  }

  // ============ TREATMENT TRACKING ============
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
      console.error("❌ Error marking treatment completed:", error);
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
      console.error("❌ Error updating treatment progress:", error);
      throw error;
    }
  }

  // ============ STATISTICS & REPORTING ============
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
      console.error("❌ Error getting service statistics:", error);
      throw error;
    }
  }

  // ============ HELPER METHODS ============
  async recalculateInvoiceTotals(invoiceId) {
    try {
      // Get all active details for this invoice
      const details = await invoiceDetailRepo.findByInvoice(invoiceId);
      
      // Calculate subtotal from all details
      const subtotal = details.reduce((sum, detail) => sum + detail.totalAmount, 0);

      // Get current invoice to preserve tax and discount info
      const invoice = await invoiceRepo.findById(invoiceId);
      if (!invoice) return;

      const taxAmount = invoice.taxInfo?.taxAmount || 0;
      const discountAmount = invoice.discountInfo?.discountAmount || 0;
      const totalAmount = subtotal + taxAmount - discountAmount;

      // Update invoice totals
      await invoiceRepo.update(invoiceId, {
        subtotalAmount: subtotal,
        totalAmount: Math.max(0, totalAmount) // Ensure total is not negative
      });

      console.log(`✅ Recalculated invoice ${invoiceId} totals: ${totalAmount}`);
    } catch (error) {
      console.error("❌ Error recalculating invoice totals:", error);
      throw error;
    }
  }

  async clearDetailCache(invoiceId) {
    try {
      // Clear invoice details cache
      const detailKeys = await this.redis.keys(`invoice_details:${invoiceId}:*`);
      if (detailKeys.length > 0) {
        await this.redis.del(...detailKeys);
      }

      // Clear stats caches
      const statsKeys = await this.redis.keys('service_stats:*');
      if (statsKeys.length > 0) {
        await this.redis.del(...statsKeys);
      }
    } catch (error) {
      console.warn("⚠️ Warning: Could not clear detail cache:", error.message);
    }
  }
}

module.exports = new InvoiceDetailService();

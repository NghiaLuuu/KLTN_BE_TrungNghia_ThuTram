const invoiceRepo = require("../repositories/invoice.repository");
const invoiceDetailRepo = require("../repositories/invoiceDetail.repository");
const RedisClient = require("../config/redis.config");
const RPCClient = require("../config/rpc.config");
const { InvoiceStatus, InvoiceType } = require("../models/invoice.model");

class InvoiceService {
  constructor() {
    this.redis = RedisClient;
    this.rpcClient = RPCClient;
    this.cacheTimeout = 300; // 5 minutes
  }

  // ============ CORE INVOICE OPERATIONS ============
  async createInvoice(invoiceData, userId) {
    try {
      // Validate appointment if provided
      if (invoiceData.appointmentId) {
        const appointment = await this.rpcClient.call('appointment-service', 'getAppointment', {
          appointmentId: invoiceData.appointmentId
        });

        if (!appointment) {
          throw new Error('Appointment không tồn tại');
        }

        // Only create invoice if appointment is completed or confirmed
        if (!['completed', 'confirmed'].includes(appointment.status)) {
          throw new Error('Chỉ có thể tạo hóa đơn cho cuộc hẹn đã hoàn thành hoặc đã xác nhận');
        }

        // Auto-fill patient info from appointment
        invoiceData.patientId = appointment.patientId;
        invoiceData.patientInfo = appointment.patientInfo;
      }

      // Generate invoice number
      invoiceData.invoiceNumber = await this.generateInvoiceNumber();

      // Set default values
      invoiceData.createdBy = userId;
      invoiceData.status = invoiceData.status || InvoiceStatus.DRAFT;
      invoiceData.type = invoiceData.type || InvoiceType.APPOINTMENT;

      // Calculate due date if not provided
      if (!invoiceData.dueDate) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7); // Default 7 days
        invoiceData.dueDate = dueDate;
      }

      // Create invoice
      const invoice = await invoiceRepo.create(invoiceData);

      // Create invoice details if provided
      if (invoiceData.details && invoiceData.details.length > 0) {
        const detailsWithInvoiceId = invoiceData.details.map(detail => ({
          ...detail,
          invoiceId: invoice._id
        }));

        const createdDetails = await invoiceDetailRepo.createMultiple(detailsWithInvoiceId);
        
        // Calculate total amounts
        const totalAmount = createdDetails.reduce((sum, detail) => sum + detail.totalAmount, 0);
        
        // Update invoice with calculated amounts
        await invoiceRepo.update(invoice._id, {
          subtotalAmount: totalAmount,
          totalAmount: totalAmount + (invoice.taxInfo?.taxAmount || 0) - (invoice.discountInfo?.discountAmount || 0)
        });
      }

      // Clear cache
      await this.clearInvoiceCache();

      console.log("✅ Invoice created:", invoice);
      return invoice;
    } catch (error) {
      console.error("❌ Error creating invoice:", error);
      throw error;
    }
  }

  async updateInvoice(id, updateData, userId) {
    try {
      const invoice = await invoiceRepo.findById(id);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Check if invoice can be updated
      if (invoice.status === InvoiceStatus.PAID) {
        throw new Error('Không thể cập nhật hóa đơn đã thanh toán');
      }

      updateData.updatedBy = userId;
      const updatedInvoice = await invoiceRepo.update(id, updateData);

      // Clear cache
      await this.clearInvoiceCache(id);

      return updatedInvoice;
    } catch (error) {
      console.error("❌ Error updating invoice:", error);
      throw error;
    }
  }

  async getInvoiceById(id, useCache = true) {
    try {
      const cacheKey = `invoice:${id}`;

      if (useCache) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const invoice = await invoiceRepo.findById(id);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Get invoice details
      const details = await invoiceDetailRepo.findByInvoice(id, { populateService: true });
      
      const result = {
        ...invoice.toObject(),
        details
      };

      // Cache result
      if (useCache) {
        await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      console.error("❌ Error getting invoice:", error);
      throw error;
    }
  }

  async getInvoices(filter = {}, options = {}) {
    try {
      const cacheKey = `invoices:${JSON.stringify({ filter, options })}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await invoiceRepo.findAll(filter, options);

      // Cache for shorter time due to frequently changing data
      await this.redis.setex(cacheKey, 60, JSON.stringify(result));

      return result;
    } catch (error) {
      console.error("❌ Error getting invoices:", error);
      throw error;
    }
  }

  async searchInvoices(searchTerm, options = {}) {
    try {
      return await invoiceRepo.search(searchTerm, options);
    } catch (error) {
      console.error("❌ Error searching invoices:", error);
      throw error;
    }
  }

  // ============ PAYMENT INTEGRATION METHODS ============
  async handlePaymentSuccess(paymentData) {
    try {
      console.log("🔄 Processing payment success for invoice:", paymentData);

      const { invoiceId, paymentId, amount, paymentMethod } = paymentData;

      const invoice = await invoiceRepo.findById(invoiceId);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Add payment to invoice
      const updatedInvoice = await invoiceRepo.addPaymentToInvoice(invoiceId, {
        paymentId,
        amount,
        method: paymentMethod
      });

      // Clear cache
      await this.clearInvoiceCache(invoiceId);

      // Send notification if needed
      await this.sendPaymentNotification(updatedInvoice);

      console.log("✅ Payment processed successfully for invoice:", invoiceId);
      return updatedInvoice;
    } catch (error) {
      console.error("❌ Error processing payment:", error);
      throw error;
    }
  }

  async createInvoiceFromPayment(paymentData) {
    try {
      // Only create invoice if payment is successful
      if (paymentData.status !== 'completed') {
        throw new Error('Chỉ tạo hóa đơn khi thanh toán thành công');
      }

      const invoiceData = {
        appointmentId: paymentData.appointmentId,
        patientId: paymentData.patientId,
        type: InvoiceType.APPOINTMENT,
        status: InvoiceStatus.PAID,
        totalAmount: paymentData.amount,
        paidDate: new Date(),
        paymentSummary: {
          totalPaid: paymentData.amount,
          remainingAmount: 0,
          paymentIds: [paymentData._id],
          lastPaymentDate: new Date(),
          paymentMethod: paymentData.paymentMethod
        },
        notes: `Hóa đơn tự động tạo từ thanh toán ${paymentData._id}`
      };

      return await this.createInvoice(invoiceData, 'system');
    } catch (error) {
      console.error("❌ Error creating invoice from payment:", error);
      throw error;
    }
  }

  // ============ BUSINESS LOGIC METHODS ============
  async finalizeInvoice(id, userId) {
    try {
      const invoice = await invoiceRepo.findById(id);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new Error('Chỉ có thể hoàn thiện hóa đơn nháp');
      }

      // Validate invoice has details
      const details = await invoiceDetailRepo.findByInvoice(id);
      if (!details || details.length === 0) {
        throw new Error('Hóa đơn phải có ít nhất một dịch vụ');
      }

      // Recalculate amounts
      await this.recalculateInvoiceAmounts(id);

      // Convert to pending
      const finalizedInvoice = await invoiceRepo.convertDraftToPending(id, {
        finalizedBy: userId,
        finalizedAt: new Date()
      });

      await this.clearInvoiceCache(id);
      return finalizedInvoice;
    } catch (error) {
      console.error("❌ Error finalizing invoice:", error);
      throw error;
    }
  }

  async cancelInvoice(id, cancelReason, userId) {
    try {
      const updatedInvoice = await invoiceRepo.cancelInvoice(id, cancelReason, userId);
      await this.clearInvoiceCache(id);
      return updatedInvoice;
    } catch (error) {
      console.error("❌ Error cancelling invoice:", error);
      throw error;
    }
  }

  async recalculateInvoiceAmounts(invoiceId) {
    try {
      // Recalculate detail amounts first
      await invoiceDetailRepo.recalculateInvoiceAmounts(invoiceId);

      // Get updated details
      const details = await invoiceDetailRepo.findByInvoice(invoiceId);
      const subtotal = details.reduce((sum, detail) => sum + detail.totalAmount, 0);

      const invoice = await invoiceRepo.findById(invoiceId);
      
      // Recalculate invoice totals
      const taxAmount = invoice.taxInfo?.taxAmount || 0;
      const discountAmount = invoice.discountInfo?.discountAmount || 0;
      const totalAmount = subtotal + taxAmount - discountAmount;

      return await invoiceRepo.update(invoiceId, {
        subtotalAmount: subtotal,
        totalAmount: totalAmount
      });
    } catch (error) {
      console.error("❌ Error recalculating amounts:", error);
      throw error;
    }
  }

  // ============ STATISTICS & REPORTING ============
  async getInvoiceStatistics(startDate, endDate, groupBy = 'day') {
    try {
      const cacheKey = `stats:invoices:${startDate.toISOString()}:${endDate.toISOString()}:${groupBy}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await invoiceRepo.getInvoiceStatistics(startDate, endDate, groupBy);
      
      // Cache for longer time as stats don't change frequently
      await this.redis.setex(cacheKey, 1800, JSON.stringify(stats)); // 30 minutes

      return stats;
    } catch (error) {
      console.error("❌ Error getting statistics:", error);
      throw error;
    }
  }

  async getRevenueStats(startDate, endDate) {
    try {
      const cacheKey = `stats:revenue:${startDate.toISOString()}:${endDate.toISOString()}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await invoiceRepo.getRevenueStats(startDate, endDate);
      
      await this.redis.setex(cacheKey, 1800, JSON.stringify(stats));

      return stats;
    } catch (error) {
      console.error("❌ Error getting revenue stats:", error);
      throw error;
    }
  }

  async getDashboardData() {
    try {
      const cacheKey = 'dashboard:invoices';
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const today = new Date();
      const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        todayInvoices,
        pendingInvoices,
        overdueInvoices,
        weeklyRevenue,
        monthlyRevenue
      ] = await Promise.all([
        invoiceRepo.findTodayInvoices(),
        invoiceRepo.findPendingInvoices(10),
        invoiceRepo.findOverdueInvoices(),
        this.getRevenueStats(lastWeek, today),
        this.getRevenueStats(lastMonth, today)
      ]);

      const dashboardData = {
        todayInvoices: todayInvoices.length,
        pendingInvoices: pendingInvoices.length,
        overdueInvoices: overdueInvoices.length,
        weeklyRevenue: weeklyRevenue.totalRevenue || 0,
        monthlyRevenue: monthlyRevenue.totalRevenue || 0
      };

      await this.redis.setex(cacheKey, 300, JSON.stringify(dashboardData)); // 5 minutes

      return dashboardData;
    } catch (error) {
      console.error("❌ Error getting dashboard data:", error);
      throw error;
    }
  }

  // ============ HELPER METHODS ============
  async generateInvoiceNumber() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    
    // Count invoices for this month
    const startOfMonth = new Date(year, today.getMonth(), 1);
    const endOfMonth = new Date(year, today.getMonth() + 1, 0);
    
    const count = await invoiceRepo.findByDateRange(startOfMonth, endOfMonth);
    const sequenceNumber = String(count.length + 1).padStart(4, '0');
    
    return `INV${year}${month}${sequenceNumber}`;
  }

  async clearInvoiceCache(invoiceId = null) {
    try {
      if (invoiceId) {
        await this.redis.del(`invoice:${invoiceId}`);
      }
      
      // Clear all invoice list caches
      const keys = await this.redis.keys('invoices:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      // Clear stats caches
      const statsKeys = await this.redis.keys('stats:*');
      if (statsKeys.length > 0) {
        await this.redis.del(...statsKeys);
      }

      // Clear dashboard cache
      await this.redis.del('dashboard:invoices');
    } catch (error) {
      console.error("⚠️ Warning: Could not clear cache:", error.message);
    }
  }

  async sendPaymentNotification(invoice) {
    try {
      // Send notification via RPC to notification service
      await this.rpcClient.call('notification-service', 'sendInvoicePaymentNotification', {
        invoiceId: invoice._id,
        patientInfo: invoice.patientInfo,
        amount: invoice.paymentSummary.totalPaid,
        status: invoice.status
      });
    } catch (error) {
      console.error("⚠️ Warning: Could not send notification:", error.message);
    }
  }
}

module.exports = new InvoiceService();

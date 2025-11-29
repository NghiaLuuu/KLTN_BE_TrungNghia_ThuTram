const mongoose = require('mongoose');
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
      // 🔥 FIX: If userId is 'system', use dentist ID or a default system ID
      if (userId === 'system') {
        invoiceData.createdBy = invoiceData.dentistInfo?.dentistId || new mongoose.Types.ObjectId();
      } else {
        invoiceData.createdBy = userId;
      }
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
          invoiceId: invoice._id,
          createdBy: detail.createdBy || userId || 'system' // Ensure createdBy is set
        }));

        console.log('💾 Creating', detailsWithInvoiceId.length, 'invoice details');
        const createdDetails = await invoiceDetailRepo.createMultiple(detailsWithInvoiceId);
        console.log('✅ Created invoice details:', createdDetails.map(d => ({
          name: d.serviceInfo?.name,
          unitPrice: d.unitPrice,
          quantity: d.quantity,
          totalPrice: d.totalPrice
        })));
        
        // 🔥 FIX: Calculate total amounts - use totalPrice not totalAmount
        const subtotalAmount = createdDetails.reduce((sum, detail) => sum + (detail.totalPrice || 0), 0);
        
        // Update invoice with calculated amounts
        await invoiceRepo.update(invoice._id, {
          subtotalAmount: subtotalAmount,
          totalAmount: subtotalAmount + (invoice.taxInfo?.taxAmount || 0) - (invoice.discountInfo?.discountAmount || 0)
        });
        
        console.log('💰 Updated invoice total:', subtotalAmount);
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
      // ⚠️ Temporarily skip cache for debugging
      const useCache = false;
      const cacheKey = `invoices:${JSON.stringify({ filter, options })}`;
      
      if (useCache) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const result = await invoiceRepo.findAll(filter, options);

      // ✅ Populate invoice details for each invoice
      if (result.invoices && result.invoices.length > 0) {
        const invoicesWithDetails = await Promise.all(
          result.invoices.map(async (invoice) => {
            const details = await invoiceDetailRepo.findByInvoice(invoice._id);
            console.log(`📋 [Invoice Service] Invoice ${invoice.invoiceNumber} has ${details.length} details`);
            return {
              ...invoice.toObject ? invoice.toObject() : invoice,
              details
            };
          })
        );
        result.invoices = invoicesWithDetails;
      }

      // Cache for shorter time due to frequently changing data
      if (useCache) {
        await this.redis.setex(cacheKey, 60, JSON.stringify(result));
      }

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

      console.log('📝 Creating invoice from payment:', paymentData._id);

      // 🔥 FIX: Get services from record if recordId exists
      let invoiceDetails = [];
      if (paymentData.recordId) {
        try {
          console.log('📋 Fetching record:', paymentData.recordId);
          const record = await this.rpcClient.call('record-service', 'getRecordById', {
            id: paymentData.recordId
          });

          if (record) {
            // 🔥 FIX: Add MAIN service first (serviceId + serviceAddOn)
            if (record.serviceId && record.serviceName) {
              const mainServicePrice = record.serviceAddOnPrice || record.servicePrice || 0;
              const mainServiceQuantity = record.quantity || 1;
              const mainServiceSubtotal = mainServicePrice * mainServiceQuantity;

              invoiceDetails.push({
                serviceId: record.serviceId || null,
                serviceInfo: {
                  name: record.serviceName,
                  code: record.serviceAddOnId || null,
                  type: record.type === 'exam' ? 'examination' : 'filling', // Use valid enum
                  category: 'restorative',
                  description: record.serviceAddOnName || record.serviceName,
                  unit: record.serviceAddOnUnit || null
                },
                unitPrice: mainServicePrice,
                quantity: mainServiceQuantity,
                subtotal: mainServiceSubtotal,
                discountAmount: 0,
                totalPrice: mainServiceSubtotal,
                notes: `Dịch vụ chính: ${record.serviceName}${record.serviceAddOnName ? ' - ' + record.serviceAddOnName : ''}`,
                status: 'completed',
                createdBy: 'system'
              });
              
              console.log(`✅ Added main service: ${record.serviceName} (${mainServicePrice.toLocaleString()} x ${mainServiceQuantity} = ${mainServiceSubtotal.toLocaleString()})`);
            }
            
            // 🔥 FIX: Add additional services
            if (record.additionalServices && record.additionalServices.length > 0) {
              console.log(`✅ Found ${record.additionalServices.length} additional services`);
              
              const additionalDetails = record.additionalServices.map(service => {
                const unitPrice = service.price || 0;
                const quantity = service.quantity || 1;
                const subtotal = unitPrice * quantity;
                const totalPrice = service.totalPrice || subtotal;

                return {
                  serviceId: service.serviceId || null,
                  serviceInfo: {
                    name: service.serviceName || 'Unknown Service',
                    code: service.serviceAddOnId || null,
                    type: service.serviceType === 'exam' ? 'examination' : 'filling',
                    category: 'restorative',
                    description: service.serviceAddOnName || service.serviceName,
                    unit: service.serviceAddOnUnit || null
                  },
                  unitPrice: unitPrice,
                  quantity: quantity,
                  subtotal: subtotal,
                  discountAmount: 0,
                  totalPrice: totalPrice,
                  notes: service.notes || '',
                  status: 'completed',
                  createdBy: 'system'
                };
              });
              
              invoiceDetails.push(...additionalDetails);
            }
            
            console.log('📦 Total invoice details:', invoiceDetails.length);
            console.log('💰 Details:', invoiceDetails.map(d => ({
              name: d.serviceInfo.name,
              unitPrice: d.unitPrice,
              quantity: d.quantity,
              totalPrice: d.totalPrice
            })));
          } else {
            console.warn('⚠️ Record not found');
          }
        } catch (error) {
          console.error('❌ Error fetching record:', error);
          // Continue without details
        }
      }

      // 🔥 FIX: Get dentist info from payment or record
      let dentistInfo = null;
      if (paymentData.processedBy && paymentData.processedByName) {
        dentistInfo = {
          dentistId: paymentData.processedBy,
          name: paymentData.processedByName
        };
      } else if (record && record.dentistId && record.dentistName) {
        dentistInfo = {
          dentistId: record.dentistId,
          name: record.dentistName
        };
      }

      // 🔥 FIX: Calculate subtotal from invoice details (NOT from payment amount)
      const subtotalFromDetails = invoiceDetails.reduce((sum, detail) => sum + (detail.totalPrice || 0), 0);
      
      // 🔥 FIX: Use payment.originalAmount or calculated subtotal (before discount/deposit)
      // Payment amount = finalAmount (after deposit) or paidAmount
      // Invoice should show ORIGINAL service prices
      const invoiceSubtotal = subtotalFromDetails > 0 ? subtotalFromDetails : (paymentData.originalAmount || paymentData.amount);
      const invoiceTotalAmount = invoiceSubtotal; // No additional tax/discount at invoice level

      console.log('💰 Invoice calculation:');
      console.log('  - Payment amount:', paymentData.amount?.toLocaleString());
      console.log('  - Payment originalAmount:', paymentData.originalAmount?.toLocaleString());
      console.log('  - Subtotal from details:', subtotalFromDetails.toLocaleString());
      console.log('  - Invoice subtotal:', invoiceSubtotal.toLocaleString());
      console.log('  - Invoice total:', invoiceTotalAmount.toLocaleString());

      const invoiceData = {
        appointmentId: paymentData.appointmentId,
        patientId: paymentData.patientId,
        recordId: paymentData.recordId, // 🆕 Link to record
        type: InvoiceType.APPOINTMENT,
        status: InvoiceStatus.PAID,
        totalAmount: invoiceTotalAmount, // 🔥 FIX: Use calculated total from services
        subtotal: invoiceSubtotal, // 🔥 FIX: Use calculated subtotal from services
        paidDate: new Date(),
        dentistInfo: dentistInfo, // 🔥 FIX: Add required dentistInfo
        createdByRole: 'system', // 🔥 FIX: Add required createdByRole
        paymentSummary: {
          totalPaid: paymentData.paidAmount || paymentData.amount, // 🔥 Use paidAmount
          remainingAmount: 0,
          paymentIds: [paymentData._id],
          lastPaymentDate: new Date(),
          paymentMethod: paymentData.paymentMethod
        },
        details: invoiceDetails, // 🔥 FIX: Add invoice details from record
        notes: `Hóa đơn tự động tạo từ thanh toán ${paymentData._id}`
      };

      console.log('💰 Creating invoice with', invoiceDetails.length, 'service details');
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
      // Convert to Date if received as string from RabbitMQ
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const cacheKey = `stats:invoices:${start.toISOString()}:${end.toISOString()}:${groupBy}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await invoiceRepo.getInvoiceStatistics(start, end, groupBy);
      
      // Cache for longer time as stats don't change frequently
      await this.redis.setex(cacheKey, 1800, JSON.stringify(stats)); // 30 minutes

      return stats;
    } catch (error) {
      console.error("❌ Error getting statistics:", error);
      throw error;
    }
  }

  async getRevenueStats(startDate, endDate, groupBy = 'day', dentistId = null, serviceId = null) {
    try {
      // Convert to Date if received as string from RabbitMQ
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      // ❌ CACHE DISABLED - Always fetch fresh data for accurate statistics
      // const cacheKey = `stats:revenue:${start.toISOString()}:${end.toISOString()}:${groupBy}:${dentistId || 'all'}:${serviceId || 'all'}`;
      // const cached = await this.redis.get(cacheKey);
      // if (cached) {
      //   return JSON.parse(cached);
      // }

      const stats = await invoiceRepo.getRevenueStats(start, end, groupBy, dentistId, serviceId);
      
      // ❌ CACHE DISABLED
      // await this.redis.setex(cacheKey, 1800, JSON.stringify(stats));

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

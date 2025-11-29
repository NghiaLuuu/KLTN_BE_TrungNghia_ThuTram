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
      // Validate appointment if provided AND patientInfo not already available
      // 🔥 FIX: Skip appointment validation if patientId and patientInfo already exist
      // This avoids unnecessary RPC calls when creating invoice from payment
      if (invoiceData.appointmentId && (!invoiceData.patientId || !invoiceData.patientInfo)) {
        console.log('📞 Fetching appointment to get patient info:', invoiceData.appointmentId);
        const appointment = await this.rpcClient.call('appointment-service', 'getAppointmentById', {
          id: invoiceData.appointmentId
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
      } else if (invoiceData.appointmentId) {
        console.log('✅ Skipping appointment validation - patient info already available');
      }

      // Generate invoice number
      invoiceData.invoiceNumber = await this.generateInvoiceNumber();

      // Set default values
      // 🔥 FIX: Ensure userId is always an ObjectId
      if (typeof userId === 'string' && userId !== 'system') {
        try {
          invoiceData.createdBy = new mongoose.Types.ObjectId(userId);
        } catch (e) {
          invoiceData.createdBy = invoiceData.dentistInfo?.dentistId || new mongoose.Types.ObjectId();
        }
      } else if (mongoose.Types.ObjectId.isValid(userId)) {
        invoiceData.createdBy = userId;
      } else {
        invoiceData.createdBy = invoiceData.dentistInfo?.dentistId || new mongoose.Types.ObjectId();
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
        // 🔥 CRITICAL: Don't overwrite totalAmount if already explicitly set (from payment with deposit)
        // 🔥 NEW: Use invoiceData.subtotal if set (includes deposit add-back for display)
        const updateData = {
          subtotal: invoiceData.subtotal !== undefined ? invoiceData.subtotal : subtotalAmount
        };
        
        // Check if totalAmount was explicitly set (e.g., from payment with deposit)
        // invoiceData.totalAmount will be set when creating invoice from payment
        const totalAmountExplicitlySet = invoiceData.hasOwnProperty('totalAmount') && 
                                         invoiceData.totalAmount !== undefined && 
                                         invoiceData.totalAmount !== null;
        
        if (totalAmountExplicitlySet) {
          // Keep the explicitly set totalAmount (from payment)
          updateData.totalAmount = invoiceData.totalAmount;
          console.log('💰 Keeping explicit totalAmount:', invoiceData.totalAmount, '(from payment, subtotal:', subtotalAmount, ')');
        } else {
          // Calculate totalAmount from subtotal (normal invoice creation)
          updateData.totalAmount = subtotalAmount + (invoice.taxInfo?.taxAmount || 0) - (invoice.discountInfo?.discountAmount || 0);
          console.log('💰 Calculated totalAmount:', updateData.totalAmount);
        }
        
        const updatedInvoice = await invoiceRepo.update(invoice._id, updateData);
        
        console.log('💰 Updated invoice with subtotal:', subtotalAmount);
        
        // Clear cache
        await this.clearInvoiceCache();

        console.log("✅ Invoice created:", updatedInvoice);
        return updatedInvoice;
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
            // console.log(`📋 [Invoice Service] Invoice ${invoice.invoiceNumber} has ${details.length} details`);
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

  async createInvoiceFromPayment(paymentIdOrData) {
    try {
      // 🔥 FIX: Support both paymentId (string) and paymentData (object)
      let paymentData;
      if (typeof paymentIdOrData === 'string') {
        console.log('📞 Fetching payment by ID:', paymentIdOrData);
        paymentData = await this.rpcClient.callPaymentService('getPaymentById', {
          id: paymentIdOrData
        });
        if (!paymentData) {
          throw new Error(`Payment not found: ${paymentIdOrData}`);
        }
      } else {
        paymentData = paymentIdOrData;
      }

      // Only create invoice if payment is successful
      if (paymentData.status !== 'completed') {
        throw new Error('Chỉ tạo hóa đơn khi thanh toán thành công');
      }

      console.log('📝 Creating invoice from payment:', paymentData._id);

      // 🔥 FIX: Calculate deposit FIRST (before creating invoice details)
      const originalAmount = paymentData.originalAmount || 0;
      const paidAmount = paymentData.paidAmount || paymentData.amount || 0;
      const depositAmount = paymentData.depositAmount || Math.max(0, originalAmount - paidAmount);
      
      console.log('💰 Deposit calculation:');
      console.log('  - Payment originalAmount:', originalAmount.toLocaleString());
      console.log('  - Payment paidAmount:', paidAmount.toLocaleString());
      console.log('  - Detected depositAmount:', depositAmount.toLocaleString());
      
      // 🔥 FIX: Get services from record if recordId exists
      let invoiceDetails = [];
      if (paymentData.recordId) {
        try {
          console.log('📋 Fetching record:', paymentData.recordId);
          const record = await this.rpcClient.call('record-service', 'getRecordById', {
            id: paymentData.recordId
          });

          if (record) {
            // 🔥 DEBUG: Log full record data to understand pricing
            console.log('📋 [DEBUG] Record data for invoice:', JSON.stringify({
              recordId: record._id,
              recordCode: record.recordCode,
              serviceName: record.serviceName,
              serviceAddOnId: record.serviceAddOnId,
              serviceAddOnName: record.serviceAddOnName,
              servicePrice: record.servicePrice,
              serviceAddOnPrice: record.serviceAddOnPrice,
              quantity: record.quantity,
              totalCost: record.totalCost,
              depositPaid: record.depositPaid,
              additionalServices: record.additionalServices?.map(s => ({
                serviceName: s.serviceName,
                serviceAddOnId: s.serviceAddOnId,
                serviceAddOnName: s.serviceAddOnName,
                price: s.price,
                quantity: s.quantity,
                totalPrice: s.totalPrice
              })) || []
            }, null, 2));
            
            // 🔥 FIX: Add MAIN service first (serviceId + serviceAddOn)
            if (record.serviceId && record.serviceName) {
              // 🔥 IMPORTANT: Service chính không có giá, chỉ serviceAddOn mới có giá!
              // servicePrice là giá cơ bản (không dùng), serviceAddOnPrice là giá thực tế
              let mainServicePrice = record.serviceAddOnPrice || 0; // CHỈ lấy serviceAddOnPrice
              
              // 🔥 NEW: Subtract deposit from main service price
              // Deposit is only applied to the FIRST service (main service)
              if (depositAmount > 0) {
                mainServicePrice = Math.max(0, mainServicePrice - depositAmount);
                console.log(`💰 Applying deposit: ${record.serviceAddOnPrice} - ${depositAmount} = ${mainServicePrice}`);
              }
              
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
                discountAmount: depositAmount, // 🔥 NEW: Show deposit as discount on main service
                totalPrice: mainServiceSubtotal,
                notes: depositAmount > 0 
                  ? `Dịch vụ chính: ${record.serviceName}${record.serviceAddOnName ? ' - ' + record.serviceAddOnName : ''} (Đã trừ cọc ${depositAmount.toLocaleString('vi-VN')}đ)`
                  : `Dịch vụ chính: ${record.serviceName}${record.serviceAddOnName ? ' - ' + record.serviceAddOnName : ''}`,
                status: 'completed'
                // 🔥 FIX: Don't set createdBy here, it will be set later
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
                  status: 'completed'
                  // 🔥 FIX: Don't set createdBy here, it will be set later
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

      // 🔥 FIX: Calculate subtotal from invoice details (after deposit deduction in main service)
      const subtotalFromDetails = invoiceDetails.reduce((sum, detail) => sum + (detail.totalPrice || 0), 0);
      
      // 🔥 IMPORTANT: 
      // - invoiceSubtotal = original amount (before deposit) for display
      // - invoiceTotalAmount = after deposit deduction (what customer actually pays)
      const invoiceSubtotal = subtotalFromDetails + depositAmount; // Add back deposit for display
      const invoiceTotalAmount = subtotalFromDetails; // Actual payment amount

      console.log('💰 Final invoice calculation:');
      console.log('  - Subtotal (before deposit):', invoiceSubtotal.toLocaleString());
      console.log('  - Deposit amount:', depositAmount.toLocaleString());
      console.log('  - Total amount (after deposit):', invoiceTotalAmount.toLocaleString());

      const invoiceData = {
        appointmentId: paymentData.appointmentId,
        patientId: paymentData.patientId,
        patientInfo: paymentData.patientInfo, // 🔥 FIX: Add patientInfo to skip appointment validation
        recordId: paymentData.recordId, // 🆕 Link to record
        type: InvoiceType.APPOINTMENT,
        status: InvoiceStatus.PAID,
        totalAmount: invoiceTotalAmount, // 🔥 FIX: = paidAmount (actual payment)
        subtotal: invoiceSubtotal, // 🔥 Total services before deposit deduction
        paidDate: new Date(),
        dentistInfo: dentistInfo, // 🔥 FIX: Add required dentistInfo
        createdByRole: 'system', // 🔥 FIX: Add required createdByRole
        paymentSummary: {
          totalPaid: paidAmount, // 🔥 Actual amount paid in this transaction
          remainingAmount: 0,
          paymentIds: [paymentData._id],
          lastPaymentDate: new Date(),
          paymentMethod: paymentData.paymentMethod
        },
        details: invoiceDetails, // 🔥 FIX: Add invoice details from record
        notes: depositAmount > 0 
          ? `Hóa đơn tự động tạo từ thanh toán ${paymentData._id}. Đã trừ cọc ${depositAmount.toLocaleString('vi-VN')}đ`
          : `Hóa đơn tự động tạo từ thanh toán ${paymentData._id}`
      };

      console.log('💰 Creating invoice with', invoiceDetails.length, 'service details');
      
      // 🔥 FIX: Use dentistInfo.dentistId or payment.processedBy as createdBy (must be ObjectId)
      const createdBy = dentistInfo?.dentistId || paymentData.processedBy || new mongoose.Types.ObjectId();
      
      return await this.createInvoice(invoiceData, createdBy);
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

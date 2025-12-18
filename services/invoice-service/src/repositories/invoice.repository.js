const { Invoice, InvoiceStatus } = require("../models/invoice.model");

class InvoiceRepository {
  // ============ CÁC PHƯƠNG THỨC TẠO ============
  async create(invoiceData) {
    const invoice = new Invoice(invoiceData);
    return await invoice.save();
  }

  async createDraftInvoice(invoiceData) {
    const draftData = {
      ...invoiceData,
      status: InvoiceStatus.DRAFT
    };
    return await this.create(draftData);
  }

  // ============ CÁC PHƯƠNG THỨC ĐỌC ============
  async findById(id) {
    return await Invoice.findById(id);
  }

  async findOne(filter) {
    return await Invoice.findOne(filter);
  }

  async findByInvoiceNumber(invoiceNumber) {
    return await Invoice.findByInvoiceNumber(invoiceNumber);
  }

  async findAll(filter = {}, options = {}) {
    const {
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const query = this.buildQuery(filter);

    const invoices = await Invoice.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Invoice.countDocuments(query);

    return {
      invoices,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async findByPatient(patientId, options = {}) {
    return await Invoice.findByPatient(patientId, options);
  }

  async findByAppointment(appointmentId) {
    return await Invoice.find({ appointmentId, isActive: true }).sort({ createdAt: -1 });
  }

  async findByPhone(phone, options = {}) {
    const filter = { 'patientInfo.phone': phone, isActive: true };
    if (options.status) filter.status = options.status;

    let query = Invoice.find(filter).sort({ createdAt: -1 });
    if (options.limit) {
      query = query.limit(options.limit);
    }

    return await query;
  }

  async findPendingInvoices(limit = 50) {
    return await Invoice.find({
      status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL_PAID] },
      isActive: true
    })
      .sort({ dueDate: 1 })
      .limit(limit);
  }

  async findOverdueInvoices() {
    return await Invoice.findOverdue();
  }

  async findDraftInvoices(limit = 100) {
    return await Invoice.find({
      status: InvoiceStatus.DRAFT,
      isActive: true
    })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async findTodayInvoices() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await Invoice.find({
      issueDate: { $gte: today, $lt: tomorrow },
      isActive: true
    }).sort({ createdAt: -1 });
  }

  async findByDateRange(startDate, endDate, options = {}) {
    const query = {
      issueDate: { $gte: startDate, $lte: endDate },
      isActive: true
    };

    if (options.status) {
      query.status = options.status;
    }

    return await Invoice.find(query).sort({ issueDate: -1 });
  }

  // ============ CÁC PHƯƠNG THỨC CẬP NHẬT ============
  async update(id, updateData) {
    return await Invoice.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updateStatus(id, status, additionalData = {}) {
    const updateData = { status, ...additionalData };

    // Thêm timestamps cho các thay đổi trạng thái cụ thể
    switch (status) {
      case InvoiceStatus.PAID:
        updateData.paidDate = new Date();
        break;
      case InvoiceStatus.CANCELLED:
        updateData.cancelledAt = new Date();
        break;
    }

    return await this.update(id, updateData);
  }

  // ============ CÁC PHƯƠNG THỨC TÍCH HỢP THANH TOÁN ============
  async markAsPaid(id, paymentInfo) {
    const updateData = {
      status: InvoiceStatus.PAID,
      paidDate: new Date(),
      'paymentSummary.totalPaid': paymentInfo.amount,
      'paymentSummary.remainingAmount': 0,
      'paymentSummary.lastPaymentDate': new Date(),
      'paymentSummary.paymentMethod': paymentInfo.method
    };

    if (paymentInfo.paymentId) {
      updateData.$push = {
        'paymentSummary.paymentIds': paymentInfo.paymentId
      };
    }

    return await Invoice.findByIdAndUpdate(id, updateData, { new: true });
  }

  async addPaymentToInvoice(invoiceId, paymentInfo) {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      throw new Error('Không tìm thấy hóa đơn');
    }

    // Thêm thanh toán vào hóa đơn
    invoice.addPayment(paymentInfo.paymentId, paymentInfo.amount, paymentInfo.method);
    return await invoice.save();
  }

  async updatePaymentSummary(id, paymentSummary) {
    return await this.update(id, { paymentSummary });
  }

  // ============ CÁC PHƯƠNG THỨC NGHIỆP VỤ ============
  async convertDraftToPending(id, finalizeData = {}) {
    const invoice = await Invoice.findById(id);
    if (!invoice || invoice.status !== InvoiceStatus.DRAFT) {
      throw new Error('Chỉ có thể chuyển hóa đơn nháp sang chờ xử lý');
    }

    const updateData = {
      status: InvoiceStatus.PENDING,
      issueDate: new Date(),
      ...finalizeData
    };

    return await this.update(id, updateData);
  }

  async cancelInvoice(id, cancelReason, cancelledBy) {
    const invoice = await Invoice.findById(id);
    if (!invoice || !invoice.canBeCancelled()) {
      throw new Error('Không thể hủy hóa đơn này');
    }

    return await this.updateStatus(id, InvoiceStatus.CANCELLED, {
      cancelReason,
      cancelledBy,
      cancelledAt: new Date()
    });
  }

  // ============ CÁC PHƯƠNG THỨC TÌM KIẾM & LỌC ============
  async search(searchTerm, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const searchRegex = new RegExp(searchTerm, 'i');

    const filter = {
      isActive: true,
      $or: [
        { invoiceNumber: searchRegex },
        { 'patientInfo.name': searchRegex },
        { 'patientInfo.phone': searchRegex },
        { 'patientInfo.email': searchRegex },
        { description: searchRegex },
        { notes: searchRegex }
      ]
    };

    const invoices = await Invoice.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Invoice.countDocuments(filter);

    return {
      invoices,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  // ============ CÁC PHƯƠNG THỨC THỐNG KÊ ============
  async getInvoiceStatistics(startDate, endDate, groupBy = 'day') {
    const matchStage = {
      issueDate: { $gte: startDate, $lte: endDate },
      isActive: true,
      status: { $ne: InvoiceStatus.CANCELLED }
    };

    let groupStage = {};

    switch (groupBy) {
      case 'day':
        groupStage = {
          _id: {
            year: { $year: '$issueDate' },
            month: { $month: '$issueDate' },
            day: { $dayOfMonth: '$issueDate' }
          }
        };
        break;
      case 'month':
        groupStage = {
          _id: {
            year: { $year: '$issueDate' },
            month: { $month: '$issueDate' }
          }
        };
        break;
      case 'status':
        groupStage = {
          _id: '$status'
        };
        break;
      default:
        groupStage = { _id: null };
    }

    groupStage.totalAmount = { $sum: '$totalAmount' };
    groupStage.totalCount = { $sum: 1 };
    groupStage.avgAmount = { $avg: '$totalAmount' };
    groupStage.paidAmount = {
      $sum: {
        $cond: [{ $eq: ['$status', InvoiceStatus.PAID] }, '$totalAmount', 0]
      }
    };

    const stats = await Invoice.aggregate([
      { $match: matchStage },
      { $group: groupStage },
      { $sort: { '_id': 1 } }
    ]);

    return stats;
  }

  async getRevenueStats(startDate, endDate, groupBy = 'day', dentistId = null, serviceId = null) {
    const InvoiceDetailRepo = require('./invoiceDetail.repository');
    const { getServiceAddOnIds } = require('../utils/serviceHelper');
    
    // 🔥 SỬa: Không truyền date filter vào filters nữa, vì các hàm thống kê đã tự filter theo createdAt
    // Chỉ truyền các filter bổ sung như dentistId, serviceId
    const filters = {};
    
    if (dentistId) {
      const mongoose = require('mongoose');
      filters.dentistId = mongoose.Types.ObjectId.isValid(dentistId) 
        ? new mongoose.Types.ObjectId(dentistId) 
        : dentistId;
    }
    
    // 🆕 Nếu có serviceId, lấy tất cả serviceAddOn IDs và lọc theo chúng
    if (serviceId) {
      const serviceInfo = await getServiceAddOnIds(serviceId);
      
      if (serviceInfo.hasAddOns && serviceInfo.addOns.length > 0) {
        // Lọc theo các serviceAddOn IDs (lưu như serviceId trong InvoiceDetail)
        const mongoose = require('mongoose');
        const addOnIds = serviceInfo.addOns
          .map(addon => addon._id)
          .filter(id => id && mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
        
        if (addOnIds.length > 0) {
          filters.serviceId = { $in: addOnIds };
          console.log(`🔍 Lọc theo ${addOnIds.length} serviceAddOns của dịch vụ cha ${serviceId}`);
        } else {
          // Không có addOn IDs hợp lệ, lọc theo parent serviceId
          filters.serviceId = mongoose.Types.ObjectId.isValid(serviceId) 
            ? new mongoose.Types.ObjectId(serviceId) 
            : serviceId;
        }
      } else {
        // Không có addOns hoặc lỗi, lọc trực tiếp theo parent serviceId
        const mongoose = require('mongoose');
        filters.serviceId = mongoose.Types.ObjectId.isValid(serviceId) 
          ? new mongoose.Types.ObjectId(serviceId) 
          : serviceId;
      }
    }

    // Lấy summary, trends, byDentist, byService, và rawDetails song song
    const [summary, trends, byDentist, byService, rawDetails] = await Promise.all([
      InvoiceDetailRepo.getRevenueSummary(startDate, endDate, filters),
      InvoiceDetailRepo.getRevenueTrends(startDate, endDate, groupBy, filters),
      InvoiceDetailRepo.getRevenueByDentist(startDate, endDate, filters),
      InvoiceDetailRepo.getRevenueByService(startDate, endDate, filters),
      // ✅ Thêm raw details có cả dentistId và serviceId để FE lọc chéo
      InvoiceDetailRepo.getRawRevenueDetails(startDate, endDate, filters)
    ]);

    // 🔥 SỬa: Nếu byDentist rỗng nhưng có doanh thu, cần enrich dentistId từ record
    let enrichedByDentist = byDentist;
    let enrichedRawDetails = rawDetails;
    
    if (byDentist.length === 0 && summary && summary.totalRevenue > 0) {
      console.log('⚠️ byDentist rỗng nhưng có doanh thu, cần enrich từ record...');
      
      try {
        // Lấy tất cả invoices trong khoảng thời gian có recordId
        const invoicesWithRecords = await Invoice.find({
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $in: ['completed', 'paid'] },
          isActive: true,
          recordId: { $exists: true, $ne: null }
        }).select('_id recordId totalAmount').lean();
        
        console.log(`📋 Tìm thấy ${invoicesWithRecords.length} invoices có recordId`);
        
        // 🔥 DEBUG: Log chi tiết invoices và recordIds
        invoicesWithRecords.forEach(inv => {
          console.log(`   - Invoice ${inv._id}: recordId=${inv.recordId} (type: ${typeof inv.recordId})`);
        });
        
        if (invoicesWithRecords.length > 0) {
          // Lấy danh sách recordIds
          const recordIds = invoicesWithRecords.map(inv => inv.recordId.toString());
          
          // Call RPC để lấy records với dentistId
          const rpcClient = require('../config/rpc.config'); // 🔥 SỬa: Dùng đúng path và singleton
          
          // Đảm bảo RPC client đã kết nối
          if (!rpcClient.isConnected) {
            await rpcClient.connect();
          }
          
          const records = await rpcClient.call('record-service', 'getRecordsByIds', {
            ids: recordIds
          });
          
          console.log(`📋 Lấy được ${records?.length || 0} records từ record-service`);
          
          if (records && records.length > 0) {
            // Tạo map recordId -> dentistId, dentistName
            const recordMap = new Map();
            records.forEach(record => {
              if (record && record._id && record.dentistId) {
                recordMap.set(record._id.toString(), {
                  dentistId: record.dentistId.toString(),
                  dentistName: record.dentistName || 'Nha sĩ'
                });
              }
            });
            
            // Tạo map invoiceId -> dentistId
            const invoiceDentistMap = new Map();
            invoicesWithRecords.forEach(inv => {
              const recordInfo = recordMap.get(inv.recordId.toString());
              if (recordInfo) {
                invoiceDentistMap.set(inv._id.toString(), recordInfo);
              }
            });
            
            // Aggregate theo dentistId từ records
            const dentistRevenueMap = new Map();
            
            // Lấy invoice details để tính doanh thu
            const InvoiceDetail = require('../models/invoiceDetail.model');
            const invoiceIds = invoicesWithRecords.map(inv => inv._id);
            
            const invoiceDetails = await InvoiceDetail.find({
              invoiceId: { $in: invoiceIds },
              status: 'completed',
              isActive: true,
              createdAt: { $gte: startDate, $lte: endDate }
            }).lean();
            
            invoiceDetails.forEach(detail => {
              const dentistInfo = invoiceDentistMap.get(detail.invoiceId.toString());
              if (dentistInfo) {
                const { dentistId } = dentistInfo;
                if (!dentistRevenueMap.has(dentistId)) {
                  dentistRevenueMap.set(dentistId, {
                    dentistId,
                    totalRevenue: 0,
                    appointmentSet: new Set(),
                    serviceCount: 0
                  });
                }
                const dentistData = dentistRevenueMap.get(dentistId);
                dentistData.totalRevenue += detail.totalPrice || 0;
                dentistData.appointmentSet.add(detail.invoiceId.toString());
                dentistData.serviceCount += 1;
              }
            });
            
            // Convert to array format
            enrichedByDentist = Array.from(dentistRevenueMap.values()).map(d => ({
              dentistId: d.dentistId,
              totalRevenue: d.totalRevenue,
              appointmentCount: d.appointmentSet.size,
              serviceCount: d.serviceCount,
              avgRevenuePerAppointment: d.appointmentSet.size > 0 
                ? Math.floor(d.totalRevenue / d.appointmentSet.size) 
                : 0
            }));
            
            // Enrich rawDetails
            const rawDetailsMap = new Map();
            invoiceDetails.forEach(detail => {
              const dentistInfo = invoiceDentistMap.get(detail.invoiceId.toString());
              if (dentistInfo) {
                const key = `${dentistInfo.dentistId}_${detail.serviceId?.toString() || 'unknown'}`;
                if (!rawDetailsMap.has(key)) {
                  rawDetailsMap.set(key, {
                    dentistId: dentistInfo.dentistId,
                    serviceId: detail.serviceId?.toString() || null,
                    revenue: 0,
                    count: 0,
                    invoiceSet: new Set()
                  });
                }
                const rawData = rawDetailsMap.get(key);
                rawData.revenue += detail.totalPrice || 0;
                rawData.count += detail.quantity || 1;
                rawData.invoiceSet.add(detail.invoiceId.toString());
              }
            });
            
            enrichedRawDetails = Array.from(rawDetailsMap.values()).map(r => ({
              dentistId: r.dentistId,
              serviceId: r.serviceId,
              revenue: r.revenue,
              count: r.count,
              invoiceCount: r.invoiceSet.size
            }));
            
            console.log(`✅ Enriched: ${enrichedByDentist.length} dentists, ${enrichedRawDetails.length} rawDetails`);
          }
        }
      } catch (error) {
        console.error('❌ Error enriching dentistId from records:', error.message);
        // Fallback to original empty arrays
      }
    }

    console.log('✅ getRevenueStats trả về:', {
      hasRawDetails: !!enrichedRawDetails,
      rawDetailsLength: enrichedRawDetails?.length,
      byDentistLength: enrichedByDentist?.length,
      byServiceLength: byService?.length
    });

    return {
      period: {
        startDate,
        endDate,
        groupBy
      },
      summary,
      trends,
      byDentist: enrichedByDentist,
      byService,
      rawDetails: enrichedRawDetails // ✅ Mảng các { dentistId, serviceId, revenue, count }
    };
  }

  // ============ CÁC PHƯƠNG THỨC XÓA ============
  async softDelete(id, deletedBy) {
    return await this.update(id, {
      isActive: false,
      deletedBy,
      deletedAt: new Date()
    });
  }

  async permanentDelete(id) {
    return await Invoice.findByIdAndDelete(id);
  }

  // ============ CÁC PHƯƠNG THỨC HỖ TRỢ ============
  buildQuery(filter) {
    const query = { isActive: true };

    // Tìm kiếm theo từ khóa
    if (filter.keyword && filter.keyword.trim()) {
      const searchRegex = new RegExp(filter.keyword.trim(), 'i');
      query.$or = [
        { invoiceNumber: searchRegex },
        { 'patientInfo.name': searchRegex },
        { 'patientInfo.phone': searchRegex },
        { 'patientInfo.email': searchRegex }
      ];
    }

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        query.status = { $in: filter.status };
      } else {
        query.status = filter.status;
      }
    }

    if (filter.patientId) {
      query.patientId = filter.patientId;
    }

    if (filter.appointmentId) {
      query.appointmentId = filter.appointmentId;
    }

    if (filter.type) {
      query.type = filter.type;
    }

    // Lọc theo ngày
    if (filter.dateFrom || filter.dateTo) {
      query.issueDate = {};
      if (filter.dateFrom) {
        const startDate = new Date(filter.dateFrom);
        startDate.setHours(0, 0, 0, 0);
        query.issueDate.$gte = startDate;
      }
      if (filter.dateTo) {
        const endDate = new Date(filter.dateTo);
        endDate.setHours(23, 59, 59, 999);
        query.issueDate.$lte = endDate;
      }
    }

    // Lọc theo ngày đến hạn
    if (filter.dueDateFrom || filter.dueDateTo) {
      query.dueDate = {};
      if (filter.dueDateFrom) {
        query.dueDate.$gte = new Date(filter.dueDateFrom);
      }
      if (filter.dueDateTo) {
        query.dueDate.$lte = new Date(filter.dueDateTo);
      }
    }

    // Lọc theo số tiền
    if (filter.minAmount) {
      query.totalAmount = { $gte: filter.minAmount };
    }
    if (filter.maxAmount) {
      query.totalAmount = { ...query.totalAmount, $lte: filter.maxAmount };
    }

    // Tìm theo số điện thoại
    if (filter.phone) {
      query['patientInfo.phone'] = new RegExp(filter.phone, 'i');
    }

    // Tìm theo tên bệnh nhân
    if (filter.patientName) {
      query['patientInfo.name'] = new RegExp(filter.patientName, 'i');
    }

    // Tìm các hóa đơn quá hạn
    if (filter.overdue === true) {
      query.dueDate = { $lt: new Date() };
      query.status = { $in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL_PAID] };
    }

    return query;
  }

  // ============ CÁC PHƯƠNG THỨC HỖ TRỢ CHO CONSUMER ============
  
  /**
   * Đếm số hóa đơn tạo trong ngày hôm nay
   * Dùng để tạo số thứ tự hóa đơn
   */
  async countInvoicesToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    
    return await Invoice.countDocuments({
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });
  }

  /**
   * Tạo hóa đơn từ sự kiện consumer
   */
  async createInvoice(invoiceData) {
    return await this.create(invoiceData);
  }

  /**
   * Cập nhật appointmentId sau khi tạo cuộc hẹn
   */
  async updateAppointmentId(invoiceId, appointmentId) {
    return await Invoice.findByIdAndUpdate(
      invoiceId,
      { appointmentId },
      { new: true }
    );
  }
}

module.exports = new InvoiceRepository();

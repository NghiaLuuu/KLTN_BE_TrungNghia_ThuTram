const { Invoice, InvoiceStatus } = require("../models/invoice.model");

class InvoiceRepository {
  // ============ CREATE METHODS ============
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

  // ============ READ METHODS ============
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

  // ============ UPDATE METHODS ============
  async update(id, updateData) {
    return await Invoice.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updateStatus(id, status, additionalData = {}) {
    const updateData = { status, ...additionalData };

    // Add timestamps for specific status changes
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

  // ============ PAYMENT INTEGRATION METHODS ============
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
      throw new Error('Invoice not found');
    }

    // Add payment to invoice
    invoice.addPayment(paymentInfo.paymentId, paymentInfo.amount, paymentInfo.method);
    return await invoice.save();
  }

  async updatePaymentSummary(id, paymentSummary) {
    return await this.update(id, { paymentSummary });
  }

  // ============ BUSINESS LOGIC METHODS ============
  async convertDraftToPending(id, finalizeData = {}) {
    const invoice = await Invoice.findById(id);
    if (!invoice || invoice.status !== InvoiceStatus.DRAFT) {
      throw new Error('Only draft invoices can be converted to pending');
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
      throw new Error('Invoice cannot be cancelled');
    }

    return await this.updateStatus(id, InvoiceStatus.CANCELLED, {
      cancelReason,
      cancelledBy,
      cancelledAt: new Date()
    });
  }

  // ============ SEARCH & FILTER METHODS ============
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

  // ============ STATISTICS METHODS ============
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

  async getRevenueStats(startDate, endDate) {
    const stats = await Invoice.aggregate([
      {
        $match: {
          issueDate: { $gte: startDate, $lte: endDate },
          isActive: true,
          status: { $ne: InvoiceStatus.CANCELLED }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $cond: [{ $eq: ['$status', InvoiceStatus.PAID] }, '$totalAmount', 0]
            }
          },
          pendingRevenue: {
            $sum: {
              $cond: [
                { $in: ['$status', [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL_PAID]] },
                '$totalAmount',
                0
              ]
            }
          },
          totalInvoices: { $sum: 1 },
          paidInvoices: {
            $sum: {
              $cond: [{ $eq: ['$status', InvoiceStatus.PAID] }, 1, 0]
            }
          },
          overdueInvoices: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ['$dueDate', new Date()] },
                    { $in: ['$status', [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL_PAID]] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    return stats[0] || {
      totalRevenue: 0,
      pendingRevenue: 0,
      totalInvoices: 0,
      paidInvoices: 0,
      overdueInvoices: 0
    };
  }

  // ============ DELETE METHODS ============
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

  // ============ HELPER METHODS ============
  buildQuery(filter) {
    const query = { isActive: true };

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

    // Date filters
    if (filter.dateFrom || filter.dateTo) {
      query.issueDate = {};
      if (filter.dateFrom) {
        query.issueDate.$gte = new Date(filter.dateFrom);
      }
      if (filter.dateTo) {
        query.issueDate.$lte = new Date(filter.dateTo);
      }
    }

    // Due date filters
    if (filter.dueDateFrom || filter.dueDateTo) {
      query.dueDate = {};
      if (filter.dueDateFrom) {
        query.dueDate.$gte = new Date(filter.dueDateFrom);
      }
      if (filter.dueDateTo) {
        query.dueDate.$lte = new Date(filter.dueDateTo);
      }
    }

    // Amount filters
    if (filter.minAmount) {
      query.totalAmount = { $gte: filter.minAmount };
    }
    if (filter.maxAmount) {
      query.totalAmount = { ...query.totalAmount, $lte: filter.maxAmount };
    }

    // Search by phone
    if (filter.phone) {
      query['patientInfo.phone'] = new RegExp(filter.phone, 'i');
    }

    // Search by patient name
    if (filter.patientName) {
      query['patientInfo.name'] = new RegExp(filter.patientName, 'i');
    }

    // Search overdue invoices
    if (filter.overdue === true) {
      query.dueDate = { $lt: new Date() };
      query.status = { $in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL_PAID] };
    }

    return query;
  }

  // ============ HELPER METHODS FOR CONSUMER ============
  
  /**
   * Count invoices created today
   * Used for generating invoice number sequence
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
   * Create invoice from consumer event
   */
  async createInvoice(invoiceData) {
    return await this.create(invoiceData);
  }

  /**
   * Update appointmentId after appointment creation
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

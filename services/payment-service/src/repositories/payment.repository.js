const { Payment } = require('../models/payment.model');

class PaymentRepository {
  async create(paymentData) {
    const payment = new Payment(paymentData);
    return await payment.save();
  }

  async findById(id) {
    return await Payment.findById(id);
  }

  async findByCode(code) {
    return await Payment.findByCode(code);
  }

  async findAll(filter = {}, options = {}) {
    const { 
      page = 1, 
      limit = 20, 
      sortBy = 'processedAt', 
      sortOrder = 'desc' 
    } = options;
    
    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    const query = this.buildQuery(filter);
    
    const payments = await Payment.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
      
    const total = await Payment.countDocuments(query);
    
    return {
      payments,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async findByPatient(patientId, options = {}) {
    return await Payment.findByPatient(patientId, options);
  }

  async findByPhone(phone, options = {}) {
    const filter = { 'patientInfo.phone': phone };
    if (options.status) filter.status = options.status;
    if (options.limit) {
      return await Payment.find(filter)
        .sort({ processedAt: -1 })
        .limit(options.limit);
    }
    return await Payment.find(filter).sort({ processedAt: -1 });
  }

  async findByAppointment(appointmentId) {
    return await Payment.find({ appointmentId }).sort({ processedAt: -1 });
  }

  async findByInvoice(invoiceId) {
    return await Payment.find({ invoiceId }).sort({ processedAt: -1 });
  }

  async findByRecord(recordId) {
    return await Payment.find({ recordId }).sort({ processedAt: -1 });
  }

  async findByDateRange(startDate, endDate, options = {}) {
    return await Payment.findByDateRange(startDate, endDate, options);
  }

  async findTodayPayments() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return await Payment.find({
      processedAt: { $gte: today, $lt: tomorrow },
      status: 'completed'
    }).sort({ processedAt: -1 });
  }

  async findPending(limit = 50) {
    return await Payment.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async findProcessing() {
    return await Payment.find({ status: 'processing' })
      .sort({ createdAt: 1 });
  }

  async findFailed(limit = 100) {
    return await Payment.find({ status: 'failed' })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async findByMethod(method, options = {}) {
    const filter = { method };
    if (options.status) filter.status = options.status;
    if (options.fromDate) filter.processedAt = { $gte: options.fromDate };
    if (options.toDate) filter.processedAt = { ...filter.processedAt, $lte: options.toDate };

    return await Payment.find(filter).sort({ processedAt: -1 });
  }

  async findRefunds(originalPaymentId = null) {
    const filter = { type: 'refund' };
    if (originalPaymentId) {
      filter.originalPaymentId = originalPaymentId;
    }
    return await Payment.find(filter).sort({ processedAt: -1 });
  }

  async update(id, updateData) {
    return await Payment.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updateStatus(id, status, additionalData = {}) {
    const updateData = { status, ...additionalData };
    
    // Thêm timestamp cho các thay đổi trạng thái cụ thể
    switch (status) {
      case 'completed':
        updateData.completedAt = new Date();
        break;
      case 'cancelled':
        updateData.cancelledAt = new Date();
        break;
      case 'refunded':
        updateData.refundedAt = new Date();
        break;
    }

    return await this.update(id, updateData);
  }

  async processPayment(id, gatewayResponse) {
    return await this.update(id, {
      status: 'completed',
      gatewayResponse,
      completedAt: new Date()
    });
  }

  async failPayment(id, reason) {
    return await this.update(id, {
      status: 'failed',
      gatewayResponse: {
        responseCode: 'FAILED',
        responseMessage: reason
      }
    });
  }

  async verify(id, verifiedBy) {
    return await this.update(id, {
      isVerified: true,
      verifiedBy,
      verifiedAt: new Date()
    });
  }

  async delete(id) {
    return await Payment.findByIdAndDelete(id);
  }

  async search(searchTerm, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const searchRegex = new RegExp(searchTerm, 'i');
    
    const filter = {
      $or: [
        { paymentCode: searchRegex },
        { 'patientInfo.name': searchRegex },
        { 'patientInfo.phone': searchRegex },
        { 'patientInfo.email': searchRegex },
        { description: searchRegex },
        { externalTransactionId: searchRegex }
      ]
    };

    const payments = await Payment.find(filter)
      .sort({ processedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
      
    const total = await Payment.countDocuments(filter);
    
    return {
      payments,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async getStatistics(startDate, endDate, groupBy = 'day') {
    const matchStage = {
      processedAt: { $gte: startDate, $lte: endDate },
      status: 'completed'
    };

    let groupStage = {};
    
    switch (groupBy) {
      case 'day':
        groupStage = {
          _id: {
            year: { $year: '$processedAt' },
            month: { $month: '$processedAt' },
            day: { $dayOfMonth: '$processedAt' }
          }
        };
        break;
      case 'month':
        groupStage = {
          _id: {
            year: { $year: '$processedAt' },
            month: { $month: '$processedAt' }
          }
        };
        break;
      case 'method':
        groupStage = {
          _id: '$method'
        };
        break;
      default:
        groupStage = { _id: null };
    }

    groupStage.totalAmount = { $sum: '$finalAmount' };
    groupStage.totalCount = { $sum: 1 };
    groupStage.avgAmount = { $avg: '$finalAmount' };

    const stats = await Payment.aggregate([
      { $match: matchStage },
      { $group: groupStage },
      { $sort: { '_id': 1 } }
    ]);

    return stats;
  }

  async getRevenueStats(startDate, endDate) {
    const stats = await Payment.aggregate([
      {
        $match: {
          processedAt: { $gte: startDate, $lte: endDate },
          status: 'completed',
          type: { $in: ['payment', 'deposit'] }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$finalAmount' },
          totalTransactions: { $sum: 1 },
          avgTransaction: { $avg: '$finalAmount' },
          cashPayments: {
            $sum: { $cond: [{ $eq: ['$method', 'cash'] }, '$finalAmount', 0] }
          },
          cardPayments: {
            $sum: { 
              $cond: [
                { $in: ['$method', ['credit_card', 'debit_card']] }, 
                '$finalAmount', 
                0
              ] 
            }
          },
          digitalPayments: {
            $sum: { 
              $cond: [
                { $eq: ['$method', 'vnpay'] }, 
                '$finalAmount', 
                0
              ] 
            }
          }
        }
      }
    ]);

    return stats[0] || {
      totalRevenue: 0,
      totalTransactions: 0,
      avgTransaction: 0,
      cashPayments: 0,
      cardPayments: 0,
      digitalPayments: 0
    };
  }

  async getRefundStats(startDate, endDate) {
    const stats = await Payment.aggregate([
      {
        $match: {
          processedAt: { $gte: startDate, $lte: endDate },
          status: { $in: ['refunded', 'partial_refund'] }
        }
      },
      {
        $group: {
          _id: null,
          totalRefunded: { $sum: '$finalAmount' },
          totalRefunds: { $sum: 1 },
          avgRefund: { $avg: '$finalAmount' }
        }
      }
    ]);

    return stats[0] || {
      totalRefunded: 0,
      totalRefunds: 0,
      avgRefund: 0
    };
  }

  // Phương thức trợ giúp xây dựng các truy vấn phức tạp
  buildQuery(filter) {
    const query = {};

    // Tìm kiếm theo từ khóa
    if (filter.keyword && filter.keyword.trim()) {
      const searchRegex = new RegExp(filter.keyword.trim(), 'i');
      query.$or = [
        { paymentCode: searchRegex },
        { 'patientInfo.name': searchRegex },
        { 'patientInfo.phone': searchRegex },
        { 'patientInfo.email': searchRegex },
        { description: searchRegex }
      ];
    }

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        query.status = { $in: filter.status };
      } else {
        query.status = filter.status;
      }
    }

    if (filter.method) {
      if (Array.isArray(filter.method)) {
        query.method = { $in: filter.method };
      } else {
        query.method = filter.method;
      }
    }

    if (filter.type) {
      query.type = filter.type;
    }

    if (filter.patientId) {
      query.patientId = filter.patientId;
    }

    if (filter.appointmentId) {
      query.appointmentId = filter.appointmentId;
    }

    if (filter.invoiceId) {
      query.invoiceId = filter.invoiceId;
    }

    if (filter.recordId) {
      query.recordId = filter.recordId;
    }

    // Lọc theo ngày
    if (filter.dateFrom || filter.dateTo) {
      query.processedAt = {};
      if (filter.dateFrom) {
        const startDate = new Date(filter.dateFrom);
        startDate.setHours(0, 0, 0, 0);
        query.processedAt.$gte = startDate;
      }
      if (filter.dateTo) {
        const endDate = new Date(filter.dateTo);
        endDate.setHours(23, 59, 59, 999);
        query.processedAt.$lte = endDate;
      }
    }

    // Lọc theo số tiền
    if (filter.minAmount) {
      query.finalAmount = { $gte: filter.minAmount };
    }
    if (filter.maxAmount) {
      query.finalAmount = { ...query.finalAmount, $lte: filter.maxAmount };
    }

    // Tìm kiếm theo số điện thoại
    if (filter.phone) {
      query['patientInfo.phone'] = new RegExp(filter.phone, 'i');
    }

    // Tìm kiếm theo tên bệnh nhân
    if (filter.patientName) {
      query['patientInfo.name'] = new RegExp(filter.patientName, 'i');
    }

    // Trạng thái xác minh
    if (filter.isVerified !== undefined) {
      query.isVerified = filter.isVerified;
    }

    return query;
  }
}

module.exports = new PaymentRepository();

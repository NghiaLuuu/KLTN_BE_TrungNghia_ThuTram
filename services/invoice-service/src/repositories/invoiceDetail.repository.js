const { InvoiceDetail, ServiceType, ServiceCategory, ToothType } = require("../models/invoiceDetail.model");

class InvoiceDetailRepository {
  // ============ CREATE METHODS ============
  async create(detailData) {
    const detail = new InvoiceDetail(detailData);
    return await detail.save();
  }

  async createMultiple(detailsArray) {
    return await InvoiceDetail.insertMany(detailsArray);
  }

  // ============ READ METHODS ============
  async findById(id) {
    return await InvoiceDetail.findById(id);
  }

  async findByInvoice(invoiceId, options = {}) {
    let query = InvoiceDetail.find({ invoiceId, isActive: true });

    if (options.populateService) {
      query = query.populate('serviceId', 'name description');
    }

    if (options.sortBy) {
      const sort = { [options.sortBy]: options.sortOrder === 'desc' ? -1 : 1 };
      query = query.sort(sort);
    } else {
      query = query.sort({ createdAt: 1 });
    }

    return await query;
  }

  async findByService(serviceId, options = {}) {
    const filter = { serviceId, isActive: true };

    if (options.dateFrom || options.dateTo) {
      filter.createdAt = {};
      if (options.dateFrom) filter.createdAt.$gte = new Date(options.dateFrom);
      if (options.dateTo) filter.createdAt.$lte = new Date(options.dateTo);
    }

    let query = InvoiceDetail.find(filter);

    if (options.limit) {
      query = query.limit(options.limit);
    }

    return await query.sort({ createdAt: -1 });
  }

  async findByServiceType(serviceType, options = {}) {
    const filter = { serviceType, isActive: true };
    return await this.findWithFilter(filter, options);
  }

  async findByServiceCategory(serviceCategory, options = {}) {
    const filter = { serviceCategory, isActive: true };
    return await this.findWithFilter(filter, options);
  }

  async findByToothInfo(toothNumbers, options = {}) {
    const filter = {
      'toothInfo.toothNumbers': { $in: toothNumbers },
      isActive: true
    };
    return await this.findWithFilter(filter, options);
  }

  async findCompletedTreatments(invoiceId) {
    return await InvoiceDetail.find({
      invoiceId,
      'treatmentInfo.isCompleted': true,
      isActive: true
    }).sort({ 'treatmentInfo.completedAt': -1 });
  }

  async findPendingTreatments(invoiceId) {
    return await InvoiceDetail.find({
      invoiceId,
      'treatmentInfo.isCompleted': false,
      isActive: true
    }).sort({ createdAt: 1 });
  }

  async findTreatmentsWithFollowUp(invoiceId) {
    return await InvoiceDetail.find({
      invoiceId,
      'treatmentInfo.requiresFollowUp': true,
      isActive: true
    }).sort({ 'treatmentInfo.followUpDate': 1 });
  }

  // ============ UPDATE METHODS ============
  async update(id, updateData) {
    return await InvoiceDetail.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updateQuantity(id, quantity) {
    const detail = await InvoiceDetail.findById(id);
    if (!detail) {
      throw new Error('Invoice detail not found');
    }

    detail.quantity = quantity;
    detail.calculateAmounts();
    
    return await detail.save();
  }

  async updateUnitPrice(id, unitPrice) {
    const detail = await InvoiceDetail.findById(id);
    if (!detail) {
      throw new Error('Invoice detail not found');
    }

    detail.unitPrice = unitPrice;
    detail.calculateAmounts();
    
    return await detail.save();
  }

  async updateDiscount(id, discountInfo) {
    const detail = await InvoiceDetail.findById(id);
    if (!detail) {
      throw new Error('Invoice detail not found');
    }

    detail.discountInfo = { ...detail.discountInfo, ...discountInfo };
    detail.calculateAmounts();
    
    return await detail.save();
  }

  // ============ TREATMENT TRACKING METHODS ============
  async markTreatmentCompleted(id, completionData = {}) {
    const updateData = {
      'treatmentInfo.isCompleted': true,
      'treatmentInfo.completedAt': new Date(),
      'treatmentInfo.completedBy': completionData.completedBy,
      'treatmentInfo.completionNotes': completionData.notes
    };

    if (completionData.requiresFollowUp) {
      updateData['treatmentInfo.requiresFollowUp'] = true;
      updateData['treatmentInfo.followUpDate'] = completionData.followUpDate;
      updateData['treatmentInfo.followUpNotes'] = completionData.followUpNotes;
    }

    return await this.update(id, updateData);
  }

  async updateTreatmentProgress(id, progressData) {
    const updateData = {
      'treatmentInfo.progressNotes': progressData.notes,
      'treatmentInfo.progressPercentage': progressData.percentage,
      'treatmentInfo.nextAppointmentDate': progressData.nextAppointmentDate
    };

    return await this.update(id, updateData);
  }

  async addQualityRating(id, ratingData) {
    const updateData = {
      'qualityInfo.rating': ratingData.rating,
      'qualityInfo.ratedBy': ratingData.ratedBy,
      'qualityInfo.ratedAt': new Date(),
      'qualityInfo.ratingNotes': ratingData.notes
    };

    return await this.update(id, updateData);
  }

  // ============ BULK OPERATIONS ============
  async updateMultiple(invoiceId, updates) {
    const bulkOperations = updates.map(update => ({
      updateOne: {
        filter: { _id: update.id, invoiceId, isActive: true },
        update: { $set: update.data }
      }
    }));

    return await InvoiceDetail.bulkWrite(bulkOperations);
  }

  async deleteMultiple(ids) {
    return await InvoiceDetail.updateMany(
      { _id: { $in: ids } },
      { $set: { isActive: false, deletedAt: new Date() } }
    );
  }

  // ============ DENTAL-SPECIFIC METHODS ============
  async findByToothNumber(toothNumber, options = {}) {
    const filter = {
      'toothInfo.toothNumbers': toothNumber,
      isActive: true
    };

    if (options.treatmentType) {
      filter.serviceType = options.treatmentType;
    }

    return await InvoiceDetail.find(filter).sort({ createdAt: -1 });
  }

  async findToothTreatmentHistory(toothNumber, patientId) {
    // This would need to join with invoice to get patient info
    return await InvoiceDetail.aggregate([
      {
        $match: {
          'toothInfo.toothNumbers': toothNumber,
          isActive: true
        }
      },
      {
        $lookup: {
          from: 'invoices',
          localField: 'invoiceId',
          foreignField: '_id',
          as: 'invoice'
        }
      },
      {
        $unwind: '$invoice'
      },
      {
        $match: {
          'invoice.patientId': patientId
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ]);
  }

  async updateToothCondition(id, conditionData) {
    const updateData = {
      'toothInfo.condition': conditionData.condition,
      'toothInfo.notes': conditionData.notes,
      'toothInfo.updatedAt': new Date()
    };

    return await this.update(id, updateData);
  }

  // ============ STATISTICS METHODS ============
  async getServiceStatistics(startDate, endDate) {
    return await InvoiceDetail.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          isActive: true
        }
      },
      {
        $group: {
          _id: {
            serviceType: '$serviceType',
            serviceCategory: '$serviceCategory'
          },
          totalQuantity: { $sum: '$quantity' },
          totalAmount: { $sum: '$totalAmount' },
          averagePrice: { $avg: '$unitPrice' },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { totalAmount: -1 }
      }
    ]);
  }

  async getPopularServices(limit = 10) {
    return await InvoiceDetail.aggregate([
      {
        $match: { isActive: true }
      },
      {
        $group: {
          _id: '$serviceId',
          totalQuantity: { $sum: '$quantity' },
          totalRevenue: { $sum: '$totalAmount' },
          averageRating: { $avg: '$qualityInfo.rating' },
          treatmentCount: { $sum: 1 }
        }
      },
      {
        $sort: { totalQuantity: -1 }
      },
      {
        $limit: limit
      }
    ]);
  }

  async getTreatmentCompletionStats(startDate, endDate) {
    return await InvoiceDetail.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalTreatments: { $sum: 1 },
          completedTreatments: {
            $sum: {
              $cond: ['$treatmentInfo.isCompleted', 1, 0]
            }
          },
          averageCompletionTime: {
            $avg: {
              $cond: [
                '$treatmentInfo.isCompleted',
                {
                  $subtract: ['$treatmentInfo.completedAt', '$createdAt']
                },
                null
              ]
            }
          },
          pendingFollowUps: {
            $sum: {
              $cond: ['$treatmentInfo.requiresFollowUp', 1, 0]
            }
          }
        }
      }
    ]);
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
    return await InvoiceDetail.findByIdAndDelete(id);
  }

  // ============ HELPER METHODS ============
  async findWithFilter(filter, options = {}) {
    const {
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const skip = (page - 1) * limit;
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    let query = InvoiceDetail.find(filter);

    if (options.populateService) {
      query = query.populate('serviceId', 'name description category');
    }

    if (options.populateInvoice) {
      query = query.populate('invoiceId', 'invoiceNumber status patientInfo');
    }

    const details = await query
      .sort(sort)
      .skip(skip)
      .limit(limit);

    const total = await InvoiceDetail.countDocuments(filter);

    return {
      details,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async recalculateInvoiceAmounts(invoiceId) {
    const details = await this.findByInvoice(invoiceId);
    
    details.forEach(detail => {
      detail.calculateAmounts();
    });

    // Save all details with recalculated amounts
    const savePromises = details.map(detail => detail.save());
    return await Promise.all(savePromises);
  }
}

module.exports = new InvoiceDetailRepository();

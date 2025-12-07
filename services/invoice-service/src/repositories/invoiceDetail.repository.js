const { InvoiceDetail, ServiceType, ServiceCategory, ToothType } = require("../models/invoiceDetail.model");
const { enrichDentistData } = require("../utils/userHelper");

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
    const mongoose = require('mongoose');
    
    
    
    // Ensure invoiceId is an ObjectId
    const objectId = mongoose.Types.ObjectId.isValid(invoiceId) 
      ? new mongoose.Types.ObjectId(invoiceId) 
      : invoiceId;
    
    // console.log(`🔍 [InvoiceDetail Repo] Converted to ObjectId: ${objectId}`);
    
    let query = InvoiceDetail.find({ invoiceId: objectId, isActive: true });

    if (options.populateService) {
      query = query.populate('serviceId', 'name description');
    }

    if (options.sortBy) {
      const sort = { [options.sortBy]: options.sortOrder === 'desc' ? -1 : 1 };
      query = query.sort(sort);
    } else {
      query = query.sort({ createdAt: 1 });
    }

    const results = await query;
    // console.log(`✅ [InvoiceDetail Repo] Found ${results.length} details`);
    
    return results;
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
  
  /**
   * Get revenue summary statistics
   */
  async getRevenueSummary(startDate, endDate, filters = {}) {
    const matchFilter = {
      completedDate: { $gte: startDate, $lte: endDate },
      status: 'completed',
      isActive: true,
      ...filters
    };

    const result = await InvoiceDetail.aggregate([
      { $match: matchFilter },
      // ✅ Join with Invoice to check invoice status
      {
        $lookup: {
          from: 'invoices',
          localField: 'invoiceId',
          foreignField: '_id',
          as: 'invoice'
        }
      },
      { $unwind: '$invoice' },
      // ✅ Filter: only include if Invoice.status = 'completed'
      { $match: { 'invoice.status': 'completed' } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$totalPrice' },
          totalInvoices: { $sum: 1 },
          averageValue: { $avg: '$totalPrice' }
        }
      }
    ]);

    if (result.length === 0) {
      return {
        totalRevenue: 0,
        totalInvoices: 0,
        averageValue: 0,
        paidAmount: 0,
        pendingAmount: 0,
        paymentRate: 0
      };
    }

    const summary = result[0];
    
    // For now, assume all completed invoiceDetails are paid
    // In a real scenario, you'd need to check the invoice status
    return {
      totalRevenue: summary.totalRevenue || 0,
      totalInvoices: summary.totalInvoices || 0,
      averageValue: summary.averageValue || 0,
      paidAmount: summary.totalRevenue || 0,
      pendingAmount: 0,
      paymentRate: 100
    };
  }

  /**
   * Get revenue trends grouped by time period
   */
  async getRevenueTrends(startDate, endDate, groupBy = 'day', filters = {}) {
    const matchFilter = {
      completedDate: { $gte: startDate, $lte: endDate },
      status: 'completed',
      isActive: true,
      ...filters
    };

    // ✅ Prepare $lookup stage to check invoice status
    const lookupStage = {
      $lookup: {
        from: 'invoices',
        localField: 'invoiceId',
        foreignField: '_id',
        as: 'invoice'
      }
    };
    const unwindStage = { $unwind: '$invoice' };
    const invoiceStatusMatch = { $match: { 'invoice.status': 'completed' } };

    let groupStage = {};
    
    switch (groupBy) {
      case 'day':
        groupStage = {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$completedDate'
            }
          }
        };
        break;
      case 'month':
        groupStage = {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: '$completedDate'
            }
          }
        };
        break;
      case 'quarter':
        groupStage = {
          _id: {
            $concat: [
              'Q',
              {
                $toString: {
                  $ceil: {
                    $divide: [{ $month: '$completedDate' }, 3]
                  }
                }
              },
              '-',
              { $toString: { $year: '$completedDate' } }
            ]
          }
        };
        break;
      case 'year':
        groupStage = {
          _id: {
            $dateToString: {
              format: '%Y',
              date: '$completedDate'
            }
          }
        };
        break;
      default:
        groupStage = { _id: null };
    }

    groupStage.revenue = { $sum: '$totalPrice' };
    groupStage.count = { $sum: 1 };

    const trends = await InvoiceDetail.aggregate([
      { $match: matchFilter },
      lookupStage,
      unwindStage,
      invoiceStatusMatch,
      { $group: groupStage },
      { $sort: { '_id': 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          revenue: 1,
          count: 1
        }
      }
    ]);

    return trends;
  }

  /**
   * Get revenue breakdown by dentist
   */
  async getRevenueByDentist(startDate, endDate, filters = {}) {
    console.log('\n========== GET REVENUE BY DENTIST ==========');
    
    const matchFilter = {
      completedDate: { $gte: startDate, $lte: endDate },
      status: 'completed',
      isActive: true,
      dentistId: { $exists: true, $ne: null },
      ...filters
    };

    console.log('🔍 [getRevenueByDentist] Match filter:', JSON.stringify(matchFilter, null, 2));

    const byDentist = await InvoiceDetail.aggregate([
      { $match: matchFilter },
      // ✅ Join with Invoice to check invoice status
      {
        $lookup: {
          from: 'invoices',
          localField: 'invoiceId',
          foreignField: '_id',
          as: 'invoice'
        }
      },
      { $unwind: '$invoice' },
      // ✅ Filter: only include if Invoice.status = 'completed'
      { $match: { 'invoice.status': 'completed' } },
      {
        $group: {
          _id: '$dentistId',
          totalRevenue: { $sum: '$totalPrice' },
          appointmentCount: { $addToSet: '$invoiceId' },
          serviceCount: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          dentistId: { $toString: '$_id' },
          totalRevenue: 1,
          appointmentCount: { $size: '$appointmentCount' },
          serviceCount: 1,
          avgRevenuePerAppointment: {
            $cond: {
              if: { $gt: [{ $size: '$appointmentCount' }, 0] },
              then: { 
                $floor: { $divide: ['$totalRevenue', { $size: '$appointmentCount' }] }
              },
              else: 0
            }
          }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    console.log('📊 [getRevenueByDentist] Aggregation result:', JSON.stringify(byDentist, null, 2));

    if (byDentist.length === 0) {
      console.warn('⚠️ [getRevenueByDentist] No dentist data found with current filters');
      return [];
    }

    console.log(`✅ [getRevenueByDentist] Returning ${byDentist.length} dentist(s) (enrichment done in frontend)`);

    // ❌ REMOVED RPC ENRICHMENT - Frontend sẽ enrich với data từ /api/user/all-staff
    return byDentist;
  }

  /**
   * Get revenue breakdown by service
   */
  async getRevenueByService(startDate, endDate, filters = {}) {
    const matchFilter = {
      completedDate: { $gte: startDate, $lte: endDate },
      status: 'completed',
      isActive: true,
      ...filters
    };

    const byService = await InvoiceDetail.aggregate([
      { $match: matchFilter },
      // ✅ Join with Invoice to check invoice status
      {
        $lookup: {
          from: 'invoices',
          localField: 'invoiceId',
          foreignField: '_id',
          as: 'invoice'
        }
      },
      { $unwind: '$invoice' },
      // ✅ Filter: only include if Invoice.status = 'completed'
      { $match: { 'invoice.status': 'completed' } },
      {
        $group: {
          _id: '$serviceId',
          serviceName: { $first: '$serviceInfo.name' },
          serviceType: { $first: '$serviceInfo.type' },
          totalRevenue: { $sum: '$totalPrice' },
          totalCount: { $sum: '$quantity' }
        }
      },
      {
        $match: {
          totalRevenue: { $gt: 0 } // ✅ Chỉ lấy services có doanh thu > 0
        }
      },
      {
        $project: {
          _id: 0,
          serviceId: { $toString: '$_id' },
          serviceName: 1,
          serviceType: 1,
          totalRevenue: 1,
          totalCount: 1,
          avgRevenuePerService: {
            $cond: {
              if: { $gt: ['$totalCount', 0] },
              then: { $divide: ['$totalRevenue', '$totalCount'] },
              else: 0
            }
          }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    return byService.map(item => ({
      ...item,
      avgRevenuePerService: Math.floor(item.avgRevenuePerService)
    }));
  }

  /**
   * ✅ Get raw revenue details with both dentistId and serviceId
   * For frontend cross-filtering when both filters are applied
   */
  async getRawRevenueDetails(startDate, endDate, filters = {}) {
    const matchFilter = {
      completedDate: { $gte: startDate, $lte: endDate },
      status: 'completed',
      isActive: true,
      dentistId: { $exists: true, $ne: null },
      ...filters
    };

    console.log('🔍 getRawRevenueDetails matchFilter:', JSON.stringify(matchFilter));

    const rawDetails = await InvoiceDetail.aggregate([
      { $match: matchFilter },
      // ✅ Join with Invoice to check invoice status
      {
        $lookup: {
          from: 'invoices',
          localField: 'invoiceId',
          foreignField: '_id',
          as: 'invoice'
        }
      },
      { $unwind: '$invoice' },
      // ✅ Filter: only include if Invoice.status = 'completed'
      { $match: { 'invoice.status': 'completed' } },
      {
        $group: {
          _id: {
            dentistId: '$dentistId',
            serviceId: '$serviceId'
          },
          revenue: { $sum: '$totalPrice' },
          count: { $sum: '$quantity' },
          invoices: { $addToSet: '$invoiceId' }
        }
      },
      {
        $project: {
          _id: 0,
          dentistId: { $toString: '$_id.dentistId' },
          serviceId: { $toString: '$_id.serviceId' },
          revenue: 1,
          count: 1,
          invoiceCount: { $size: '$invoices' }
        }
      }
    ]);

    console.log('📊 getRawRevenueDetails result:', rawDetails.length, 'items');
    if (rawDetails.length > 0) {
      console.log('Sample:', rawDetails[0]);
    }

    return rawDetails;
  }

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

  // ============ HELPER METHODS FOR CONSUMER ============
  
  /**
   * Create invoice detail from consumer event
   */
  async createInvoiceDetail(detailData) {
    return await this.create(detailData);
  }

  /**
   * Update appointmentId for invoice details after appointment creation
   */
  async updateAppointmentId(invoiceId, appointmentId) {
    return await InvoiceDetail.updateMany(
      { invoiceId },
      { appointmentId },
      { new: true }
    );
  }
}

module.exports = new InvoiceDetailRepository();

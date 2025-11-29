const Appointment = require('../models/appointment.model');

class AppointmentRepository {
  async create(appointmentData) {
    const appointment = new Appointment(appointmentData);
    return await appointment.save();
  }

  async findById(id) {
    return await Appointment.findById(id);
  }

  async findOne(filter) {
    return await Appointment.findOne(filter);
  }

  async findByCode(code) {
    return await Appointment.findByCode(code);
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
    
    const appointments = await Appointment.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean();
      
    const total = await Appointment.countDocuments(query);
    
    return {
      appointments,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async findByPatient(patientId, options = {}) {
    return await Appointment.findByPatient(patientId, options);
  }

  async findByDentist(dentistId, options = {}) {
    return await Appointment.findByDentist(dentistId, options);
  }

  async findByPhone(phone, options = {}) {
    const filter = { 'patientInfo.phone': phone };
    if (options.status) filter.status = options.status;
    if (options.limit) {
      return await Appointment.find(filter)
        .sort({ createdAt: -1 })
        .limit(options.limit);
    }
    return await Appointment.find(filter).sort({ createdAt: -1 });
  }

  async findTodayAppointments(dentistId = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const filter = {
      'slots.date': { $gte: today, $lt: tomorrow },
      status: { $in: ['confirmed', 'checked-in', 'in-progress'] }
    };

    if (dentistId) {
      filter.assignedDentistId = dentistId;
    }

    return await Appointment.find(filter)
      .sort({ 'slots.startTime': 1 });
  }

  async findUpcoming(days = 7, dentistId = null) {
    const now = new Date();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const filter = {
      'slots.date': { $gte: now, $lte: futureDate },
      status: { $in: ['confirmed', 'checked-in'] }
    };

    if (dentistId) {
      filter.assignedDentistId = dentistId;
    }

    return await Appointment.find(filter)
      .sort({ 'slots.date': 1, 'slots.startTime': 1 });
  }

  async findPending(limit = 50) {
    return await Appointment.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async findOverdue() {
    const now = new Date();
    return await Appointment.find({
      'slots.date': { $lt: now },
      status: { $in: ['confirmed', 'checked-in'] }
    }).sort({ 'slots.date': 1 });
  }

  async update(id, updateData) {
    return await Appointment.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
  }

  async updateStatus(id, status, additionalData = {}) {
    const updateData = { status, ...additionalData };
    
    // Add timestamps for specific status changes
    switch (status) {
      case 'checked-in':
        updateData.checkedInAt = new Date();
        break;
      case 'in-progress':
        updateData.startedAt = new Date();
        break;
      case 'cancelled':
        updateData.cancelledAt = new Date();
        break;
      case 'completed':
        updateData.completedAt = new Date();
        break;
    }

    return await this.update(id, updateData);
  }

  async assignDentist(id, dentistId, dentistName) {
    return await this.update(id, {
      assignedDentistId: dentistId,
      assignedDentistName: dentistName
    });
  }

  async addNotes(id, notes) {
    return await this.update(id, { notes });
  }

  async updateDeposit(id, depositData) {
    return await this.update(id, { deposit: depositData });
  }

  async markReminderSent(id) {
    return await this.update(id, {
      reminderSent: true,
      reminderSentAt: new Date()
    });
  }

  async delete(id) {
    return await Appointment.findByIdAndDelete(id);
  }

  async search(searchTerm, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    const searchRegex = new RegExp(searchTerm, 'i');
    
    const filter = {
      $or: [
        { appointmentCode: searchRegex },
        { 'patientInfo.name': searchRegex },
        { 'patientInfo.phone': searchRegex },
        { 'patientInfo.email': searchRegex },
        { assignedDentistName: searchRegex }
      ]
    };

    const appointments = await Appointment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
      
    const total = await Appointment.countDocuments(filter);
    
    return {
      appointments,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  async getStatistics(startDate, endDate, dentistId = null) {
    const matchStage = {
      createdAt: { $gte: startDate, $lte: endDate }
    };

    if (dentistId) {
      matchStage.assignedDentistId = dentistId;
    }

    const stats = await Appointment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          confirmed: {
            $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
          },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cancelled: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          noShow: {
            $sum: { $cond: [{ $eq: ['$status', 'no-show'] }, 1, 0] }
          },
          totalRevenue: { $sum: '$totalEstimatedCost' },
          avgCost: { $avg: '$totalEstimatedCost' }
        }
      }
    ]);

    return stats[0] || {
      total: 0,
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
      totalRevenue: 0,
      avgCost: 0
    };
  }

  /**
   * ✅ Get booking channel statistics (Online vs Offline)
   */
  async getBookingChannelStats(startDate, endDate, groupBy = 'day') {
    try {
      const matchStage = {
        appointmentDate: { $gte: startDate, $lte: endDate }, // ✅ Filter by appointment date (not createdAt)
        // ✅ Count all appointments (not just completed) to see booking channel usage
        bookedByRole: { $exists: true, $ne: null } // ✅ Only count appointments with bookedByRole
      };

      // 1. Get summary by channel
      const channelStats = await Appointment.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$bookedByRole',
            count: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            }
          }
        }
      ]);

      console.log('📊 Channel stats:', channelStats);

      // Calculate online vs offline
      const onlineCount = channelStats.find(s => s._id === 'patient')?.count || 0;
      const offlineStats = channelStats.filter(s => s._id !== 'patient' && s._id !== null);
      const offlineCount = offlineStats.reduce((sum, s) => sum + s.count, 0);
      const total = onlineCount + offlineCount;

      const onlineCompleted = channelStats.find(s => s._id === 'patient')?.completed || 0;
      const offlineCompleted = offlineStats.reduce((sum, s) => sum + s.completed, 0);

      // 2. Get offline breakdown by role
      const offlineByRole = await Appointment.aggregate([
        { 
          $match: { 
            ...matchStage,
            bookedByRole: { $ne: 'patient', $exists: true, $ne: null } 
          } 
        },
        {
          $group: {
            _id: '$bookedByRole',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);

      console.log('📊 Offline by role:', offlineByRole);

    // 3. Get trends by period
    let groupByDateFormat;
    if (groupBy === 'month') {
      groupByDateFormat = { $dateToString: { format: '%Y-%m', date: '$appointmentDate' } };
    } else if (groupBy === 'year') {
      groupByDateFormat = { $dateToString: { format: '%Y', date: '$appointmentDate' } };
    } else {
      groupByDateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } };
    }

    const trends = await Appointment.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            date: groupByDateFormat,
            role: '$bookedByRole'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.date': 1 } }
    ]);

    // Transform trends data
    const trendsByDate = {};
    trends.forEach(t => {
      const date = t._id.date;
      if (!trendsByDate[date]) {
        trendsByDate[date] = { date, online: 0, offline: 0 };
      }
      if (t._id.role === 'patient') {
        trendsByDate[date].online += t.count;
      } else {
        trendsByDate[date].offline += t.count;
      }
    });

    // 4. Get top staff (offline bookings only)
    const topStaff = await Appointment.aggregate([
      { 
        $match: { 
          ...matchStage,
          bookedByRole: { $ne: 'patient' },
          bookedBy: { $exists: true }
        } 
      },
      {
        $group: {
          _id: {
            staffId: '$bookedBy',
            role: '$bookedByRole'
          },
          count: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 30 }
    ]);

      console.log('📊 Top staff:', topStaff.length, 'staff members');

      return {
        summary: {
          total,
          online: {
            count: onlineCount,
            percentage: total > 0 ? parseFloat(((onlineCount / total) * 100).toFixed(1)) : 0,
            completionRate: onlineCount > 0 ? parseFloat(((onlineCompleted / onlineCount) * 100).toFixed(1)) : 0
          },
          offline: {
            count: offlineCount,
            percentage: total > 0 ? parseFloat(((offlineCount / total) * 100).toFixed(1)) : 0,
            completionRate: offlineCount > 0 ? parseFloat(((offlineCompleted / offlineCount) * 100).toFixed(1)) : 0
          }
        },
        offlineByRole: offlineByRole.map(item => ({
          role: item._id,
          count: item.count,
          percentage: offlineCount > 0 ? parseFloat(((item.count / offlineCount) * 100).toFixed(1)) : 0
        })),
        trends: Object.values(trendsByDate),
        topStaff: topStaff.map(item => ({
          staffId: item._id.staffId ? item._id.staffId.toString() : null,
          role: item._id.role,
          count: item.count,
          completionRate: item.count > 0 ? parseFloat(((item.completed / item.count) * 100).toFixed(1)) : 0
        })).filter(s => s.staffId) // Remove null staffIds
      };
    } catch (error) {
      console.error('❌ Error in getBookingChannelStats:', error);
      throw error;
    }
  }

  async getDailySchedule(date, dentistId = null) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const filter = {
      'slots.date': { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['cancelled'] }
    };

    if (dentistId) {
      filter.assignedDentistId = dentistId;
    }

    return await Appointment.find(filter)
      .sort({ 'slots.startTime': 1 });
  }

  async checkSlotConflicts(slotIds, excludeAppointmentId = null) {
    const filter = {
      'slots.slotId': { $in: slotIds },
      status: { $nin: ['cancelled', 'completed'] }
    };

    if (excludeAppointmentId) {
      filter._id = { $ne: excludeAppointmentId };
    }

    return await Appointment.find(filter);
  }

  // Helper method to build complex queries
  buildQuery(filter) {
    const query = {};

    if (filter.status) {
      if (Array.isArray(filter.status)) {
        query.status = { $in: filter.status };
      } else {
        query.status = filter.status;
      }
    }

    if (filter.type) {
      query.type = filter.type;
    }

    if (filter.assignedDentistId) {
      query.assignedDentistId = filter.assignedDentistId;
    }

    if (filter.patientId) {
      query.patientId = filter.patientId;
    }

    if (filter.priority) {
      query.priority = filter.priority;
    }

    if (filter.bookingChannel) {
      if (filter.bookingChannel === 'online') {
        query.bookedByRole = 'patient';
      } else {
        query.bookedByRole = { $ne: 'patient' };
      }
    }

    // Date filters
    if (filter.dateFrom || filter.dateTo) {
      query['slots.date'] = {};
      if (filter.dateFrom) {
        query['slots.date'].$gte = new Date(filter.dateFrom);
      }
      if (filter.dateTo) {
        query['slots.date'].$lte = new Date(filter.dateTo);
      }
    }

    // Search by phone
    if (filter.phone) {
      query['patientInfo.phone'] = new RegExp(filter.phone, 'i');
    }

    // Search by name
    if (filter.patientName) {
      query['patientInfo.name'] = new RegExp(filter.patientName, 'i');
    }

    return query;
  }

  /**
   * Create appointment (alias for create method)
   */
  async createAppointment(appointmentData) {
    return await this.create(appointmentData);
  }

  /**
   * Count appointments on a specific date (for generating appointment code)
   */
  async countAppointmentsOnDate(date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    return await Appointment.countDocuments({
      appointmentDate: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    });
  }

  /**
   * Update appointment with invoice ID
   */
  async updateInvoiceId(appointmentId, invoiceId) {
    return await Appointment.findByIdAndUpdate(
      appointmentId,
      { invoiceId },
      { new: true }
    );
  }
}

module.exports = new AppointmentRepository();

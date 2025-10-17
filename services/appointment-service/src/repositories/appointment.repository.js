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
      query.bookingChannel = filter.bookingChannel;
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

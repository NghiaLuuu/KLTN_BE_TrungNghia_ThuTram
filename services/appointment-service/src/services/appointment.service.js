const appointmentRepository = require('../repositories/appointment.repository');
const redis = require('../utils/redis.client');
const rpcClient = require('../utils/rpcClient');

class AppointmentService {
  constructor() {
    this.cacheExpiry = 300; // 5 minutes
  }

  // Cache keys
  getCacheKey(type, id) {
    return `appointment:${type}:${id}`;
  }

  async invalidateCache(appointmentId) {
    const keys = [
      this.getCacheKey('id', appointmentId),
      'appointment:pending',
      'appointment:today',
      'appointment:upcoming'
    ];
    await Promise.all(keys.map(key => redis.del(key)));
  }

  // Create new appointment
  async create(appointmentData, user) {
    try {
      // Validate user permissions
      if (!user || !user.userId) {
        throw new Error('Thông tin người dùng không hợp lệ');
      }

      // Validate required fields
      if (!appointmentData.services || appointmentData.services.length === 0) {
        throw new Error('Cần chọn ít nhất một dịch vụ');
      }

      if (!appointmentData.slots || appointmentData.slots.length === 0) {
        throw new Error('Cần chọn ít nhất một khung thời gian');
      }

      // Check slot conflicts via RPC
      const slotIds = appointmentData.slots.map(slot => slot.slotId);
      const slotValidation = await this.validateSlots(slotIds);
      if (!slotValidation.valid) {
        throw new Error(`Xung đột lịch hẹn: ${slotValidation.reason}`);
      }

      // Prepare appointment data
      const newAppointment = {
        ...appointmentData,
        bookedBy: user.userId,
        bookedByRole: user.role,
        totalEstimatedCost: this.calculateTotalCost(appointmentData.services)
      };

      // Create appointment
      const appointment = await appointmentRepository.create(newAppointment);

      // Send notification via RPC (optional)
      try {
        await this.sendAppointmentNotification(appointment, 'created');
      } catch (notificationError) {
        console.error('Notification failed:', notificationError.message);
      }

      await this.invalidateCache(appointment._id);
      return appointment;
    } catch (error) {
      throw new Error(`Không thể tạo lịch hẹn: ${error.message}`);
    }
  }

  // Get appointment by ID
  async getById(id) {
    try {
      const cacheKey = this.getCacheKey('id', id);
      let appointment = await redis.get(cacheKey);

      if (!appointment) {
        appointment = await appointmentRepository.findById(id);
        if (!appointment) {
          throw new Error('Không tìm thấy lịch hẹn');
        }
        await redis.setex(cacheKey, this.cacheExpiry, JSON.stringify(appointment));
      } else {
        appointment = JSON.parse(appointment);
      }

      return appointment;
    } catch (error) {
      throw new Error(`Lỗi khi lấy thông tin lịch hẹn: ${error.message}`);
    }
  }

  // Get appointment by code
  async getByCode(code) {
    try {
      const appointment = await appointmentRepository.findByCode(code);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn với mã này');
      }
      return appointment;
    } catch (error) {
      throw new Error(`Lỗi khi lấy thông tin lịch hẹn: ${error.message}`);
    }
  }

  // List appointments with filters
  async getAll(filter = {}, options = {}) {
    try {
      return await appointmentRepository.findAll(filter, options);
    } catch (error) {
      throw new Error(`Lỗi khi lấy danh sách lịch hẹn: ${error.message}`);
    }
  }

  // Get appointments by patient
  async getByPatient(patientId, options = {}) {
    try {
      return await appointmentRepository.findByPatient(patientId, options);
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch hẹn của bệnh nhân: ${error.message}`);
    }
  }

  // Get appointments by dentist
  async getByDentist(dentistId, options = {}) {
    try {
      return await appointmentRepository.findByDentist(dentistId, options);
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch hẹn của nha sĩ: ${error.message}`);
    }
  }

  // Get appointments by phone
  async getByPhone(phone, options = {}) {
    try {
      return await appointmentRepository.findByPhone(phone, options);
    } catch (error) {
      throw new Error(`Lỗi khi tìm lịch hẹn theo số điện thoại: ${error.message}`);
    }
  }

  // Get today's appointments
  async getTodayAppointments(dentistId = null) {
    try {
      const cacheKey = `appointment:today:${dentistId || 'all'}`;
      let appointments = await redis.get(cacheKey);

      if (!appointments) {
        appointments = await appointmentRepository.findTodayAppointments(dentistId);
        await redis.setex(cacheKey, 300, JSON.stringify(appointments)); // 5 min cache
      } else {
        appointments = JSON.parse(appointments);
      }

      return appointments;
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch hẹn hôm nay: ${error.message}`);
    }
  }

  // Get upcoming appointments
  async getUpcoming(days = 7, dentistId = null) {
    try {
      return await appointmentRepository.findUpcoming(days, dentistId);
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch hẹn sắp tới: ${error.message}`);
    }
  }

  // Get pending appointments
  async getPending(limit = 50) {
    try {
      const cacheKey = 'appointment:pending';
      let appointments = await redis.get(cacheKey);

      if (!appointments) {
        appointments = await appointmentRepository.findPending(limit);
        await redis.setex(cacheKey, 180, JSON.stringify(appointments)); // 3 min cache
      } else {
        appointments = JSON.parse(appointments);
      }

      return appointments;
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch hẹn chờ xử lý: ${error.message}`);
    }
  }

  // Get overdue appointments
  async getOverdue() {
    try {
      return await appointmentRepository.findOverdue();
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch hẹn quá hạn: ${error.message}`);
    }
  }

  // Update appointment
  async update(id, updateData, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      // Check permissions
      if (!appointment.canBeModified()) {
        throw new Error('Lịch hẹn không thể chỉnh sửa ở trạng thái hiện tại');
      }

      // Validate slot conflicts if slots are being updated
      if (updateData.slots) {
        const slotIds = updateData.slots.map(slot => slot.slotId);
        const slotValidation = await this.validateSlots(slotIds, id);
        if (!slotValidation.valid) {
          throw new Error(`Xung đột lịch hẹn: ${slotValidation.reason}`);
        }
      }

      // Update total cost if services changed
      if (updateData.services) {
        updateData.totalEstimatedCost = this.calculateTotalCost(updateData.services);
      }

      const updatedAppointment = await appointmentRepository.update(id, updateData);
      await this.invalidateCache(id);

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi cập nhật lịch hẹn: ${error.message}`);
    }
  }

  // Update appointment status
  async updateStatus(id, status, additionalData = {}, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      // Add user info to additional data
      if (user) {
        switch (status) {
          case 'checked-in':
            additionalData.checkedInBy = user.userId;
            break;
          case 'cancelled':
            additionalData.cancelledBy = user.userId;
            break;
        }
      }

      const updatedAppointment = await appointmentRepository.updateStatus(id, status, additionalData);
      await this.invalidateCache(id);

      // Send status change notification
      try {
        await this.sendAppointmentNotification(updatedAppointment, 'status_changed');
      } catch (notificationError) {
        console.error('Notification failed:', notificationError.message);
      }

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi cập nhật trạng thái lịch hẹn: ${error.message}`);
    }
  }

  // Assign dentist to appointment
  async assignDentist(id, dentistId, dentistName, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      // Validate dentist availability via RPC
      const availability = await this.checkDentistAvailability(dentistId, appointment.slots);
      if (!availability.available) {
        throw new Error(`Nha sĩ không có sẵn: ${availability.reason}`);
      }

      const updatedAppointment = await appointmentRepository.assignDentist(id, dentistId, dentistName);
      await this.invalidateCache(id);

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi phân công nha sĩ: ${error.message}`);
    }
  }

  // Cancel appointment
  async cancel(id, reason, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      if (!appointment.canBeCancelled()) {
        throw new Error('Lịch hẹn không thể hủy ở trạng thái hiện tại');
      }

      const cancelData = {
        cancellationReason: reason,
        cancelledBy: user.userId
      };

      const updatedAppointment = await appointmentRepository.updateStatus(id, 'cancelled', cancelData);
      await this.invalidateCache(id);

      // Release slots via RPC
      try {
        const slotIds = appointment.slots.map(slot => slot.slotId);
        await this.releaseSlots(slotIds);
      } catch (slotError) {
        console.error('Failed to release slots:', slotError.message);
      }

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi hủy lịch hẹn: ${error.message}`);
    }
  }

  // Check-in appointment
  async checkIn(id, user) {
    try {
      return await this.updateStatus(id, 'checked-in', {}, user);
    } catch (error) {
      throw new Error(`Lỗi khi check-in: ${error.message}`);
    }
  }

  // Complete appointment
  async complete(id, completionData, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      const data = {
        ...completionData,
        actualDuration: completionData.actualDuration || null
      };

      const updatedAppointment = await appointmentRepository.updateStatus(id, 'completed', data);
      await this.invalidateCache(id);

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi hoàn thành lịch hẹn: ${error.message}`);
    }
  }

  // Search appointments
  async search(searchTerm, options = {}) {
    try {
      return await appointmentRepository.search(searchTerm, options);
    } catch (error) {
      throw new Error(`Lỗi khi tìm kiếm lịch hẹn: ${error.message}`);
    }
  }

  // Get appointment statistics
  async getStatistics(startDate, endDate, dentistId = null) {
    try {
      return await appointmentRepository.getStatistics(startDate, endDate, dentistId);
    } catch (error) {
      throw new Error(`Lỗi khi lấy thống kê: ${error.message}`);
    }
  }

  // Get daily schedule
  async getDailySchedule(date, dentistId = null) {
    try {
      return await appointmentRepository.getDailySchedule(date, dentistId);
    } catch (error) {
      throw new Error(`Lỗi khi lấy lịch trình hàng ngày: ${error.message}`);
    }
  }

  // Delete appointment (admin only)
  async delete(id, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      await appointmentRepository.delete(id);
      await this.invalidateCache(id);

      // Release slots if not already released
      if (!['cancelled', 'completed'].includes(appointment.status)) {
        try {
          const slotIds = appointment.slots.map(slot => slot.slotId);
          await this.releaseSlots(slotIds);
        } catch (slotError) {
          console.error('Failed to release slots:', slotError.message);
        }
      }

      return { success: true, message: 'Đã xóa lịch hẹn thành công' };
    } catch (error) {
      throw new Error(`Lỗi khi xóa lịch hẹn: ${error.message}`);
    }
  }

  // Helper methods

  // Validate slots via RPC
  async validateSlots(slotIds, excludeAppointmentId = null) {
    try {
      // Check for conflicts in current appointments
      const conflicts = await appointmentRepository.checkSlotConflicts(slotIds, excludeAppointmentId);
      if (conflicts.length > 0) {
        return {
          valid: false,
          reason: 'Khung thời gian đã được đặt bởi lịch hẹn khác'
        };
      }

      // Validate with schedule service via RPC
      const scheduleValidation = await rpcClient.request('schedule_queue', {
        action: 'validateSlots',
        payload: { slotIds }
      });

      return scheduleValidation;
    } catch (error) {
      return {
        valid: false,
        reason: `Lỗi kiểm tra khung thời gian: ${error.message}`
      };
    }
  }

  // Check dentist availability via RPC
  async checkDentistAvailability(dentistId, slots) {
    try {
      const result = await rpcClient.request('schedule_queue', {
        action: 'checkDentistAvailability',
        payload: { dentistId, slots }
      });

      return result;
    } catch (error) {
      return {
        available: false,
        reason: `Lỗi kiểm tra lịch trình nha sĩ: ${error.message}`
      };
    }
  }

  // Release slots via RPC
  async releaseSlots(slotIds) {
    try {
      await rpcClient.request('schedule_queue', {
        action: 'releaseSlots',
        payload: { slotIds }
      });
    } catch (error) {
      console.error('Failed to release slots via RPC:', error.message);
      throw error;
    }
  }

  // Calculate total cost
  calculateTotalCost(services) {
    return services.reduce((total, service) => total + (service.price || 0), 0);
  }

  // Send notifications via RPC
  async sendAppointmentNotification(appointment, type) {
    try {
      await rpcClient.request('notification_queue', {
        action: 'sendAppointmentNotification',
        payload: { appointment, type }
      });
    } catch (error) {
      console.error('Failed to send notification:', error.message);
      // Don't throw error for notifications
    }
  }

  // Update deposit
  async updateDeposit(id, depositData, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      const updatedAppointment = await appointmentRepository.updateDeposit(id, depositData);
      await this.invalidateCache(id);

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi cập nhật đặt cọc: ${error.message}`);
    }
  }

  // Add notes to appointment
  async addNotes(id, notes, user) {
    try {
      const appointment = await appointmentRepository.findById(id);
      if (!appointment) {
        throw new Error('Không tìm thấy lịch hẹn');
      }

      const updatedAppointment = await appointmentRepository.addNotes(id, notes);
      await this.invalidateCache(id);

      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi thêm ghi chú: ${error.message}`);
    }
  }

  // Mark reminder as sent
  async markReminderSent(id) {
    try {
      const updatedAppointment = await appointmentRepository.markReminderSent(id);
      await this.invalidateCache(id);
      return updatedAppointment;
    } catch (error) {
      throw new Error(`Lỗi khi đánh dấu đã gửi nhắc nhở: ${error.message}`);
    }
  }
}

module.exports = new AppointmentService();
const appointmentService = require('../services/appointment.service');

class AppointmentController {
  // Create new appointment
  async create(req, res) {
    try {
      const appointment = await appointmentService.create(req.body, req.user);
      
      res.status(201).json({
        success: true,
        message: 'Tạo lịch hẹn thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get all appointments with filters
  async getAll(req, res) {
    try {
      const filters = {
        status: req.query.status,
        type: req.query.type,
        assignedDentistId: req.query.dentistId,
        patientId: req.query.patientId,
        priority: req.query.priority,
        bookingChannel: req.query.bookingChannel,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
        phone: req.query.phone,
        patientName: req.query.patientName
      };

      // Remove undefined values
      Object.keys(filters).forEach(key => {
        if (filters[key] === undefined) delete filters[key];
      });

      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc'
      };

      const result = await appointmentService.getAll(filters, options);
      
      res.json({
        success: true,
        data: result.appointments,
        pagination: {
          page: result.page,
          pages: result.pages,
          total: result.total,
          limit: options.limit
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get appointment by ID
  async getById(req, res) {
    try {
      const appointment = await appointmentService.getById(req.params.id);
      
      res.json({
        success: true,
        data: appointment
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get appointment by code
  async getByCode(req, res) {
    try {
      const appointment = await appointmentService.getByCode(req.params.code);
      
      res.json({
        success: true,
        data: appointment
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get appointments by patient
  async getByPatient(req, res) {
    try {
      const options = {
        status: req.query.status,
        fromDate: req.query.fromDate,
        toDate: req.query.toDate
      };

      const appointments = await appointmentService.getByPatient(req.params.patientId, options);
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get appointments by dentist
  async getByDentist(req, res) {
    try {
      const options = {
        status: req.query.status,
        date: req.query.date
      };

      const appointments = await appointmentService.getByDentist(req.params.dentistId, options);
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get appointments by phone
  async getByPhone(req, res) {
    try {
      const options = {
        status: req.query.status,
        limit: req.query.limit ? parseInt(req.query.limit) : undefined
      };

      const appointments = await appointmentService.getByPhone(req.params.phone, options);
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get today's appointments
  async getTodayAppointments(req, res) {
    try {
      const dentistId = req.query.dentistId || null;
      const appointments = await appointmentService.getTodayAppointments(dentistId);
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get upcoming appointments
  async getUpcoming(req, res) {
    try {
      const days = parseInt(req.query.days) || 7;
      const dentistId = req.query.dentistId || null;
      const appointments = await appointmentService.getUpcoming(days, dentistId);
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get pending appointments
  async getPending(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const appointments = await appointmentService.getPending(limit);
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get overdue appointments
  async getOverdue(req, res) {
    try {
      const appointments = await appointmentService.getOverdue();
      
      res.json({
        success: true,
        data: appointments
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Update appointment
  async update(req, res) {
    try {
      const appointment = await appointmentService.update(req.params.id, req.body, req.user);
      
      res.json({
        success: true,
        message: 'Cập nhật lịch hẹn thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Update appointment status
  async updateStatus(req, res) {
    try {
      const { status, ...additionalData } = req.body;
      const appointment = await appointmentService.updateStatus(
        req.params.id,
        status,
        additionalData,
        req.user
      );
      
      res.json({
        success: true,
        message: 'Cập nhật trạng thái thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Assign dentist
  async assignDentist(req, res) {
    try {
      const { dentistId, dentistName } = req.body;
      const appointment = await appointmentService.assignDentist(
        req.params.id,
        dentistId,
        dentistName,
        req.user
      );
      
      res.json({
        success: true,
        message: 'Phân công nha sĩ thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Cancel appointment
  async cancel(req, res) {
    try {
      const { reason } = req.body;
      const appointment = await appointmentService.cancel(req.params.id, reason, req.user);
      
      res.json({
        success: true,
        message: 'Hủy lịch hẹn thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Check-in appointment
  async checkIn(req, res) {
    try {
      const appointment = await appointmentService.checkIn(req.params.id, req.user);
      
      res.json({
        success: true,
        message: 'Check-in thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Complete appointment
  async complete(req, res) {
    try {
      const appointment = await appointmentService.complete(req.params.id, req.body, req.user);
      
      res.json({
        success: true,
        message: 'Hoàn thành lịch hẹn thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Search appointments
  async search(req, res) {
    try {
      const { q: searchTerm } = req.query;
      if (!searchTerm) {
        return res.status(400).json({
          success: false,
          message: 'Thiếu từ khóa tìm kiếm'
        });
      }

      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20
      };

      const result = await appointmentService.search(searchTerm, options);
      
      res.json({
        success: true,
        data: result.appointments,
        pagination: {
          page: result.page,
          pages: result.pages,
          total: result.total,
          limit: options.limit
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get appointment statistics
  async getStatistics(req, res) {
    try {
      const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(new Date().setDate(1));
      const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
      const dentistId = req.query.dentistId || null;

      const stats = await appointmentService.getStatistics(startDate, endDate, dentistId);
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Get daily schedule
  async getDailySchedule(req, res) {
    try {
      const date = req.query.date ? new Date(req.query.date) : new Date();
      const dentistId = req.query.dentistId || null;

      const schedule = await appointmentService.getDailySchedule(date, dentistId);
      
      res.json({
        success: true,
        data: schedule
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  // Delete appointment (admin only)
  async delete(req, res) {
    try {
      const result = await appointmentService.delete(req.params.id, req.user);
      
      res.json({
        success: true,
        message: result.message
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Update deposit
  async updateDeposit(req, res) {
    try {
      const appointment = await appointmentService.updateDeposit(req.params.id, req.body, req.user);
      
      res.json({
        success: true,
        message: 'Cập nhật đặt cọc thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }

  // Add notes to appointment
  async addNotes(req, res) {
    try {
      const { notes } = req.body;
      const appointment = await appointmentService.addNotes(req.params.id, notes, req.user);
      
      res.json({
        success: true,
        message: 'Thêm ghi chú thành công',
        data: appointment
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new AppointmentController();
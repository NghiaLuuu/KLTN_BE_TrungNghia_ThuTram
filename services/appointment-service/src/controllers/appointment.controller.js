const appointmentService = require('../services/appointment.service');
const queueService = require('../services/queue.service');

class AppointmentController {
  
  async getAvailableSlots(req, res) {
    try {
      const { dentistId, date, serviceDuration } = req.query;
      
      // Validation middleware đã check required params
      const result = await appointmentService.getAvailableSlotGroups(
        dentistId, date, parseInt(serviceDuration)
      );
      
      res.json({ success: true, data: result });
      
    } catch (error) {
      console.error('getAvailableSlots error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async reserve(req, res) {
    try {
      const result = await appointmentService.reserveAppointment(req.body, req.user);
      
      res.status(201).json({
        success: true,
        message: 'Reservation created successfully. Please pay within 15 minutes.',
        data: result
      });
      
    } catch (error) {
      console.error('reserve error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  async getByCode(req, res) {
    try {
      const appointment = await appointmentService.getByCode(req.params.appointmentCode);
      res.json({ success: true, data: appointment });
      
    } catch (error) {
      console.error('getByCode error:', error);
      res.status(404).json({ success: false, message: error.message });
    }
  }
  
  async getByPatient(req, res) {
    try {
      const filters = {
        status: req.query.status,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo
      };
      
      const appointments = await appointmentService.getByPatient(req.params.patientId, filters);
      res.json({ success: true, data: appointments });
      
    } catch (error) {
      console.error('getByPatient error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  // ⭐ Get logged-in patient's own appointments
  async getMyAppointments(req, res) {
    try {
      const patientId = req.user?.userId || req.user?._id;
      
      if (!patientId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      
      const filters = {
        status: req.query.status,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo
      };
      
      console.log('🔍 [DEBUG] getMyAppointments - patientId:', patientId);
      
      const appointments = await appointmentService.getByPatient(patientId, filters);
      
      console.log('🔍 [DEBUG] getMyAppointments - Found:', appointments.length);
      
      res.json({ success: true, data: appointments });
      
    } catch (error) {
      console.error('getMyAppointments error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async getByDentist(req, res) {
    try {
      const filters = {
        status: req.query.status,
        date: req.query.date
      };
      
      const appointments = await appointmentService.getByDentist(req.params.dentistId, filters);
      res.json({ success: true, data: appointments });
      
    } catch (error) {
      console.error('getByDentist error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
  
  async checkIn(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const appointment = await appointmentService.checkIn(req.params.id, userId);
      res.json({ success: true, message: 'Check-in successful', data: appointment });
      
    } catch (error) {
      console.error('checkIn error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  async complete(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const appointmentId = req.params.id;
      
      // Complete current appointment
      const appointment = await appointmentService.complete(
        appointmentId, userId, req.body
      );
      
      // 🔥 Auto-activate next patient in queue
      try {
        const nextPatient = await queueService.activateNextPatient(appointmentId);
        
        if (nextPatient) {
          console.log(`✅ [Complete] Auto-activated next patient: ${nextPatient.appointmentCode}`);
        }
      } catch (queueError) {
        // Don't fail the completion if queue activation fails
        console.error('⚠️ [Complete] Queue activation failed:', queueError);
      }
      
      res.json({ success: true, message: 'Appointment completed successfully', data: appointment });
      
    } catch (error) {
      console.error('complete error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  async cancel(req, res) {
    try {
      const userId = req.user?.userId || req.user?._id;
      const appointment = await appointmentService.cancel(
        req.params.id, userId, req.body.reason
      );
      res.json({ success: true, message: 'Appointment cancelled successfully', data: appointment });
      
    } catch (error) {
      console.error('cancel error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // 🆕 Cancel appointment - internal (no auth required, for schedule-service)
  async cancelInternal(req, res) {
    try {
      const { cancelledBy, cancellationReason } = req.body;
      const appointment = await appointmentService.cancel(
        req.params.id, 
        cancelledBy || 'system', 
        cancellationReason || 'Slot disabled by system'
      );
      res.json({ 
        success: true, 
        message: 'Appointment cancelled successfully (internal)', 
        data: appointment 
      });
      
    } catch (error) {
      console.error('cancelInternal error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }
  
  async createOffline(req, res) {
    try {
      console.log('📝 createOffline received body:', JSON.stringify(req.body, null, 2));
      console.log('👤 patientInfo:', req.body.patientInfo);
      console.log('🔐 req.user:', req.user);
      
      // Use req.user if available, otherwise use createdBy from body
      const currentUser = req.user || { 
        _id: req.body.createdBy, 
        role: 'staff' 
      };
      
      const appointment = await appointmentService.createAppointmentDirectly(req.body, currentUser);
      
      res.status(201).json({
        success: true,
        message: 'Offline appointment created successfully',
        data: appointment
      });
      
    } catch (error) {
      console.error('createOffline error:', error);
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getAllAppointments(req, res) {
    try {
      const filters = {
        status: req.query.status,
        dentistId: req.query.dentistId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50
      };

      // 🔒 Filter by activeRole (selected role at login)
      const activeRole = req.user?.activeRole || req.user?.role; // Use activeRole if available
      const userRoles = req.user?.roles || [req.user?.role]; // All roles for checking admin/manager
      const userId = req.user?.userId || req.user?._id;

      console.log('🔍 [APPOINTMENT DEBUG] activeRole:', activeRole);
      console.log('🔍 [APPOINTMENT DEBUG] userRoles:', userRoles);

      // ✅ Filter based on ACTIVE ROLE (role selected at login)
      if (activeRole === 'dentist') {
        // Logged in as dentist - only see their appointments
        filters.dentistId = userId;
        console.log('🔒 [DENTIST FILTER] dentistId:', userId);
      } else if (activeRole === 'nurse') {
        // Logged in as nurse - only see their appointments
        filters.nurseId = userId;
        console.log('🔒 [NURSE FILTER] nurseId:', userId);
      } else if (activeRole === 'admin' || activeRole === 'manager') {
        // Logged in as admin/manager - see all appointments
        console.log('🔓 [NO FILTER] User logged in as admin/manager');
      } else {
        console.log('🔓 [NO FILTER] Role:', activeRole);
      }
      // Receptionist sees all
      
      const result = await appointmentService.getAllAppointments(filters);
      res.json({ 
        success: true, 
        data: result
      });
      
    } catch (error) {
      console.error('getAllAppointments error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getByStaff(req, res) {
    try {
      const { staffId } = req.params;
      const { date } = req.query;
      
      if (!date) {
        return res.status(400).json({ 
          success: false, 
          message: 'Date parameter is required (format: yyyy-MM-dd)' 
        });
      }
      
      const appointments = await appointmentService.getByStaff(staffId, date);
      res.json({ 
        success: true, 
        data: appointments 
      });
      
    } catch (error) {
      console.error('getByStaff error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // 🆕 GET APPOINTMENTS BY IDS (for schedule-service)
  async getByIds(req, res) {
    try {
      const { ids } = req.query;
      
      if (!ids) {
        return res.status(400).json({ 
          success: false, 
          message: 'ids parameter is required (comma-separated)' 
        });
      }
      
      const appointmentIds = ids.split(',').map(id => id.trim()).filter(Boolean);
      
      if (appointmentIds.length === 0) {
        return res.json({ success: true, data: [] });
      }
      
      const appointments = await appointmentService.getAppointmentsByIds(appointmentIds);
      res.json({ 
        success: true, 
        data: appointments,
        count: appointments.length
      });
      
    } catch (error) {
      console.error('getByIds error:', error);
      res.status(500).json({ success: false, message: error.message });
    }
  }

  /**
   * ✅ Request cancellation (for online patients only)
   * Patient can request cancellation if appointment is >= 1 day away
   */
  async requestCancellation(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;
      const patientId = req.user?.userId || req.user?._id;

      if (!patientId) {
        return res.status(401).json({ 
          success: false, 
          message: 'Unauthorized' 
        });
      }

      const result = await appointmentService.requestCancellation(
        appointmentId,
        patientId,
        reason
      );

      res.json({
        success: true,
        message: 'Yêu cầu hủy phiếu khám đã được gửi. Vui lòng chờ xác nhận từ phòng khám.',
        data: result
      });
    } catch (error) {
      console.error('requestCancellation error:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * ✅ Admin/Manager/Receptionist cancel appointment
   * No time restrictions
   */
  async adminCancelAppointment(req, res) {
    try {
      const { appointmentId } = req.params;
      const { reason } = req.body;
      const staffId = req.user?.userId || req.user?._id;
      const staffRole = req.user?.activeRole || req.user?.role; // ✅ Fix: Read activeRole from JWT token

      console.log('🔍 [adminCancelAppointment] Request received:', {
        appointmentId,
        staffId,
        staffRole,
        reason: reason?.substring(0, 50)
      });

      if (!staffId || !staffRole) {
        console.error('❌ [adminCancelAppointment] Missing auth info:', { staffId, staffRole, user: req.user });
        return res.status(401).json({ 
          success: false, 
          message: 'Unauthorized' 
        });
      }

      const result = await appointmentService.adminCancelAppointment(
        appointmentId,
        staffId,
        staffRole,
        reason
      );

      console.log('✅ [adminCancelAppointment] Success');
      res.json({
        success: true,
        message: 'Phiếu khám đã được hủy thành công',
        data: result
      });
    } catch (error) {
      console.error('❌ [adminCancelAppointment] error:', error);
      res.status(400).json({ 
        success: false, 
        message: error.message 
      });
    }
  }

  /**
   * ✅ Get booking channel statistics (Online vs Offline)
   */
  async getBookingChannelStats(req, res) {
    try {
      const { startDate, endDate, groupBy = 'day' } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'startDate and endDate are required'
        });
      }

      const stats = await appointmentService.getBookingChannelStats(
        new Date(startDate),
        new Date(endDate),
        groupBy
      );

      res.json({
        success: true,
        message: 'Lấy thống kê kênh đặt hẹn thành công',
        data: stats
      });
    } catch (error) {
      console.error('getBookingChannelStats error:', error);
      res.status(500).json({ 
        success: false, 
        message: error.message || 'Lỗi khi lấy thống kê kênh đặt hẹn'
      });
    }
  }
}

module.exports = new AppointmentController();
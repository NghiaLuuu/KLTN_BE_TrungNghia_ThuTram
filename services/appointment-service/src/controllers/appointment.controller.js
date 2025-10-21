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
}

module.exports = new AppointmentController();
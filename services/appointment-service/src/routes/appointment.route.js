const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const queueController = require('../controllers/queue.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
  createOfflineAppointmentValidation, // ⭐ Import new validation
  reserveAppointmentValidation,
  cancelAppointmentValidation,
  completeAppointmentValidation,
  checkInAppointmentValidation,
  appointmentCodeValidation,
  patientAppointmentsValidation,
  dentistAppointmentsValidation,
  availableSlotsValidation
} = require('../validations/reserve.validation');

// 🆕 Get appointments by IDs (for schedule-service - internal use)
// ⚠️ MUST be BEFORE '/' route to avoid path conflict
router.get('/by-ids',
  appointmentController.getByIds
);

// 🆕 Cancel appointment (internal - for schedule-service when disabling slots)
router.post('/internal/cancel/:id',
  appointmentController.cancelInternal
);

// Get all appointments (Admin/Manager/Receptionist only)
router.get('/', 
  authenticate, 
  authorize(['admin', 'manager', 'receptionist']),
  appointmentController.getAllAppointments
);

// Get available slot groups
router.get('/available-slots', 
  authenticate, 
  availableSlotsValidation,
  validate,
  appointmentController.getAvailableSlots
);

// Reserve appointment (create temp reservation + payment) - For online booking
router.post('/reserve', 
  authenticate, 
  reserveAppointmentValidation,
  validate,
  appointmentController.reserve
);

// Create appointment directly (offline booking) - For staff/admin only
router.post('/create-offline', 
  authenticate, 
  authorize(['staff', 'admin', 'manager', 'dentist', 'receptionist']),
  createOfflineAppointmentValidation, // ⭐ Use dedicated validation for offline booking
  validate,
  appointmentController.createOffline
);

// Get appointment by code
router.get('/code/:appointmentCode', 
  authenticate,
  appointmentCodeValidation,
  validate,
  appointmentController.getByCode
);

// ⭐ Get my appointments (logged-in patient's own appointments)
router.get('/my-appointments',
  authenticate,
  appointmentController.getMyAppointments
);

// Get appointments by patient
router.get('/patient/:patientId', 
  authenticate,
  patientAppointmentsValidation,
  validate,
  appointmentController.getByPatient
);

// Get appointments by dentist
router.get('/dentist/:dentistId', 
  authenticate,
  dentistAppointmentsValidation,
  validate,
  appointmentController.getByDentist
);

// Get appointments by staff (dentist or nurse)
router.get('/by-staff/:staffId',
  authenticate,
  appointmentController.getByStaff
);

// Check-in appointment
router.post('/:id/check-in', 
  authenticate, 
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  checkInAppointmentValidation,
  validate,
  appointmentController.checkIn
);

// Complete appointment
router.post('/:id/complete', 
  authenticate, 
  authorize(['dentist', 'admin', 'manager']),
  completeAppointmentValidation,
  validate,
  appointmentController.complete
);

// Cancel appointment
router.post('/:id/cancel', 
  authenticate,
  cancelAppointmentValidation,
  validate,
  appointmentController.cancel
);

// ============================================
// 🔥 QUEUE MANAGEMENT ROUTES
// ============================================

// Get queue for all rooms or specific room
router.get('/queue',
  authenticate,
  queueController.getQueue
);

// Get queue statistics
router.get('/queue/stats',
  authenticate,
  authorize(['admin', 'manager', 'dentist', 'staff', 'receptionist', 'nurse']),
  queueController.getQueueStats
);

// ✅ Get booking channel statistics (Online vs Offline)
router.get('/booking-channel-stats',
  authenticate,
  authorize(['admin', 'manager']),
  appointmentController.getBookingChannelStats
);

// Trigger auto-start (for testing/manual trigger)
router.post('/queue/auto-start',
  authenticate,
  authorize(['admin', 'manager']),
  queueController.triggerAutoStart
);

module.exports = router;
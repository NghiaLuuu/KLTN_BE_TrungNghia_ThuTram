const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');
const {
  reserveAppointmentValidation,
  cancelAppointmentValidation,
  completeAppointmentValidation,
  checkInAppointmentValidation,
  appointmentCodeValidation,
  patientAppointmentsValidation,
  dentistAppointmentsValidation,
  availableSlotsValidation
} = require('../validations/reserve.validation');

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
  authorize(['staff', 'admin', 'dentist']),
  reserveAppointmentValidation,
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

// Check-in appointment
router.post('/:id/check-in', 
  authenticate, 
  authorize(['dentist', 'admin', 'staff', 'receptionist']),
  checkInAppointmentValidation,
  validate,
  appointmentController.checkIn
);

// Complete appointment
router.post('/:id/complete', 
  authenticate, 
  authorize(['dentist', 'admin']),
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

module.exports = router;
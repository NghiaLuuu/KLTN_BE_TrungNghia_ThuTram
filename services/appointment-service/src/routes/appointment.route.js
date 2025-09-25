const express = require('express');
const router = express.Router();

// Import controller
const appointmentController = require('../controllers/appointment.controller');

// Import middleware
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

// Import validations
const {
  createAppointmentValidation,
  updateAppointmentValidation,
  appointmentIdValidation,
  appointmentCodeValidation,
  updateStatusValidation,
  assignDentistValidation,
  cancelAppointmentValidation,
  listAppointmentsValidation,
  searchAppointmentsValidation,
  patientIdValidation,
  dentistIdValidation,
  phoneValidation,
  statisticsValidation,
  dailyScheduleValidation,
  updateDepositValidation,
  addNotesValidation
} = require('../validations/appointment.validation');

// Routes

// List all appointments with filters
router.get('/', 
  authenticate,
  listAppointmentsValidation,
  validate,
  appointmentController.getAll
);

// Search appointments
router.get('/search',
  authenticate,
  searchAppointmentsValidation,
  validate,
  appointmentController.search
);

// Get appointment statistics
router.get('/statistics',
  authenticate,
  authorize(['admin', 'manager']),
  statisticsValidation,
  validate,
  appointmentController.getStatistics
);

// Get daily schedule
router.get('/schedule/daily',
  authenticate,
  dailyScheduleValidation,
  validate,
  appointmentController.getDailySchedule
);

// Get today's appointments
router.get('/today',
  authenticate,
  appointmentController.getTodayAppointments
);

// Get upcoming appointments
router.get('/upcoming',
  authenticate,
  appointmentController.getUpcoming
);

// Get pending appointments
router.get('/pending',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  appointmentController.getPending
);

// Get overdue appointments
router.get('/overdue',
  authenticate,
  authorize(['admin', 'manager']),
  appointmentController.getOverdue
);

// Get appointments by patient
router.get('/patient/:patientId',
  authenticate,
  patientIdValidation,
  validate,
  appointmentController.getByPatient
);

// Get appointments by dentist
router.get('/dentist/:dentistId',
  authenticate,
  dentistIdValidation,
  validate,
  appointmentController.getByDentist
);

// Get appointments by phone
router.get('/phone/:phone',
  authenticate,
  phoneValidation,
  validate,
  appointmentController.getByPhone
);

// Get appointment by code
router.get('/code/:code',
  authenticate,
  appointmentCodeValidation,
  validate,
  appointmentController.getByCode
);

// Get appointment by ID
router.get('/:id',
  authenticate,
  appointmentIdValidation,
  validate,
  appointmentController.getById
);

// Create new appointment
router.post('/',
  authenticate,
  authorize(['patient', 'dentist', 'admin', 'manager']),
  createAppointmentValidation,
  validate,
  appointmentController.create
);

// Update appointment status
router.patch('/:id/status',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateStatusValidation,
  validate,
  appointmentController.updateStatus
);

// Assign dentist to appointment
router.patch('/:id/assign-dentist',
  authenticate,
  authorize(['admin', 'manager']),
  assignDentistValidation,
  validate,
  appointmentController.assignDentist
);

// Cancel appointment
router.patch('/:id/cancel',
  authenticate,
  cancelAppointmentValidation,
  validate,
  appointmentController.cancel
);

// Check-in appointment
router.patch('/:id/check-in',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  appointmentIdValidation,
  validate,
  appointmentController.checkIn
);

// Complete appointment
router.patch('/:id/complete',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  appointmentIdValidation,
  validate,
  appointmentController.complete
);

// Update deposit
router.patch('/:id/deposit',
  authenticate,
  authorize(['admin', 'manager']),
  updateDepositValidation,
  validate,
  appointmentController.updateDeposit
);

// Add notes to appointment
router.patch('/:id/notes',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  addNotesValidation,
  validate,
  appointmentController.addNotes
);

// Update appointment
router.put('/:id',
  authenticate,
  authorize(['patient', 'dentist', 'admin', 'manager']),
  updateAppointmentValidation,
  validate,
  appointmentController.update
);

// Delete appointment (admin only)
router.delete('/:id',
  authenticate,
  authorize(['admin']),
  appointmentIdValidation,
  validate,
  appointmentController.delete
);

module.exports = router;

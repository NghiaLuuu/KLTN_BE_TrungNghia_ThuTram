const express = require('express');
const router = express.Router();

// Import controller
const recordController = require('../controllers/record.controller');
const queueController = require('../controllers/queue.controller');

// Import middleware
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { validate } = require('../middlewares/validate.middleware');

// Import validations
const {
  createRecordValidation,
  updateRecordValidation,
  recordIdValidation,
  recordCodeValidation,
  updateStatusValidation,
  addPrescriptionValidation,
  updateTreatmentIndicationValidation,
  listRecordsValidation,
  searchRecordsValidation,
  patientIdValidation,
  dentistIdValidation,
  statisticsValidation
} = require('../validations/record.validation');

// Routes

// ========== Queue Management Routes ==========
// Get next queue number for a room
router.get('/queue/next-number',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  queueController.getNextQueueNumber
);

// Get queue status for a room
router.get('/queue/status',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  queueController.getQueueStatus
);

// Call a record (assign queue number and start)
router.post('/:recordId/call',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  recordIdValidation,
  validate,
  queueController.callRecord
);

// Complete a record
router.post('/:recordId/complete',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordIdValidation,
  validate,
  queueController.completeRecord
);

// Cancel a record
router.post('/:recordId/cancel',
  authenticate,
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']),
  recordIdValidation,
  validate,
  queueController.cancelRecord
);

// ========== Record Management Routes ==========
// List all records with filters
router.get('/', 
  authenticate,
  listRecordsValidation,
  validate,
  recordController.getAll
);

// Search records
router.get('/search',
  authenticate,
  searchRecordsValidation,
  validate,
  recordController.search
);

// Get statistics
router.get('/statistics',
  authenticate,
  authorize(['admin', 'manager']),
  statisticsValidation,
  validate,
  recordController.getStatistics
);

// Get records by patient
router.get('/patient/:patientId',
  authenticate,
  patientIdValidation,
  validate,
  recordController.getByPatient
);

// ✅ Get unused services from exam records (for booking service selection)
router.get('/patient/:patientId/unused-services',
  authenticate,
  patientIdValidation,
  validate,
  recordController.getUnusedServices
);

// 🆕 Get treatment indications for a patient and service
router.get('/patient/:patientId/treatment-indications',
  authenticate,
  patientIdValidation,
  validate,
  recordController.getTreatmentIndications
);

// Get records by dentist
router.get('/dentist/:dentistId',
  authenticate,
  dentistIdValidation,
  validate,
  recordController.getByDentist
);

// Get pending records
router.get('/status/pending',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordController.getPending
);

// Get record by code
router.get('/code/:code',
  authenticate,
  recordCodeValidation,
  validate,
  recordController.getByCode
);

// Get record by ID
router.get('/:id',
  authenticate,
  recordIdValidation,
  validate,
  recordController.getById
);

// Create new record
router.post('/',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  createRecordValidation,
  validate,
  recordController.create
);

// Update record status
router.patch('/:id/status',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateStatusValidation,
  validate,
  recordController.updateStatus
);

// Add prescription to record
router.post('/:id/prescription',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  addPrescriptionValidation,
  validate,
  recordController.addPrescription
);

// Update treatment indication
router.patch('/:id/indications/:indicationId',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateTreatmentIndicationValidation,
  validate,
  recordController.updateTreatmentIndication
);

// Complete record
router.patch('/:id/complete',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.complete
);

// Update record
router.put('/:id',
  authenticate,
  authorize(['dentist', 'admin', 'manager']),
  updateRecordValidation,
  validate,
  recordController.update
);

// Delete record
router.delete('/:id',
  authenticate,
  authorize(['admin', 'manager']),
  recordIdValidation,
  validate,
  recordController.delete
);

module.exports = router;

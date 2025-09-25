const express = require('express');
const router = express.Router();

// Import controller
const recordController = require('../controllers/record.controller');

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

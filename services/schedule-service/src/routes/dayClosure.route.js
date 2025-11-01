const express = require('express');
const router = express.Router();
const dayClosureController = require('../controllers/dayClosure.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(authMiddleware);

/**
 * @route GET /api/day-closure
 * @desc Get all day closure records with filters
 * @query startDate, endDate, status, roomId, page, limit
 */
router.get('/', dayClosureController.getDayClosures);

/**
 * @route GET /api/day-closure/stats
 * @desc Get statistics for day closures
 * @query startDate, endDate
 */
router.get('/stats', dayClosureController.getDayClosureStats);

/**
 * @route GET /api/day-closure/:id
 * @desc Get day closure details by ID
 */
router.get('/:id', dayClosureController.getDayClosureById);

/**
 * @route GET /api/day-closure/patients/all
 * @desc Get all cancelled patients with filters (must be before /:id route)
 * @query startDate, endDate, roomId, dentistId, patientName, page, limit
 */
router.get('/patients/all', dayClosureController.getAllCancelledPatients);

/**
 * @route GET /api/day-closure/:id/patients
 * @desc Get cancelled patients for a specific closure
 */
router.get('/:id/patients', dayClosureController.getCancelledPatients);

module.exports = router;

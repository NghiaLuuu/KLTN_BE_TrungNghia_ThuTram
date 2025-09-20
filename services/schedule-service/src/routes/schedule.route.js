const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Generate quarter schedule for all rooms
router.post('/quarter', authMiddleware, scheduleController.generateQuarterSchedule);

// Get available quarters 
router.get('/quarters/available', scheduleController.getAvailableQuarters);

// Get quarter status
router.get('/quarter/status', scheduleController.getQuarterStatus);

// Get schedules by room and date range
router.get('/room/:roomId', scheduleController.getSchedulesByRoom);

// Get schedules by date range (all rooms)
router.get('/', scheduleController.getSchedulesByDateRange);

// Toggle schedule active/inactive (manager/admin)
router.patch('/:id/active', authMiddleware, scheduleController.toggleScheduleActive);



// Note: routes below were removed because their controller handlers were deleted.
// If you need these endpoints, implement the corresponding controller functions
// in `src/controllers/schedule.controller.js` and re-enable them here.

module.exports = router;

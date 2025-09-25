const express = require('express');
const router = express.Router();
const autoScheduleController = require('../controllers/autoSchedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Simulate auto-generation with custom date (for testing)
router.post('/simulate', authMiddleware, autoScheduleController.simulateAutoGeneration);

// Test simulate without auth (for development only)
router.post('/test-simulate', autoScheduleController.simulateAutoGeneration);

// Configuration management
router.get('/config', authMiddleware, autoScheduleController.getConfig);
router.patch('/toggle', authMiddleware, autoScheduleController.toggleAutoSchedule);

module.exports = router;
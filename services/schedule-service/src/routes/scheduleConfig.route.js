const express = require('express');
const router = express.Router();
const cfgController = require('../controllers/scheduleConfig.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const validationErrorHandler = require('../middlewares/validation.middleware');
const { createHolidayValidation, updateHolidayValidation, holidayIdValidation } = require('../validations/holiday.validation');

// 🔹 Configuration Status Check
router.get('/exists', cfgController.checkConfigExists);

// 🔹 Initialize Configuration (first time setup)
router.post('/initialize', authMiddleware, cfgController.initializeConfig);

// 🔹 Main Configuration Management
router.get('/', cfgController.getConfig);
router.patch('/', authMiddleware, cfgController.updateConfig);

// 🔹 Holiday Management
router.get('/holidays', cfgController.getHolidays);
router.get('/holidays/blocked-ranges', cfgController.getBlockedDateRanges); // 🆕 Get blocked date ranges
router.patch('/holidays/:holidayId', authMiddleware, updateHolidayValidation, validationErrorHandler, cfgController.updateHoliday);
router.post('/holidays', authMiddleware, createHolidayValidation, validationErrorHandler, cfgController.addHoliday);
router.post('/holidays/bulk', authMiddleware, cfgController.addHolidays); // 🆕 Nhiệm vụ 2.1: Bulk create
router.delete('/holidays/:holidayId', authMiddleware, holidayIdValidation, validationErrorHandler, cfgController.removeHoliday);

module.exports = router;
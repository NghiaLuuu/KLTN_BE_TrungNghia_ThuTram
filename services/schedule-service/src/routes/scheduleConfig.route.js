const express = require('express');
const router = express.Router();
const cfgController = require('../controllers/scheduleConfig.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// 🔹 Configuration Status Check
router.get('/exists', cfgController.checkConfigExists);

// 🔹 Initialize Configuration (first time setup)
router.post('/initialize', authMiddleware, cfgController.initializeConfig);

// 🔹 Main Configuration Management
router.get('/', cfgController.getConfig);
router.patch('/', authMiddleware, cfgController.updateConfig);

// 🔹 Holiday Management
router.get('/holidays', cfgController.getHolidays);
router.patch('/holidays/:holidayId', authMiddleware, cfgController.updateHoliday);
router.post('/holidays', authMiddleware, cfgController.addHoliday);
router.delete('/holidays/:holidayId', authMiddleware, cfgController.removeHoliday);

module.exports = router;
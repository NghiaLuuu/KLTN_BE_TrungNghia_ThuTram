const express = require('express');
const router = express.Router();
const cfgController = require('../controllers/scheduleConfig.controller');
const authMiddleware = require('../middlewares/auth.middleware');
const validationErrorHandler = require('../middlewares/validation.middleware');
const { createHolidayValidation, updateHolidayValidation, holidayIdValidation } = require('../validations/holiday.validation');

// 🔹 Kiểm tra Trạng thái Cấu hình
router.get('/exists', cfgController.checkConfigExists);

// 🔹 Khởi tạo Cấu hình (thiết lập lần đầu)
router.post('/initialize', authMiddleware, cfgController.initializeConfig);

// 🔹 Quản lý Cấu hình Chính
router.get('/', cfgController.getConfig);
router.patch('/', authMiddleware, cfgController.updateConfig);

// 🔹 Quản lý Ngày nghỉ
router.get('/holidays', cfgController.getHolidays);
// router.get('/holidays/blocked-ranges', cfgController.getBlockedDateRanges); // ❌ REMOVED: Không cần check lịch đã tạo
router.patch('/holidays/:holidayId', authMiddleware, updateHolidayValidation, validationErrorHandler, cfgController.updateHoliday);
router.post('/holidays', authMiddleware, createHolidayValidation, validationErrorHandler, cfgController.addHoliday);
router.post('/holidays/bulk', authMiddleware, cfgController.addHolidays); // 🆕 Nhiệm vụ 2.1: Bulk create
router.delete('/holidays/:holidayId', authMiddleware, holidayIdValidation, validationErrorHandler, cfgController.removeHoliday);

module.exports = router;
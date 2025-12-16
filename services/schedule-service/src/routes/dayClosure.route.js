const express = require('express');
const router = express.Router();
const dayClosureController = require('../controllers/dayClosure.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Tất cả routes đều yêu cầu xác thực
router.use(authMiddleware);

/**
 * @route GET /api/day-closure
 * @desc Lấy tất cả bản ghi đóng cửa theo ngày với bộ lọc
 * @query startDate, endDate, status, roomId, page, limit
 */
router.get('/', dayClosureController.getDayClosures);

/**
 * @route GET /api/day-closure/stats
 * @desc Lấy thống kê cho đóng cửa theo ngày
 * @query startDate, endDate
 */
router.get('/stats', dayClosureController.getDayClosureStats);

/**
 * @route GET /api/day-closure/patients/all
 * @desc Lấy tất cả bệnh nhân bị hủy với bộ lọc
 * @query startDate, endDate, roomId, dentistId, patientName, page, limit
 * @important PHẢI đặt trước routes /:id và /:id/patients để tránh khớp 'patients' như ID
 */
router.get('/patients/all', dayClosureController.getAllCancelledPatients);

/**
 * @route GET /api/day-closure/:id
 * @desc Lấy chi tiết đóng cửa theo ngày bằng ID
 */
router.get('/:id', dayClosureController.getDayClosureById);

/**
 * @route GET /api/day-closure/:id/patients
 * @desc Lấy bệnh nhân bị hủy cho một lần đóng cửa cụ thể
 */
router.get('/:id/patients', dayClosureController.getCancelledPatients);

module.exports = router;

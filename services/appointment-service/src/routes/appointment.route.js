// routes/appointment.route.js
const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Tạo booking tạm (hold)
router.post('/hold', authMiddleware, appointmentController.createHold);

// Xác nhận từ holdKey/slotId
router.patch('/:slotId/confirm', authMiddleware, appointmentController.confirm);

// Hủy booking tạm
router.patch('/:slotId/cancel-hold', authMiddleware, appointmentController.cancelHold);

// Cập nhật appointment
router.put('/:id', authMiddleware, appointmentController.update);

// Check-in (appointmentId trong DB)
router.patch('/:id/check-in', authMiddleware, appointmentController.checkIn);

// Hoàn tất (appointmentId trong DB)
router.patch('/:id/complete', authMiddleware, appointmentController.complete);

// Tìm kiếm (trong DB)
router.get('/', authMiddleware, appointmentController.search);

module.exports = router;

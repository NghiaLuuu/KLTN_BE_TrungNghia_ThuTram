const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Tạo mới slot
router.post('/', authMiddleware, slotController.createSlot);

// Cài đặt thời lượng
router.put('/:id/duration', authMiddleware, slotController.setDuration);

// Cập nhật trạng thái
router.put('/:id/status', authMiddleware, slotController.updateStatus);

// Cập nhật thông tin slot
router.put('/:id', authMiddleware, slotController.updateInfo);

// Lấy danh sách slot
router.get('/', authMiddleware, slotController.getSlots);

// Lấy chi tiết slot
router.get('/:id', authMiddleware, slotController.getSlotById);

// Xóa slot
router.delete('/:id', authMiddleware, slotController.deleteSlot);

module.exports = router;

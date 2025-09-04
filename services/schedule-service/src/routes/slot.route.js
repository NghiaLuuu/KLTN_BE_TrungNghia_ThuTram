const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');

// POST /api/slots/assign-staff
router.post('/assign-staff', slotController.assignStaff);

// Lấy danh sách slot (có thể filter bằng query params: scheduleId, subRoomId, date, status...)
router.get('/', slotController.getSlots);

// Lấy chi tiết slot theo id
router.get('/:id', slotController.getSlotById);

// Gán nha sỹ, y tá vào 1 hay nhiều slot (có thể chọn slot)
router.post('/manual-assign', slotController.assignStaffToSlots);

// Hủy 1 hoặc nhiều hoặc toàn bộ slot của nha sĩ hoặc y tá
router.post('/cancel', slotController.cancelSlots);


module.exports = router;

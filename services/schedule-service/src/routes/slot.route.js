const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Assign staff to slots by schedule (QUÝ) — request MUST include scheduleId
// Request body example: { scheduleId, roomId, subRoomId?, shifts: ['Ca Sáng'], dentistIds: [], nurseIds: [] }
router.post('/assign-staff', authMiddleware, slotController.assignStaffToSlots);

// Update staff for single or multiple slots
router.patch('/staff', authMiddleware, slotController.updateSlotStaff);

// Get slots by shift and date for easy slot selection
router.get('/by-shift', slotController.getSlotsByShiftAndDate);

// Get room schedule with appointment counts (daily/weekly/monthly view)
router.get('/room/:roomId/calendar', slotController.getRoomCalendar);

module.exports = router;

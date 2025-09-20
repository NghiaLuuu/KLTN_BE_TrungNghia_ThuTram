const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Assign staff to slots by schedule (QUÝ) — request MUST include scheduleId
// Request body example: { scheduleId, roomId, subRoomId?, shifts: ['Ca Sáng'], dentistIds: [], nurseIds: [] }
router.post('/assign-staff', authMiddleware, slotController.assignStaffToSlots);

// Update staff for specific slot or multiple slots
// To update many slots atomically, provide `groupSlotIds` in the body: { groupSlotIds: [..], dentistId?, nurseId? }
router.patch('/:slotId/staff', authMiddleware, slotController.updateSlotStaff);

// Get available slots for booking
router.get('/available', slotController.getAvailableSlots);

// Get slots by room and date range
router.get('/room/:roomId', slotController.getSlotsByRoom);

// Get slots by staff and date range
router.get('/staff/:staffId/:staffType', slotController.getSlotsByStaff);

module.exports = router;

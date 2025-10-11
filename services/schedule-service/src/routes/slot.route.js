const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Assign staff to slots by schedule (QUÝ) — request MUST include scheduleId
// Request body example: { scheduleId, roomId, subRoomId?, shifts: ['Ca Sáng'], dentistIds: [], nurseIds: [] }
router.post('/assign-staff', authMiddleware, slotController.assignStaffToSlots);

// Reassign staff to already assigned slots by schedule (QUÝ) — only works on slots that already have staff
// Request body example: { roomId, subRoomId?, quarter, year, shifts: ['Ca Sáng'], dentistIds: [], nurseIds: [] }
router.post('/reassign-staff', authMiddleware, slotController.reassignStaffToSlots);

// Update staff for single or multiple slots
router.patch('/staff', authMiddleware, slotController.updateSlotStaff);

// Get slots by shift and date for easy slot selection
router.get('/by-shift', slotController.getSlotsByShiftAndDate);

// Get room schedule with appointment counts (daily/weekly/monthly view)
router.get('/room/:roomId/calendar', slotController.getRoomCalendar);

// Get dentist schedule with appointment counts (daily/weekly/monthly view) with historical support
router.get('/dentist/:dentistId/calendar', slotController.getDentistCalendar);

// Get nurse schedule with appointment counts (daily/weekly/monthly view) with historical support
router.get('/nurse/:nurseId/calendar', slotController.getNurseCalendar);

// Get available quarters and years for staff assignment
router.get('/available-quarters', slotController.getAvailableQuartersYears);

// Get available work shifts
router.get('/available-shifts', slotController.getAvailableShifts);

// ⭐ NEW: Get slot details for specific room/day/shift
router.get('/room/:roomId/details', slotController.getRoomSlotDetails);

// ⭐ NEW: Get slot details for specific dentist/day/shift
router.get('/dentist/:dentistId/details', slotController.getDentistSlotDetails);

// ⭐ NEW: Get slot details for specific nurse/day/shift
router.get('/nurse/:nurseId/details', slotController.getNurseSlotDetails);

// 🆕 Check if staff members have future schedules
router.post('/check-has-schedule', slotController.checkStaffHasSchedule);

module.exports = router;

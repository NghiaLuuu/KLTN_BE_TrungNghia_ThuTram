const express = require('express');
const router = express.Router();
const slotController = require('../controllers/slot.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ⭐ Assign staff to specific slots
// Request body example: { slotIds: ['slot1', 'slot2'], roomId, subRoomId?, dentistIds: [], nurseIds: [] }
router.post('/assign-staff', authMiddleware, slotController.assignStaffToSlots);

// ⭐ Reassign staff (replace old staff with new staff in specific slots)
// Request body example: { slotIds: ['slot1', 'slot2'], oldStaffId, newStaffId, role: 'dentist' | 'nurse' }
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

// Get available work shifts
router.get('/available-shifts', slotController.getAvailableShifts);

// 🆕 Get FUTURE slot details for specific room/day/shift (for staff assignment)
router.get('/room/:roomId/details/future', slotController.getRoomSlotDetailsFuture);

// 🆕 Get FUTURE slot details for specific dentist/day/shift (for staff replacement)
router.get('/dentist/:dentistId/details/future', slotController.getDentistSlotDetailsFuture);

// 🆕 Get FUTURE slot details for specific nurse/day/shift (for staff replacement)
router.get('/nurse/:nurseId/details/future', slotController.getNurseSlotDetailsFuture);

// 🆕 Check if staff members have future schedules
router.post('/check-has-schedule', slotController.checkStaffHasSchedule);

// 🆕 PATIENT BOOKING APIs
// Get dentists with nearest available slot (> currentTime + 30 minutes)
router.get('/dentists-with-nearest-slot', slotController.getDentistsWithNearestSlot);

// Get dentist working dates within maxBookingDays from today
router.get('/dentist/:dentistId/working-dates', slotController.getDentistWorkingDates);

// 🆕 Bulk update slots (for appointment service to update booked status)
router.put('/bulk-update', slotController.bulkUpdateSlots);

// 🆕 Get slot by ID (for inter-service communication)
// ⚠️ IMPORTANT: This route MUST be last because it's a catch-all pattern
// Place all specific routes ABOVE this line
router.get('/:slotId', slotController.getSlotById);

module.exports = router;

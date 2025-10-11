const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// ❌ DEPRECATED: Quarter-based schedule generation (commented out)
// router.post('/quarter', authMiddleware, scheduleController.generateQuarterSchedule);
// router.get('/quarters/available', scheduleController.getAvailableQuarters);
// router.get('/room/:roomId/quarters/status', scheduleController.checkQuartersStatus);
// router.get('/quarter/status', scheduleController.getQuarterStatus);

// 🆕 Manual schedule generation for specific room with shift selection (MONTHLY RANGE)
router.post('/room/generate', authMiddleware, scheduleController.generateRoomSchedule);

// 🆕 Get holiday preview for schedule creation
router.get('/holiday-preview', scheduleController.getHolidayPreview);

// 🆕 Get room schedules with shift info (for create schedule UI) - MUST BE BEFORE /room/:roomId
router.get('/room/:roomId/shifts', scheduleController.getRoomSchedulesWithShifts);

// 🆕 Get schedule summary by room (for staff assignment) - MUST BE BEFORE /room/:roomId
router.get('/room/:roomId/summary', scheduleController.getScheduleSummaryByRoom);

// Get schedules by room and date range - MUST BE AFTER specific paths
router.get('/room/:roomId', scheduleController.getSchedulesByRoom);

// Get schedules by date range (all rooms)
router.get('/', scheduleController.getSchedulesByDateRange);

// Toggle schedule active/inactive (manager/admin)
router.patch('/:id/active', authMiddleware, scheduleController.toggleScheduleActive);

// 🆕 Get rooms with schedule summary (for staff assignment list)
router.get('/rooms-summary', scheduleController.getRoomsWithScheduleSummary);

// 🆕 Get slots by shift for calendar view (monthly)
router.get('/slots/shift-calendar', scheduleController.getSlotsByShiftCalendar);

// 🆕 STAFF ASSIGNMENT APIs
// Get rooms for staff assignment (with shift summary)
router.get('/staff-assignment/rooms', scheduleController.getRoomsForStaffAssignment);

// Get shift calendar for assignment (click vào ca)
router.get('/staff-assignment/shift-calendar', scheduleController.getShiftCalendarForAssignment);

// Get slots for a specific day (click vào ngày)
router.get('/staff-assignment/slots/day', scheduleController.getSlotsByDayAndShift);

// Assign staff to single slot (manager/admin)
router.patch('/staff-assignment/slots/:slotId/assign', authMiddleware, scheduleController.assignStaffToSlot);

// Bulk assign staff to multiple slots (manager/admin)
router.post('/staff-assignment/slots/bulk-assign', authMiddleware, scheduleController.bulkAssignStaff);

// 🆕 NEW: APIs for Unified Staff Assignment and Replacement
// Get room schedule shifts (ca đã có lịch)
router.get('/room-shifts', scheduleController.getRoomScheduleShifts);

// Get staff availability with conflict checking
router.get('/staff-availability', scheduleController.getStaffAvailabilityForShift);

// Get staff schedule (lịch làm việc của nhân sự)
router.get('/staff-schedule', scheduleController.getStaffSchedule);

// Get available replacement staff (with conflict checking)
router.post('/replacement-staff', scheduleController.getAvailableReplacementStaff);

// Replace staff (manager/admin)
router.post('/replace-staff', authMiddleware, scheduleController.replaceStaff);

module.exports = router;

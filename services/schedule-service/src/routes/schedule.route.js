const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware,scheduleController.createSchedule);
router.put('/:id', authMiddleware,scheduleController.updateSchedule);
router.patch('/:id/toggle', authMiddleware, scheduleController.toggleStatus);
router.get('/', scheduleController.getSchedules);

// Lấy lịch subRoom theo tuần / tháng
// GET /api/schedules/subroom?subRoomId=xxx&range=week
router.get('/subroom', scheduleController.getSubRoomSchedule);

//schedule/staff?staffId=...&range=week&page=1
router.get('/staff', scheduleController.getStaffSchedule);

router.get('/:id/slots', scheduleController.getScheduleSlots);
router.get('/:id', scheduleController.getScheduleDetail);
router.get('/summary/:roomId', scheduleController.getRoomSchedulesSummary);

module.exports = router;

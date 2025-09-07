const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware,scheduleController.createSchedule);
router.put('/:id', authMiddleware,scheduleController.updateSchedule);
router.patch('/:id/toggle', authMiddleware, scheduleController.toggleStatus);
router.get('/', scheduleController.getSchedules);

router.get('/:id/slots', scheduleController.getScheduleSlots);
router.get('/:id', scheduleController.getScheduleDetail);


module.exports = router;

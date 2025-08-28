const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware,scheduleController.createSchedule);
router.put('/:id', authMiddleware,scheduleController.updateSchedule);
router.patch('/:id/toggle', authMiddleware, scheduleController.toggleStatus);
router.post('/:scheduleId/subrooms/:subRoomId/slots', authMiddleware, scheduleController.createSlotsForSubRoom);


module.exports = router;

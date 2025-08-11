const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/schedule.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.post('/', authMiddleware,scheduleController.createSchedule);
router.put('/:id', authMiddleware,scheduleController.updateSchedule);
router.patch('/:id/toggle', authMiddleware, scheduleController.toggleStatus);
router.get('/by-staff', authMiddleware,scheduleController.viewByStaff);
router.post('/:id/assign-staff', authMiddleware,scheduleController.assignStaffToShift);
router.post('/generate-recurring', authMiddleware,scheduleController.generateRecurring);

module.exports = router;

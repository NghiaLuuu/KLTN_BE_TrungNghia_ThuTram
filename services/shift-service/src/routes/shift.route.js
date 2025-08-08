const express = require('express');
const router = express.Router();
const shiftController = require('../controllers/shift.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Các route yêu cầu xác thực và phân quyền
router.post('/', authMiddleware, shiftController.createShift);
router.put('/:id', authMiddleware, shiftController.updateShift);
router.patch('/:id/toggle', authMiddleware, shiftController.toggleStatus);

// Các route công khai
router.get('/', shiftController.listShifts);
router.get('/search', shiftController.searchShift);

module.exports = router;

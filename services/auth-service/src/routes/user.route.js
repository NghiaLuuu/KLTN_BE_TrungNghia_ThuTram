const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.get('/profile', authMiddleware, userController.getProfile);

router.put('/profile', authMiddleware, userController.updateProfile);

router.put('/update/:id', authMiddleware, userController.updateProfileByAdmin);

router.get('/by-role',authMiddleware,userController.getUsersByRole);

router.get('/all-staff', authMiddleware, userController.getAllStaff);

router.get('/staff/search', authMiddleware, userController.searchStaff);

// Lấy user theo id
router.get('/:id', authMiddleware, userController.getUserById);

module.exports = router;

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middlewares/auth.middleware');

router.get('/profile', authMiddleware, userController.getProfile);

router.put('/profile', authMiddleware, userController.updateProfile);

router.get('/by-role',authMiddleware,userController.getUsersByRole);

router.get('/all-staff', authMiddleware, userController.getAllStaff);

module.exports = router;

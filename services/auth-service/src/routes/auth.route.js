const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// Auth routes
router.post('/send-otp-register', authController.sendOtpRegister);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authMiddleware, authController.logout);
router.post('/refresh', authController.refresh);
router.post('/send-otp-reset-password', authController.sendOtpResetPassword);
router.post('/change-password', authMiddleware, authController.changePassword);
router.post('/reset-password', authController.resetPassword);


module.exports = router;

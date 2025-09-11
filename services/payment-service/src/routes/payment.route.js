const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const authMiddleware = require('../middlewares/auth.middleware');

// 🔹 Tạo thanh toán mới
router.post('/', paymentController.createPayment);

// 🔹 Staff confirm thanh toán thủ công
router.post('/:id/manual-confirm', authMiddleware, paymentController.manualConfirmPayment);

// 🔹 Xác nhận thanh toán qua Redis + RPC
router.post('/:id/confirm-rpc', paymentController.confirmPaymentRPC);

// 🔹 Xem chi tiết 1 payment
router.get('/:id', paymentController.getPaymentById);

// 🔹 Xem danh sách thanh toán
router.get('/', paymentController.listPayments);

// 🔹 Webhook từ MoMo (IPN / notify)
router.post('/momo-webhook', paymentController.momoWebhook);

// 🔹 MoMo return
router.get('/momo-return', paymentController.momoReturn);

module.exports = router;

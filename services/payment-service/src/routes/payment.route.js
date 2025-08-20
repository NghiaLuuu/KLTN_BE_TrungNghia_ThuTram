const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');

// Tạo thanh toán mới
router.post('/', paymentController.createPayment);

// Xác nhận thanh toán trực tiếp (DB)
router.post('/:id/confirm', paymentController.confirmPayment);

// ✅ Xác nhận thanh toán qua Redis + RPC
router.post('/:id/confirm-rpc', paymentController.confirmPaymentRPC);

// Xem danh sách thanh toán
router.get('/', paymentController.listPayments);

// Xem chi tiết 1 payment
router.get('/:id', paymentController.getPaymentById);

module.exports = router;

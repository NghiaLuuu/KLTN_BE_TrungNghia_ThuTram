const paymentService = require('../services/payment.service');
const redis = require('../utils/redis.client');
const crypto = require('crypto');
const { generateMoMoSignature } = require('../utils/momo.utils');
class PaymentController {
  async createPayment(req, res) {
    try {
      const payment = await paymentService.createPayment(req.body);
      res.status(201).json(payment);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }

  async confirmPayment(req, res) {
    try {
      const payment = await paymentService.confirmPayment(req.params.id);
      if (!payment) return res.status(404).json({ message: 'Payment not found' });
      res.json(payment);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }

  async confirmPaymentRPC(req, res) {
    try {
      const payment = await paymentService.confirmPaymentRPC({ id: req.params.id });
      res.json(payment);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }

  async listPayments(req, res) {
    try {
      const payments = await paymentService.listPayments(req.query);
      res.json(payments);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }

  async getPaymentById(req, res) {
    try {
      const data = await paymentService.getPaymentById(req.params.id);
      return res.json(data);
    } catch (err) {
      return res.status(400).json({ message: err.message });
    }
  }

  // MoMo webhook
  async momoWebhook(req, res) {
  try {
    const data = req.body;
    console.log('💬 MoMo webhook payload:', data);

    const { orderId, amount, extraData, resultCode } = data;
    if (!extraData) return res.status(400).send('Missing extraData');

    // 1️⃣ Lấy temp payment từ Redis
    const tempPaymentId = extraData;
    const tempDataRaw = await redis.get(tempPaymentId);
    if (!tempDataRaw) {
      console.warn(`❌ Temp payment not found for key ${tempPaymentId}`);
      return res.status(404).send('Temp payment not found');
    }

    // 2️⃣ Xử lý payment
    if (resultCode === 0) {
      const savedPayment = await paymentService.confirmPaymentRPC({ id: tempPaymentId });
      await redis.del(tempPaymentId);
      return res.json({ message: 'Payment success', orderId, paymentId: savedPayment._id });
    } else {
      await redis.del(tempPaymentId);
      return res.json({ message: 'Payment failed', orderId });
    }
  } catch (err) {
    console.error('MoMo webhook error:', err);
    return res.status(500).send('Error');
  }
}

async momoReturn(req, res) {
  res.send('Thank you! Payment process finished. Please check your order status.');
}





}

module.exports = new PaymentController();

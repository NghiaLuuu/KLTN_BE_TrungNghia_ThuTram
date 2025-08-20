const paymentService = require('../services/payment.service');

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

  // ✅ Confirm thông qua RPC (Redis -> DB + Appointment confirm)
  async confirmPaymentRPC(req, res) {
    try {
      const payment = await paymentService.confirmPaymentRPC({
        id: req.params.id
      });
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
      const payment = await paymentService.getPaymentById(req.params.id);
      if (!payment) return res.status(404).json({ message: 'Payment not found' });
      res.json(payment);
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
}

module.exports = new PaymentController();

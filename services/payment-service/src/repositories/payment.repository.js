const { Payment } = require('../models/payment.model');

class PaymentRepository {
  async create(data) {
    return await Payment.create(data);
  }

  async findById(id) {
    return await Payment.findById(id)
  }

  async update(id, data) {
    return await Payment.findByIdAndUpdate(id, data, { new: true });
  }

  async find(filter = {}) {
    return await Payment.find(filter)
  }
}

module.exports = new PaymentRepository();

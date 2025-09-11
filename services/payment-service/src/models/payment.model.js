const mongoose = require('mongoose');

const PaymentMethod = {
  CASH: 'cash',
  MOMO: 'momo',
  ZALO: 'zalo',
  VNPAY: 'vnpay',
  BANK_TRANSFER: 'bank_transfer'
};

const PaymentStatus = {
  COMPLETED: 'completed',
  REFUNDED: 'refunded',
  PENDING: 'pending'
};

const paymentSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  method: {
    type: String,
    enum: Object.values(PaymentMethod),
    required: true
  },
  paymentTime: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING
  },
  appointmentCode: {
    type: String,   // mã appointment liên kết
    default: null
  }
}, {
  timestamps: true
});

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = {
  Payment,
  PaymentMethod,
  PaymentStatus
};

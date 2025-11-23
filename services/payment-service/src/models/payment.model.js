const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Constants
const PaymentMethod = {
  CASH: 'cash',
  VNPAY: 'vnpay',
  VISA: 'visa',
  STRIPE: 'stripe'
};

const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  PARTIAL_REFUND: 'partial_refund',
  EXPIRED: 'expired'
};

const PaymentType = {
  PAYMENT: 'payment',
  REFUND: 'refund',
  ADJUSTMENT: 'adjustment',
  DEPOSIT: 'deposit',
  INSURANCE_CLAIM: 'insurance_claim'
};

// Counter for payment code generation
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

// Digital Wallet Info Schema (VNPay only)
const digitalWalletInfoSchema = new Schema({
  walletType: {
    type: String,
    enum: ['vnpay']
  },
  walletAccountId: {
    type: String,
    trim: true
  },
  transactionId: {
    type: String,
    trim: true
  }
}, { _id: false });

// Card Info Schema (VISA)
const cardInfoSchema = new Schema({
  cardType: {
    type: String,
    enum: ['visa', 'mastercard'],
    default: 'visa'
  },
  cardLast4: {
    type: String,
    required: true,
    match: /^\d{4}$/
  },
  cardHolder: {
    type: String,
    required: true,
    trim: true
  },
  authorizationCode: {
    type: String,
    trim: true
  },
  transactionId: {
    type: String,
    required: true,
    trim: true
  }
}, { _id: false });

// Main Payment Schema
const paymentSchema = new Schema({
  paymentCode: {
    type: String,
    unique: true
    // ⚠️ Don't set required: true - it will be auto-generated in pre-save hook
  },
  
  // Reference information
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  recordId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // Patient information
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  patientInfo: {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    phone: {
      type: String,
      required: true,
      match: /^[0-9]{10,11}$/
    },
    email: {
      type: String,
      trim: true,
      lowercase: true
    },
    address: {
      type: String,
      trim: true,
      maxlength: 200
    }
  },
  
  // Payment details
  type: {
    type: String,
    enum: Object.values(PaymentType),
    required: true,
    default: PaymentType.PAYMENT
  },
  method: {
    type: String,
    enum: Object.values(PaymentMethod),
    required: false,
    default: null // ✅ Allow null - Receptionist will choose method later
  },
  status: {
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING
  },
  
  // Financial information
  originalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  depositAmount: {
    type: Number,
    min: 0,
    default: 0,
    comment: 'Số tiền cọc từ đặt lịch online (nếu có)'
  },
  discountAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  taxAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  finalAmount: {
    type: Number,
    required: true,
    min: 0,
    comment: 'Số tiền phải thanh toán = originalAmount - depositAmount - discountAmount + taxAmount'
  },
  paidAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  changeAmount: {
    type: Number,
    min: 0,
    default: 0
  },
  
  // Payment method specific information
  digitalWalletInfo: digitalWalletInfoSchema, // VNPay only
  cardInfo: cardInfoSchema, // VISA/Mastercard
  
  // Stripe specific fields
  stripeSessionId: {
    type: String,
    trim: true
  },
  stripePaymentIntentId: {
    type: String,
    trim: true
  },
  stripePaymentStatus: {
    type: String,
    trim: true
  },
  paymentUrl: {
    type: String,
    trim: true,
    comment: 'Payment URL for Stripe checkout or VNPay redirect'
  },
  
  // Transaction details
  externalTransactionId: {
    type: String,
    trim: true
  },
  gatewayResponse: {
    responseCode: String,
    responseMessage: String,
    additionalData: Schema.Types.Mixed
  },
  
  // Processing information
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  processedByName: {
    type: String,
    required: true,
    trim: true
  },
  processedAt: {
    type: Date,
    default: Date.now
  },
  
  // Refund information
  refundReason: {
    type: String,
    trim: true,
    maxlength: 500
  },
  refundedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  refundedAt: {
    type: Date
  },
  originalPaymentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  },
  
  // Notes and descriptions
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  verifiedAt: {
    type: Date
  },
  
  // Timestamps
  dueDate: {
    type: Date
  },
  completedAt: {
    type: Date
  },
  cancelledAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance (paymentCode already unique)
paymentSchema.index({ appointmentId: 1 });
paymentSchema.index({ invoiceId: 1 });
paymentSchema.index({ patientId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ method: 1 });
paymentSchema.index({ type: 1 });
paymentSchema.index({ processedAt: -1 });
paymentSchema.index({ 'patientInfo.phone': 1 });
paymentSchema.index({ createdAt: -1 });

// Virtual fields
paymentSchema.virtual('remainingAmount').get(function() {
  return this.finalAmount - this.paidAmount;
});

paymentSchema.virtual('isFullyPaid').get(function() {
  return this.paidAmount >= this.finalAmount;
});

paymentSchema.virtual('isOverpaid').get(function() {
  return this.paidAmount > this.finalAmount;
});

paymentSchema.virtual('discountPercentage').get(function() {
  if (this.originalAmount === 0) return 0;
  return (this.discountAmount / this.originalAmount) * 100;
});

// Pre-save middleware for payment code generation
paymentSchema.pre('save', async function(next) {
  if (this.isNew && !this.paymentCode) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'payment' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const sequence = String(counter.seq).padStart(4, '0');
      
      this.paymentCode = `PAY${year}${month}${day}${sequence}`;
    } catch (error) {
      return next(error);
    }
  }
  
  // Calculate final amount if not set
  if (!this.finalAmount && this.originalAmount !== undefined) {
    this.finalAmount = this.originalAmount - this.depositAmount - this.discountAmount + this.taxAmount;
  }
  
  next();
});

// Static methods
paymentSchema.statics.findByCode = function(code) {
  return this.findOne({ paymentCode: code });
};

paymentSchema.statics.findByPatient = function(patientId, options = {}) {
  const query = { patientId };
  if (options.status) query.status = options.status;
  if (options.method) query.method = options.method;
  if (options.fromDate) query.processedAt = { $gte: options.fromDate };
  if (options.toDate) query.processedAt = { ...query.processedAt, $lte: options.toDate };
  
  return this.find(query).sort({ processedAt: -1 });
};

paymentSchema.statics.findByDateRange = function(startDate, endDate, options = {}) {
  const query = {
    processedAt: { $gte: startDate, $lte: endDate }
  };
  
  if (options.status) query.status = options.status;
  if (options.method) query.method = options.method;
  if (options.type) query.type = options.type;
  
  return this.find(query).sort({ processedAt: -1 });
};

// Instance methods
paymentSchema.methods.canBeRefunded = function() {
  return this.status === PaymentStatus.COMPLETED && this.type === PaymentType.PAYMENT;
};

paymentSchema.methods.canBeCancelled = function() {
  return [PaymentStatus.PENDING, PaymentStatus.PROCESSING].includes(this.status);
};

paymentSchema.methods.calculateRefundAmount = function(refundAmount) {
  if (refundAmount > this.paidAmount) {
    throw new Error('Số tiền hoàn trả không thể lớn hơn số tiền đã thanh toán');
  }
  return refundAmount;
};

// Export constants and model
module.exports = {
  Payment: mongoose.model('Payment', paymentSchema),
  PaymentMethod,
  PaymentStatus,
  PaymentType
};

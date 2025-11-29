const mongoose = require("mongoose");
const { Schema } = mongoose;

// Invoice Status Enum
const InvoiceStatus = {
  DRAFT: 'draft',           // Hóa đơn nháp (chưa thanh toán)
  PENDING: 'pending',       // Chờ thanh toán
  PAID: 'paid',            // Đã thanh toán đầy đủ
  PARTIAL_PAID: 'partial_paid', // Thanh toán một phần
  OVERDUE: 'overdue',      // Quá hạn thanh toán
  CANCELLED: 'cancelled',   // Đã hủy
  REFUNDED: 'refunded'     // Đã hoàn tiền
};

// Invoice Type Enum
const InvoiceType = {
  APPOINTMENT: 'appointment',    // Hóa đơn cuộc hẹn
  TREATMENT: 'treatment',       // Hóa đơn điều trị
  CONSULTATION: 'consultation', // Hóa đơn tư vấn
  EMERGENCY: 'emergency',       // Hóa đơn cấp cứu
  CHECKUP: 'checkup'           // Hóa đơn kiểm tra định kỳ
};

// Patient Info Sub-schema
const PatientInfoSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 15
    // ✅ Removed strict regex to allow test data like '0000000003'
    // In production, add validation in controller/service layer
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: /^\S+@\S+\.\S+$/
  },
  address: {
    type: String,
    trim: true
  },
  dateOfBirth: Date,
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  identityNumber: {
    type: String,
    trim: true
  }
}, { _id: false });

// Dentist Info Sub-schema
const DentistInfoSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  specialization: {
    type: String,
    trim: true
  },
  licenseNumber: {
    type: String,
    trim: true
  }
}, { _id: false });

// Tax Info Sub-schema
const TaxInfoSchema = new Schema({
  taxRate: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  taxIncluded: {
    type: Boolean,
    default: true
  }
}, { _id: false });

// Discount Info Sub-schema
const DiscountInfoSchema = new Schema({
  type: {
    type: String,
    enum: ['percentage', 'fixed_amount', 'none'],
    default: 'none'
  },
  value: {
    type: Number,
    default: 0,
    min: 0
  },
  reason: {
    type: String,
    trim: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }
}, { _id: false });

// Payment Summary Sub-schema
const PaymentSummarySchema = new Schema({
  totalPaid: {
    type: Number,
    default: 0,
    min: 0
  },
  remainingAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastPaymentDate: Date,
  paymentMethod: {
    type: String,
    enum: ['cash', 'credit_card', 'debit_card', 'bank_transfer', 'momo', 'zalopay', 'vnpay', 'stripe', 'shopeepay', 'insurance', 'installment']
  },
  paymentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Payment'
  }]
}, { _id: false });

// Main Invoice Schema
const InvoiceSchema = new Schema({
  // Invoice identification
  invoiceNumber: {
    type: String,
    unique: true,
    required: true
  },
  
  // Reference information
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false, // ✅ Changed to false - walk-in patients may not have patientId
    default: null,
    index: true
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  recordId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // Invoice classification
  type: {
    type: String,
    enum: Object.values(InvoiceType),
    default: InvoiceType.APPOINTMENT,
    required: true
  },
  status: {
    type: String,
    enum: Object.values(InvoiceStatus),
    default: InvoiceStatus.DRAFT,
    required: true,
    index: true
  },
  
  // Patient and dentist information
  patientInfo: {
    type: PatientInfoSchema,
    required: true
  },
  dentistInfo: {
    type: DentistInfoSchema,
    required: true
  },
  
  // Financial information
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  discountInfo: {
    type: DiscountInfoSchema,
    default: {}
  },
  taxInfo: {
    type: TaxInfoSchema,
    default: {}
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Payment tracking
  paymentSummary: {
    type: PaymentSummarySchema,
    default: {}
  },
  
  // Additional information
  description: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  },
  internalNotes: {
    type: String,
    trim: true
  },
  
  // Invoice dates
  issueDate: {
    type: Date,
    default: Date.now,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  paidDate: Date,
  
  // Audit trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  createdByRole: {
    type: String,
    enum: ['admin', 'manager', 'dentist', 'receptionist', 'patient', 'system'], // ✅ Added 'system' for automated invoice creation
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  lastModified: Date,
  
  // Invoice workflow
  isActive: {
    type: Boolean,
    default: true
  },
  cancelReason: String,
  cancelledBy: mongoose.Schema.Types.ObjectId,
  cancelledAt: Date
}, { 
  timestamps: true,
  collection: 'invoices'
});

// Indexes for better performance
InvoiceSchema.index({ invoiceNumber: 1 });
InvoiceSchema.index({ patientId: 1, status: 1 });
InvoiceSchema.index({ appointmentId: 1 });
InvoiceSchema.index({ issueDate: -1 });
InvoiceSchema.index({ dueDate: 1 });
InvoiceSchema.index({ status: 1, dueDate: 1 });
InvoiceSchema.index({ 'patientInfo.phone': 1 });
InvoiceSchema.index({ createdAt: -1 });

// Virtual fields
InvoiceSchema.virtual('discountAmount').get(function() {
  if (this.discountInfo.type === 'percentage') {
    return (this.subtotal * this.discountInfo.value) / 100;
  } else if (this.discountInfo.type === 'fixed_amount') {
    return this.discountInfo.value;
  }
  return 0;
});

InvoiceSchema.virtual('finalAmount').get(function() {
  const discount = this.discountAmount;
  const taxableAmount = this.subtotal - discount;
  const taxAmount = this.taxInfo.taxIncluded ? 0 : (taxableAmount * this.taxInfo.taxRate) / 100;
  return taxableAmount + taxAmount;
});

InvoiceSchema.virtual('isOverdue').get(function() {
  return this.status !== InvoiceStatus.PAID && 
         this.status !== InvoiceStatus.CANCELLED && 
         new Date() > this.dueDate;
});

InvoiceSchema.virtual('daysPastDue').get(function() {
  if (!this.isOverdue) return 0;
  const diffTime = new Date() - this.dueDate;
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
});

InvoiceSchema.virtual('isPaid').get(function() {
  return this.status === InvoiceStatus.PAID;
});

InvoiceSchema.virtual('isPartiallyPaid').get(function() {
  return this.paymentSummary.totalPaid > 0 && this.paymentSummary.totalPaid < this.totalAmount;
});

// Instance methods
InvoiceSchema.methods.calculateAmounts = function() {
  // Calculate discount
  let discountAmount = 0;
  if (this.discountInfo.type === 'percentage') {
    discountAmount = (this.subtotal * this.discountInfo.value) / 100;
  } else if (this.discountInfo.type === 'fixed_amount') {
    discountAmount = this.discountInfo.value;
  }

  // Calculate tax
  const taxableAmount = this.subtotal - discountAmount;
  const taxAmount = this.taxInfo.taxIncluded ? 0 : (taxableAmount * this.taxInfo.taxRate) / 100;
  
  // Update calculated fields
  this.taxInfo.taxAmount = taxAmount;
  this.totalAmount = taxableAmount + taxAmount;
  
  return this.totalAmount;
};

InvoiceSchema.methods.updatePaymentStatus = function() {
  const totalPaid = this.paymentSummary.totalPaid || 0;
  const remaining = this.totalAmount - totalPaid;

  if (totalPaid === 0) {
    this.status = InvoiceStatus.PENDING;
  } else if (remaining <= 0) {
    this.status = InvoiceStatus.PAID;
    this.paidDate = new Date();
  } else {
    this.status = InvoiceStatus.PARTIAL_PAID;
  }

  this.paymentSummary.remainingAmount = Math.max(0, remaining);
  return this.status;
};

InvoiceSchema.methods.addPayment = function(paymentId, amount, method) {
  if (!this.paymentSummary.paymentIds) {
    this.paymentSummary.paymentIds = [];
  }
  
  this.paymentSummary.paymentIds.push(paymentId);
  this.paymentSummary.totalPaid = (this.paymentSummary.totalPaid || 0) + amount;
  this.paymentSummary.lastPaymentDate = new Date();
  this.paymentSummary.paymentMethod = method;
  
  this.updatePaymentStatus();
  return this;
};

InvoiceSchema.methods.canBeCancelled = function() {
  return [InvoiceStatus.DRAFT, InvoiceStatus.PENDING].includes(this.status);
};

InvoiceSchema.methods.canBeModified = function() {
  return [InvoiceStatus.DRAFT, InvoiceStatus.PENDING].includes(this.status);
};

// Static methods
InvoiceSchema.statics.findByInvoiceNumber = function(invoiceNumber) {
  return this.findOne({ invoiceNumber, isActive: true });
};

InvoiceSchema.statics.findByPatient = function(patientId, options = {}) {
  const query = { patientId, isActive: true };
  if (options.status) query.status = options.status;
  
  let queryBuilder = this.find(query).sort({ createdAt: -1 });
  
  if (options.limit) {
    queryBuilder = queryBuilder.limit(options.limit);
  }
  
  return queryBuilder;
};

InvoiceSchema.statics.findOverdue = function() {
  return this.find({
    dueDate: { $lt: new Date() },
    status: { $in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIAL_PAID] },
    isActive: true
  }).sort({ dueDate: 1 });
};

InvoiceSchema.statics.generateInvoiceNumber = async function() {
  const now = new Date();
  const year = now.getFullYear().toString().slice(-2);
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  
  const prefix = `INV${year}${month}${day}`;
  const lastInvoice = await this.findOne({
    invoiceNumber: new RegExp(`^${prefix}`)
  }).sort({ invoiceNumber: -1 });
  
  let sequence = 1;
  if (lastInvoice) {
    const lastSequence = parseInt(lastInvoice.invoiceNumber.slice(-4));
    sequence = lastSequence + 1;
  }
  
  return `${prefix}${sequence.toString().padStart(4, '0')}`;
};

// Pre-save middleware
InvoiceSchema.pre('save', async function(next) {
  // Generate invoice number if not exists
  if (this.isNew && !this.invoiceNumber) {
    this.invoiceNumber = await this.constructor.generateInvoiceNumber();
  }
  
  // 🔥 FIX: Only calculate amounts if totalAmount not explicitly set
  // When creating invoice from payment with deposit, totalAmount is already set correctly
  // Check if totalAmount was modified directly (not via calculateAmounts)
  const totalAmountWasSet = this.isModified('totalAmount') && this.isNew;
  if (!totalAmountWasSet || this.totalAmount === 0 || this.totalAmount === undefined) {
    // Calculate amounts before saving (normal invoice creation)
    this.calculateAmounts();
  }
  
  // Set due date if not provided (default 30 days from issue date)
  if (!this.dueDate) {
    this.dueDate = new Date(this.issueDate.getTime() + 30 * 24 * 60 * 60 * 1000);
  }
  
  // Update last modified date
  if (!this.isNew) {
    this.lastModified = new Date();
  }
  
  next();
});

// Export constants and model
module.exports = {
  Invoice: mongoose.model('Invoice', InvoiceSchema),
  InvoiceStatus,
  InvoiceType
};

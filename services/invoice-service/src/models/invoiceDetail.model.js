const mongoose = require("mongoose");
const { Schema } = mongoose;

// Service Type Enum
const ServiceType = {
  EXAMINATION: 'examination',           // Khám tổng quát
  CLEANING: 'cleaning',                // Vệ sinh răng miệng
  FILLING: 'filling',                  // Hàn răng
  EXTRACTION: 'extraction',            // Nhổ răng
  ROOT_CANAL: 'root_canal',           // Điều trị tủy
  CROWN: 'crown',                     // Làm răng sứ
  BRIDGE: 'bridge',                   // Cầu răng
  IMPLANT: 'implant',                 // Cấy ghép implant
  ORTHODONTIC: 'orthodontic',         // Niềng răng
  WHITENING: 'whitening',             // Tẩy trắng răng
  SURGERY: 'surgery',                 // Phẫu thuật
  EMERGENCY: 'emergency',             // Cấp cứu
  CONSULTATION: 'consultation',        // Tư vấn
  XRAY: 'xray',                      // Chụp X-quang
  MEDICATION: 'medication'            // Thuốc men
};

// Service Category Enum
const ServiceCategory = {
  PREVENTIVE: 'preventive',           // Dịch vụ phòng ngừa
  RESTORATIVE: 'restorative',         // Điều trị phục hồi
  SURGICAL: 'surgical',               // Phẫu thuật
  COSMETIC: 'cosmetic',               // Thẩm mỹ răng
  ORTHODONTIC: 'orthodontic',         // Chỉnh nha
  EMERGENCY: 'emergency',             // Cấp cứu
  DIAGNOSTIC: 'diagnostic'            // Chẩn đoán
};

// Service Info Sub-schema
const ServiceInfoSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  code: {
    type: String,
    trim: true,
    uppercase: true
  },
  type: {
    type: String,
    enum: Object.values(ServiceType),
    required: true
  },
  category: {
    type: String,
    enum: Object.values(ServiceCategory),
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  unit: {
    type: String,
    trim: true,
    default: null
  }
}, { _id: false });

// Tooth Information Sub-schema
const ToothInfoSchema = new Schema({
  toothNumber: {
    type: String,
    trim: true
  },
  surface: {
    type: String,
    enum: ['mesial', 'distal', 'buccal', 'lingual', 'occlusal', 'incisal', 'full_crown'],
    trim: true
  },
  position: {
    type: String,
    enum: ['upper_left', 'upper_right', 'lower_left', 'lower_right'],
    trim: true
  }
}, { _id: false });

// Discount Detail Sub-schema
const DiscountDetailSchema = new Schema({
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

// Main Invoice Detail Schema
const InvoiceDetailSchema = new Schema({
  // Reference to invoice
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Invoice",
    required: true,
    index: true
  },
  
  // Service reference and information
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  serviceInfo: {
    type: ServiceInfoSchema,
    required: true
  },
  
  // Tooth information (for dental-specific services)
  toothInfo: {
    type: ToothInfoSchema,
    default: null
  },
  
  // Pricing and quantity
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  
  // Discount information
  discount: {
    type: DiscountDetailSchema,
    default: {}
  },
  
  // Calculated amounts
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  discountAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
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
  
  // Treatment information
  dentistId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  assistantId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // Service delivery
  scheduledDate: Date,
  completedDate: Date,
  status: {
    type: String,
    enum: ['scheduled', 'in-progress', 'completed', 'cancelled', 'postponed'],
    default: 'scheduled'
  },
  
  // Quality and satisfaction
  duration: {
    type: Number, // in minutes
    min: 0
  },
  satisfactionRating: {
    type: Number,
    min: 1,
    max: 5
  },
  
  // Audit trail
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  
  // Active status
  isActive: {
    type: Boolean,
    default: true
  }
}, { 
  timestamps: true,
  collection: 'invoice_details'
});

// Indexes for better performance
InvoiceDetailSchema.index({ invoiceId: 1, isActive: 1 });
InvoiceDetailSchema.index({ serviceId: 1 });
InvoiceDetailSchema.index({ dentistId: 1 });
InvoiceDetailSchema.index({ status: 1 });
InvoiceDetailSchema.index({ completedDate: -1 });
InvoiceDetailSchema.index({ createdAt: -1 });

// Virtual fields
InvoiceDetailSchema.virtual('finalDiscountAmount').get(function() {
  if (this.discount.type === 'percentage') {
    return (this.subtotal * this.discount.value) / 100;
  } else if (this.discount.type === 'fixed_amount') {
    return Math.min(this.discount.value, this.subtotal);
  }
  return 0;
});

InvoiceDetailSchema.virtual('finalTotalPrice').get(function() {
  return this.subtotal - this.finalDiscountAmount;
});

InvoiceDetailSchema.virtual('isCompleted').get(function() {
  return this.status === 'completed';
});

InvoiceDetailSchema.virtual('serviceFullName').get(function() {
  return `${this.serviceInfo.code ? this.serviceInfo.code + ' - ' : ''}${this.serviceInfo.name}`;
});

// Instance methods
InvoiceDetailSchema.methods.calculateAmounts = function() {
  // Calculate subtotal
  this.subtotal = this.unitPrice * this.quantity;
  
  // Calculate discount
  let discountAmount = 0;
  if (this.discount.type === 'percentage') {
    discountAmount = (this.subtotal * this.discount.value) / 100;
  } else if (this.discount.type === 'fixed_amount') {
    discountAmount = Math.min(this.discount.value, this.subtotal);
  }
  
  this.discountAmount = discountAmount;
  this.totalPrice = this.subtotal - discountAmount;
  
  return this.totalPrice;
};

InvoiceDetailSchema.methods.markCompleted = function(completedBy) {
  this.status = 'completed';
  this.completedDate = new Date();
  this.updatedBy = completedBy;
  return this;
};

InvoiceDetailSchema.methods.canBeModified = function() {
  return ['scheduled', 'postponed'].includes(this.status);
};

InvoiceDetailSchema.methods.canBeCancelled = function() {
  return ['scheduled', 'postponed', 'in-progress'].includes(this.status);
};

// Static methods
InvoiceDetailSchema.statics.findByInvoice = function(invoiceId) {
  return this.find({ invoiceId, isActive: true }).sort({ createdAt: 1 });
};

InvoiceDetailSchema.statics.findByService = function(serviceId) {
  return this.find({ serviceId, isActive: true }).sort({ createdAt: -1 });
};

InvoiceDetailSchema.statics.findByDentist = function(dentistId, options = {}) {
  const query = { dentistId, isActive: true };
  if (options.status) query.status = options.status;
  if (options.dateFrom) {
    query.completedDate = { $gte: options.dateFrom };
  }
  if (options.dateTo) {
    query.completedDate = { ...query.completedDate, $lte: options.dateTo };
  }
  
  return this.find(query).sort({ completedDate: -1 });
};

InvoiceDetailSchema.statics.getServiceStatistics = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        completedDate: { $gte: startDate, $lte: endDate },
        status: 'completed',
        isActive: true
      }
    },
    {
      $group: {
        _id: '$serviceInfo.type',
        totalRevenue: { $sum: '$totalPrice' },
        totalServices: { $sum: '$quantity' },
        averagePrice: { $avg: '$totalPrice' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { totalRevenue: -1 }
    }
  ]);
};

// Pre-save middleware
InvoiceDetailSchema.pre('save', function(next) {
  // Calculate amounts before saving
  this.calculateAmounts();
  
  // Update updatedBy if modified
  if (!this.isNew && this.isModified()) {
    // updatedBy should be set by the calling service
  }
  
  next();
});

// Post-save middleware to update invoice totals
InvoiceDetailSchema.post('save', async function(doc, next) {
  try {
    // Recalculate invoice totals when detail is saved
    await this.constructor.updateInvoiceTotals(doc.invoiceId);
    next();
  } catch (error) {
    next(error);
  }
});

// Post-remove middleware to update invoice totals
InvoiceDetailSchema.post('findOneAndDelete', async function(doc, next) {
  try {
    if (doc) {
      await this.constructor.updateInvoiceTotals(doc.invoiceId);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Static method to update invoice totals
InvoiceDetailSchema.statics.updateInvoiceTotals = async function(invoiceId) {
  const Invoice = require('./invoice.model').Invoice;
  
  // Calculate totals from all active details
  const totals = await this.aggregate([
    {
      $match: { invoiceId: invoiceId, isActive: true }
    },
    {
      $group: {
        _id: null,
        subtotal: { $sum: '$subtotal' },
        totalDiscountAmount: { $sum: '$discountAmount' },
        finalTotal: { $sum: '$totalPrice' }
      }
    }
  ]);
  
  if (totals.length > 0) {
    const { subtotal, finalTotal } = totals[0];
    await Invoice.findByIdAndUpdate(invoiceId, {
      subtotal: subtotal,
      totalAmount: finalTotal
    });
  } else {
    // No details, set amounts to 0
    await Invoice.findByIdAndUpdate(invoiceId, {
      subtotal: 0,
      totalAmount: 0
    });
  }
};

// Export constants and model
module.exports = {
  InvoiceDetail: mongoose.model('InvoiceDetail', InvoiceDetailSchema),
  ServiceType,
  ServiceCategory
};

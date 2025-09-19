const mongoose = require('mongoose');

// ServiceAddOn sub-schema - tương tự SubRoom
const serviceAddOnSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  description: {
    type: String,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true,
});

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true, // Không được trùng tên
  },
  basePrice: {
    type: Number,
    required: function() {
      // Chỉ yêu cầu basePrice nếu không có serviceAddOns
      return !this.serviceAddOns || this.serviceAddOns.length === 0;
    },
    min: 0,
  },
  durationMinutes: {
    type: Number,
    required: true,
    min: 1,
  },
  type: {
    type: String,
    enum: ['exam', 'treatment'], // khám / điều trị
    required: true,
  },
  description: {
    type: String,
    trim: true,
  },
  requireExamFirst: {
    type: Boolean,
    default: false, // true = cần có hồ sơ khám trước mới làm được
  },
  // ServiceAddOn array - tương tự SubRoom trong Room
  serviceAddOns: [serviceAddOnSchema],
  isActive: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true,
});

// Validation: Không thể có basePrice và serviceAddOns cùng lúc
serviceSchema.pre('validate', function(next) {
  if (this.serviceAddOns && this.serviceAddOns.length > 0 && this.basePrice) {
    this.invalidate('basePrice', 'Service có dịch vụ bổ sung không được có basePrice');
  }
  next();
});

// Index cho tìm kiếm
serviceSchema.index({ name: 'text', description: 'text' });
serviceSchema.index({ name: 1 });
serviceSchema.index({ type: 1 });
serviceSchema.index({ isActive: 1 });

module.exports = mongoose.model('Service', serviceSchema);

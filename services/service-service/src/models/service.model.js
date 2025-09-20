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
    trim: true
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
  // ServiceAddOn array - bắt buộc phải có ít nhất 1 serviceAddOn
  serviceAddOns: {
    type: [serviceAddOnSchema],
    required: true,
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'Service phải có ít nhất 1 serviceAddOn'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true,
});

// Pre-validation để đảm bảo có serviceAddOns
serviceSchema.pre('validate', function(next) {
  if (!this.serviceAddOns || this.serviceAddOns.length === 0) {
    this.invalidate('serviceAddOns', 'Service phải có ít nhất 1 serviceAddOn');
  }
  next();
});

// Index cho tìm kiếm
serviceSchema.index({ name: 'text', description: 'text' });
serviceSchema.index({ name: 1 });
serviceSchema.index({ type: 1 });
serviceSchema.index({ isActive: 1 });

module.exports = mongoose.model('Service', serviceSchema);

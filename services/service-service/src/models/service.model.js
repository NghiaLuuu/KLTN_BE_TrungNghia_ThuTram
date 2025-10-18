const mongoose = require('mongoose');

// Room Type Enum - phải khớp với Room service
const ROOM_TYPES = {
  CONSULTATION: 'CONSULTATION',           // Phòng tư vấn/khám tổng quát
  GENERAL_TREATMENT: 'GENERAL_TREATMENT', // Phòng điều trị tổng quát
  SURGERY: 'SURGERY',                     // Phòng phẫu thuật/tiểu phẫu
  ORTHODONTIC: 'ORTHODONTIC',             // Phòng chỉnh nha/niềng
  COSMETIC: 'COSMETIC',                   // Phòng thẩm mỹ nha
  PEDIATRIC: 'PEDIATRIC',                 // Phòng nha nhi
  X_RAY: 'X_RAY',                         // Phòng X-quang/CT
  STERILIZATION: 'STERILIZATION',         // Phòng tiệt trùng
  LAB: 'LAB',                             // Phòng labo
  RECOVERY: 'RECOVERY',                   // Phòng hồi sức
  SUPPORT: 'SUPPORT'                      // Phòng phụ trợ
};

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
  durationMinutes: {
    type: Number,
    required: true,
    min: 1,
  },
  unit: {
    type: String,
    enum: ['Răng', 'Hàm', 'Trụ', 'Cái', 'Lần'],
    required: true,
    trim: true
  },
  imageUrl: {
    type: String,
    trim: true,
    default: null
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  hasBeenUsed: {
    type: Boolean,
    default: false
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
  type: {
    type: String,
    enum: ['exam', 'treatment'], // khám / điều trị
    required: true,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  requireExamFirst: {
    type: Boolean,
    default: false, // true = cần có hồ sơ khám trước mới làm được
  },
  // Các loại phòng mà dịch vụ này có thể thực hiện
  allowedRoomTypes: {
    type: [String],
    enum: Object.values(ROOM_TYPES),
    required: true,
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'Service phải có ít nhất 1 loại phòng được phép'
    }
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
  },
  hasBeenUsed: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
});

// Pre-validation để đảm bảo có serviceAddOns
serviceSchema.pre('validate', function(next) {
  if (!this.serviceAddOns || this.serviceAddOns.length === 0) {
    this.invalidate('serviceAddOns', 'Service phải có ít nhất 1 serviceAddOn');
  }
  if (!this.allowedRoomTypes || this.allowedRoomTypes.length === 0) {
    this.invalidate('allowedRoomTypes', 'Service phải có ít nhất 1 loại phòng được phép');
  }
  next();
});

// Index cho tìm kiếm
serviceSchema.index({ name: 'text', description: 'text' });
serviceSchema.index({ name: 1 });
serviceSchema.index({ type: 1 });
serviceSchema.index({ isActive: 1 });

// Export model và enum
const Service = mongoose.model('Service', serviceSchema);
Service.ROOM_TYPES = ROOM_TYPES;

module.exports = Service;

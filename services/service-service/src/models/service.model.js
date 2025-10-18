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

// PriceSchedule sub-schema - Lịch giá theo thời gian cho ServiceAddOn
const priceScheduleSchema = new mongoose.Schema({
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  startDate: {
    type: Date,
    required: true,
  },
  endDate: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        return v >= this.startDate;
      },
      message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  reason: {
    type: String,
    trim: true,
    maxlength: 500,
    default: null
  }
}, {
  timestamps: true,
});

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
  },
  // 🆕 Danh sách giá theo thời gian
  priceSchedules: {
    type: [priceScheduleSchema],
    default: []
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
  },
  // 🆕 Giá tạm thời cho Service (áp dụng cho tất cả serviceAddOns)
  temporaryPrice: {
    type: Number,
    min: 0,
    default: null
  },
  startDate: {
    type: Date,
    default: null
  },
  endDate: {
    type: Date,
    default: null,
    validate: {
      validator: function(v) {
        if (!v || !this.startDate) return true;
        return v >= this.startDate;
      },
      message: 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu'
    }
  }
}, {
  timestamps: true,
});

// 🆕 Method to check if temporary price is active
serviceSchema.methods.hasActiveTemporaryPrice = function() {
  if (!this.temporaryPrice || !this.startDate || !this.endDate) {
    return false;
  }
  const now = new Date();
  return now >= this.startDate && now <= this.endDate;
};

// 🆕 Method to get effective price for a specific ServiceAddOn
serviceSchema.methods.getEffectiveAddOnPrice = function(addOnId, checkDate = new Date()) {
  const addOn = this.serviceAddOns.id(addOnId);
  if (!addOn) return null;

  // Check if there's an active price schedule for this date
  if (addOn.priceSchedules && addOn.priceSchedules.length > 0) {
    const activeSchedule = addOn.priceSchedules.find(schedule => {
      return schedule.isActive &&
             checkDate >= schedule.startDate &&
             checkDate <= schedule.endDate;
    });
    
    if (activeSchedule) {
      return activeSchedule.price;
    }
  }

  // Return base price if no active schedule
  return addOn.price;
};

// 🆕 Method to get all ServiceAddOns with their effective prices
serviceSchema.methods.getAddOnsWithEffectivePrices = function(checkDate = new Date()) {
  return this.serviceAddOns.map(addOn => {
    const effectivePrice = this.getEffectiveAddOnPrice(addOn._id, checkDate);
    return {
      ...addOn.toObject(),
      basePrice: addOn.price,
      effectivePrice: effectivePrice,
      isPriceModified: effectivePrice !== addOn.price
    };
  });
};

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

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 🆕 Schema for work shifts
const workShiftSchema = new Schema({
  name: {
    type: String,
    required: true,
    enum: ['morning', 'afternoon', 'evening']
  },
  displayName: {
    type: String,
    required: true // VD: "Ca sáng", "Ca chiều", "Ca tối"
  },
  startTime: {
    type: String,
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ // HH:MM format
  },
  endTime: {
    type: String,
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: true });

// 🆕 Schema for holidays
const holidaySchema = new Schema({
  name: {
    type: String,
    required: true
  },
  // startDate / endDate (single day => startDate === endDate)
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    enum: ['annual', 'special'],
    default: 'special'
  }
}, { _id: true });

// Validate that startDate and endDate present and range is valid
holidaySchema.pre('validate', function(next) {
  if (!this.startDate || !this.endDate) {
    return next(new Error('Holiday must have both "startDate" and "endDate" (single day allowed when equal)'));
  }
  if (this.startDate > this.endDate) {
    return next(new Error('"startDate" must be earlier than or equal to "endDate"'));
  }
  next();
});

// 🆕 Schema for cancellation policy
const cancellationPolicySchema = new Schema({
  allowCancellation: {
    type: Boolean,
    default: true
  },
  minHoursBeforeCancellation: {
    type: Number,
    default: 72, // có thể chỉnh sửa
    min: 1
  },
  refundPolicy: {
    type: String,
    enum: ['full_refund', 'partial_refund', 'no_refund'],
    default: 'full_refund'
  },
  refundPercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  notes: {
    type: String,
    maxlength: 500
  }
}, { _id: false });

// 🆕 Schema for staff allocation rules (flexible)
const staffAllocationSchema = new Schema({
  maxDentistPerSlot: {
    type: Number,
    default: 1,
    min: 1,
    max: 5 // có thể tăng lên nếu cần
  },
  maxNursePerSlot: {
    type: Number,
    default: 1,
    min: 0, // có thể không cần y tá
    max: 3
  }
}, { _id: false });

// 🆕 Schema for financial configuration
const financialConfigSchema = new Schema({
  currency: {
    type: String,
    default: 'VND',
    enum: ['VND']
  },
  vatPercentage: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  }
}, { _id: false });

// 🆕 Main Organization Schema
const organizationSchema = new Schema({
  // Đảm bảo chỉ có 1 document
  singletonKey: {
    type: String,
    default: 'ORGANIZATION_SINGLETON',
    unique: true,
    immutable: true
  },
  // 🔹 BASIC INFORMATION
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  address: {
    street: { type: String, required: true },
    ward: { type: String, required: true },
    district: { type: String, required: true },
    city: { type: String, required: true },
    zipCode: { type: String },
    fullAddress: { type: String } // computed field
  },
  contactInfo: {
    hotline: {
      type: String,
      required: true,
      match: /^[0-9\-\+\s\(\)]+$/
    },
    email: {
      type: String,
      required: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    website: {
      type: String,
      default: null
    }
  },
  logo: {
    type: String,
    default: null // URL to logo image
  },
  timezone: {
    type: String,
    default: 'Asia/Ho_Chi_Minh',
    enum: [
      'Asia/Ho_Chi_Minh',
      'Asia/Bangkok', 
      'Asia/Singapore',
      'UTC',
      'Asia/Jakarta',
      'Asia/Manila'
    ]
  },
  // isActive replaces previous 'status' enum. true = active, false = inactive/closed
  isActive: {
    type: Boolean,
    default: true
  },

  // 🔹 WORK SCHEDULE CONFIGURATION (flexible)
  workShifts: {
    type: [workShiftSchema],
    default: [
      {
        name: 'morning',
        displayName: 'Ca sáng',
        startTime: '08:00',
        endTime: '12:00',
        isActive: true
      },
      {
        name: 'afternoon', 
        displayName: 'Ca chiều',
        startTime: '13:30',
        endTime: '17:30',
        isActive: true
      },
      {
        name: 'evening',
        displayName: 'Ca tối',
        startTime: '18:00',
        endTime: '21:00',
        isActive: true
      }
    ]
  },
  
  unitDuration: {
    type: Number,
    enum: [10, 15, 20, 30, 45, 60], // có thể chọn nhiều options
    default: 15,
    required: true
  },

  holidays: {
    type: [holidaySchema],
    default: []
  },

  // 🔹 BOOKING CONFIGURATION (flexible)
  maxBookingDays: {
    type: Number,
    default: 30,
    min: 1,
    max: 365, // có thể đặt lịch xa hơn
    required: true
  },

  maxGenerateScheduleMonths: {
    type: Number,
    default: 3,
    min: 1,
    max: 12, // có thể tạo lịch xa hơn
    required: true
  },

  // 🔹 SERVICE & OPERATION POLICIES
  cancellationPolicy: {
    type: cancellationPolicySchema,
    default: () => ({})
  },

  staffAllocationRules: {
    type: staffAllocationSchema,
    default: () => ({})
  },

  // 🔹 FINANCIAL CONFIGURATION
  financialConfig: {
    type: financialConfigSchema,
    default: () => ({})
  },
  
  // 🔹 METADATA
  isDefault: {
    type: Boolean,
    default: false // chỉ có 1 organization là default
  },
  
  createdBy: {
    type: Schema.Types.ObjectId,
  },
  
  updatedBy: {
    type: Schema.Types.ObjectId,
  }
}, {
  timestamps: true
});

// 🔹 MIDDLEWARE - Auto compute fullAddress
organizationSchema.pre('save', function(next) {
  if (this.address) {
    this.address.fullAddress = `${this.address.street}, ${this.address.ward}, ${this.address.district}, ${this.address.city}`;
  }
  next();
});

// 🔹 VALIDATION - Ensure valid time ranges
organizationSchema.pre('save', function(next) {
  // Validate work shifts
  for (let shift of this.workShifts) {
    const startTime = shift.startTime.split(':');
    const endTime = shift.endTime.split(':');
    const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
    const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
    
    if (startMinutes >= endMinutes) {
      return next(new Error(`Ca ${shift.displayName}: Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc`));
    }
  }
  
  // Validate booking settings
  if (this.maxBookingDays > 365) {
    return next(new Error('Số ngày đặt lịch tối đa không được vượt quá 365 ngày'));
  }
  
  if (this.maxGenerateScheduleMonths > 12) {
    return next(new Error('Số tháng tạo lịch tối đa không được vượt quá 12 tháng'));
  }
  
  next();
});

// 🔹 METHODS
organizationSchema.methods.getActiveWorkShifts = function() {
  return this.workShifts.filter(shift => shift.isActive);
};

organizationSchema.methods.isHoliday = function(date) {
  const checkDate = new Date(date);
  return this.holidays.some(holiday => {
    const s = new Date(holiday.startDate);
    const e = new Date(holiday.endDate);
    if (holiday.isRecurring) {
      // recurring by startDate's day/month (if range, check if checkDate has same day/month as any day in range)
      // simplest: match if checkDate day/month equals startDate day/month
      return s.getDate() === checkDate.getDate() && s.getMonth() === checkDate.getMonth();
    } else {
      // check inclusive range
      const d = new Date(checkDate.toDateString());
      const sd = new Date(s.toDateString());
      const ed = new Date(e.toDateString());
      return d >= sd && d <= ed;
    }
  });
};

organizationSchema.methods.calculateRefund = function(originalAmount) {
  const policy = this.cancellationPolicy;
  if (!policy.allowCancellation || policy.refundPolicy === 'no_refund') {
    return 0;
  }
  
  if (policy.refundPolicy === 'full_refund') {
    return originalAmount;
  }
  
  // partial_refund
  return Math.floor(originalAmount * (policy.refundPercentage / 100));
};

organizationSchema.methods.getTotalSlotsPerShift = function(shiftName) {
  const shift = this.workShifts.find(s => s.name === shiftName && s.isActive);
  if (!shift) return 0;
  
  const startTime = shift.startTime.split(':');
  const endTime = shift.endTime.split(':');
  const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
  const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
  
  return Math.floor((endMinutes - startMinutes) / this.unitDuration);
};

// 🔹 STATIC METHODS
organizationSchema.statics.getSingleton = function () {
  return this.findOne({ singletonKey: 'ORGANIZATION_SINGLETON' });
};

// 🔹 INDEXES
organizationSchema.index({ isDefault: 1, status: 1 });
organizationSchema.index({ 'contactInfo.email': 1 });

module.exports = mongoose.model('Organization', organizationSchema);

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Schema cho WorkShift
const workShiftSchema = new Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    enum: {
      values: ['Ca sáng', 'Ca chiều', 'Ca tối'],
      message: 'Tên ca chỉ được phép là: Ca sáng, Ca chiều, Ca tối'
    }
  },
  startTime: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
      },
      message: 'startTime không hợp lệ (HH:MM)'
    }
  },
  endTime: {
    type: String,
    required: true,
    validate: {
      validator: function (v) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
      },
      message: 'endTime không hợp lệ (HH:MM)'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { _id: true });


// Main Clinic Schema
const clinicSchema = new Schema({
  singletonKey: {
    type: String,
    default: 'CLINIC_SINGLETON',
    unique: true,
    immutable: true
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
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  workShifts: {
    type: [workShiftSchema],
    required: true,
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'Phải có ít nhất một ca làm việc'
    }
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  createdBy: Schema.Types.ObjectId,
  updatedBy: Schema.Types.ObjectId
}, { timestamps: true });

// Validate shifts
function validateShifts(workShifts) {
  const nameSet = new Set();

  for (let i = 0; i < workShifts.length; i++) {
    const shift = workShifts[i];
    const normalizedName = shift.name.toLowerCase().trim();

    if (nameSet.has(normalizedName)) {
      throw new Error(`Tên ca "${shift.name}" bị trùng`);
    }
    nameSet.add(normalizedName);

    // Validate time range
    if (!shift.startTime || !shift.endTime) {
      throw new Error(`Ca "${shift.name}": thiếu thời gian bắt đầu hoặc kết thúc`);
    }

    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;

    if (start >= end) {
      throw new Error(`Ca "${shift.name}": thời gian bắt đầu phải nhỏ hơn thời gian kết thúc`);
    }

    for (let j = 0; j < i; j++) {
      const other = workShifts[j];
      if (!other.startTime || !other.endTime) continue;

      const [osh, osm] = other.startTime.split(':').map(Number);
      const [oeh, oem] = other.endTime.split(':').map(Number);
      const oStart = osh * 60 + osm;
      const oEnd = oeh * 60 + oem;

      if (start < oEnd && end > oStart) {
        throw new Error(
          `Ca "${shift.name}" (${shift.startTime}-${shift.endTime}) bị trùng giờ với "${other.name}" (${other.startTime}-${other.endTime})`
        );
      }
    }
  }
}


clinicSchema.pre('save', function (next) {
  try {
    validateShifts(this.workShifts);
    next();
  } catch (err) {
    next(err);
  }
});

clinicSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  if (update && update.$set && update.$set.workShifts) {
    try {
      validateShifts(update.$set.workShifts);
    } catch (err) {
      return next(err);
    }
  }
  next();
});

// Methods
clinicSchema.methods.getActiveWorkShifts = function () {
  return this.workShifts.filter(s => s.isActive);
};

// Static
clinicSchema.statics.getSingleton = function () {
  return this.findOne({ singletonKey: 'CLINIC_SINGLETON' });
};

// Indexes
clinicSchema.index({ isDefault: 1, isActive: 1 });
clinicSchema.index({ 'contactInfo.email': 1 });

module.exports = mongoose.model('Clinic', clinicSchema);

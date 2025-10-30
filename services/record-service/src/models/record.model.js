const mongoose = require("mongoose");

// ========== Prescription Medicine Subdoc ==========
const prescribedMedicineSchema = new mongoose.Schema({
  medicineId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Medicine'
  },
  medicineName: { 
    type: String, 
    required: true // Store medicine name for historical record
  },
  dosage: { 
    type: String, 
    required: true,
    trim: true
  },
  duration: { 
    type: String, 
    required: true,
    trim: true
  },
  note: { 
    type: String,
    trim: true,
    maxlength: 200
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  }
}, { _id: true });

// ========== Prescription Subdoc ==========
const prescriptionSchema = new mongoose.Schema({
  medicines: [prescribedMedicineSchema],
  notes: { 
    type: String,
    trim: true,
    maxlength: 500
  },
  prescribedBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },
  prescribedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// ========== Treatment Indication Subdoc ==========
const treatmentIndicationSchema = new mongoose.Schema({
  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Service'
  },
  serviceName: {
    type: String,
    required: true // Store service name for historical record
  },
  serviceAddOnId: {
    type: String, // Stored as string because it's from serviceAddOns array
    required: false
  },
  serviceAddOnName: {
    type: String,
    required: false
  },
  used: { 
    type: Boolean, 
    default: false
  },
  usedAt: {
    type: Date
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 300
  }
}, { _id: true });

// ========== Patient Info Subdoc ==========
const patientInfoSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  phone: { 
    type: String, 
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10,11}$/.test(v);
      },
      message: 'Số điện thoại không hợp lệ'
    }
  },
  birthYear: { 
    type: Number, 
    required: true,
    min: 1900,
    max: new Date().getFullYear()
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    default: 'other'
  },
  address: {
    type: String,
    trim: true,
    maxlength: 200
  }
}, { _id: false });

// ========== Record Schema ==========
const recordSchema = new mongoose.Schema({
  recordCode: {
    type: String,
    unique: true,
    required: false // ⭐ Auto-generated in pre-save hook
  },
  
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // ✅ Not required - can use patientInfo for walk-in patients
  },
  patientInfo: patientInfoSchema, // Used when staff creates record for walk-in patient

  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },

  date: { 
    type: Date, 
    default: Date.now 
  },

  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Service'
  },
  serviceName: {
    type: String,
    required: true // Store service name for historical record
  },
  
  dentistId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'User'
  },
  dentistName: {
    type: String,
    required: true // Store dentist name for historical record
  },

  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  },
  roomName: {
    type: String
  },
  subroomId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null // null for rooms without subrooms
  },
  subroomName: {
    type: String,
    default: null
  },

  diagnosisServiceId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  
  diagnosis: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  indications: [{ 
    type: String, 
    trim: true,
    maxlength: 200
  }],
  
  notes: { 
    type: String, 
    trim: true,
    maxlength: 1000
  },

  type: { 
    type: String, 
    enum: ["exam", "treatment"], 
    required: true 
  },

  // Only used when type = "exam"
  treatmentIndications: [treatmentIndicationSchema],

  prescription: prescriptionSchema,

  status: { 
    type: String, 
    enum: ["pending", "in_progress", "completed", "cancelled"], 
    default: "pending" 
  },

  priority: {
    type: String,
    enum: ["low", "normal", "high", "urgent"],
    default: "normal"
  },

  totalCost: {
    type: Number,
    min: 0,
    default: 0
  },

  paymentStatus: {
    type: String,
    enum: ["unpaid", "partial", "paid"],
    default: "unpaid"
  },

  hasBeenUsed: {
    type: Boolean,
    default: false
  },

  // ========== Queue Management Fields ==========
  queueNumber: {
    type: String,
    trim: true,
    index: true // For quick lookup of current queue number
  },
  
  startedAt: {
    type: Date // Timestamp when status changed to in_progress (when Call button pressed)
  },
  
  completedAt: {
    type: Date // Timestamp when status changed to completed (when Complete button pressed)
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },

  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for patient age
recordSchema.virtual('patientAge').get(function() {
  if (this.patientInfo?.birthYear) {
    return new Date().getFullYear() - this.patientInfo.birthYear;
  }
  return null;
});

// Indexes for better performance
recordSchema.index({ recordCode: 1 });
recordSchema.index({ patientId: 1, date: -1 });
recordSchema.index({ dentistId: 1, date: -1 });
recordSchema.index({ appointmentId: 1 });
recordSchema.index({ status: 1 });
recordSchema.index({ type: 1 });
recordSchema.index({ createdAt: -1 });

// Pre-save hook to generate record code
recordSchema.pre('save', async function(next) {
  if (this.isNew && !this.recordCode) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const dateStr = `${year}${month}${day}`;
    const typePrefix = this.type === 'exam' ? 'EX' : 'TR';
    
    // Find the last record for today
    const lastRecord = await this.constructor.findOne({
      recordCode: { $regex: `^${typePrefix}${dateStr}` }
    }).sort({ recordCode: -1 });
    
    let sequence = 1;
    if (lastRecord) {
      const lastSequence = parseInt(lastRecord.recordCode.slice(-3));
      sequence = lastSequence + 1;
    }
    
    this.recordCode = `${typePrefix}${dateStr}${String(sequence).padStart(3, '0')}`;
  }
  next();
});

// Static methods
recordSchema.statics.findByPatient = function(patientId) {
  return this.find({ patientId }).sort({ createdAt: -1 });
};

recordSchema.statics.findByDentist = function(dentistId, startDate, endDate) {
  const query = { dentistId };
  if (startDate && endDate) {
    query.date = { $gte: startDate, $lte: endDate };
  }
  return this.find(query).sort({ date: -1 });
};

recordSchema.statics.findPending = function() {
  return this.find({ status: 'pending' }).sort({ priority: -1, createdAt: 1 });
};

module.exports = mongoose.model("Record", recordSchema);

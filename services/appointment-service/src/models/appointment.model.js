const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Patient Info Sub-schema
const patientInfoSchema = new Schema({
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
  birthYear: { 
    type: Number, 
    required: true,
    min: 1900,
    max: new Date().getFullYear()
  }
}, { _id: false });

// Main Appointment Schema (Simplified for Booking Flow)
const appointmentSchema = new Schema({
  // Appointment Code: AP000001-03102025 (số thứ tự trong ngày)
  appointmentCode: {
    type: String,
    unique: true,
    required: true
  },
  
  // Patient Information
  // patientId is required for online booking (patient has account)
  // patientId is null for offline booking (walk-in patient without account)
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  patientInfo: {
    type: patientInfoSchema,
    required: true
  },
  
  // Service Information (ServiceAddOn - dịch vụ con)
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  serviceName: {
    type: String,
    required: true,
    trim: true
  },
  serviceType: {
    type: String,
    enum: ['exam', 'treatment'],
    required: true
  },
  serviceAddOnId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  serviceAddOnName: {
    type: String,
    required: true,
    trim: true
  },
  serviceDuration: {
    type: Number,
    required: true,
    min: 1 // minutes
  },
  servicePrice: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Dentist Assignment
  dentistId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  dentistName: {
    type: String,
    required: true,
    trim: true
  },
  
  // Slot Information
  slotIds: [{
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }],
  appointmentDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: String, // "09:00"
    required: true
  },
  endTime: {
    type: String, // "09:45"
    required: true
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  roomName: {
    type: String,
    trim: true
  },
  
  // Payment & Invoice
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Status
  status: {
    type: String,
    enum: ['confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'],
    default: 'confirmed'
  },
  
  // Booking Information
  bookedAt: {
    type: Date,
    default: Date.now
  },
  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  bookedByRole: {
    type: String,
    enum: ['patient', 'staff', 'dentist', 'admin'],
    required: true
  },
  bookingChannel: {
    type: String,
    enum: ['online', 'offline'],
    default: 'online'
  },
  
  // Notes
  notes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  reasonForVisit: {
    type: String,
    trim: true,
    maxlength: 300
  },
  
  // Check-in Information
  checkedInAt: {
    type: Date
  },
  checkedInBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  
  // Completion Information
  completedAt: {
    type: Date
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  actualDuration: {
    type: Number // minutes
  },
  
  // Cancellation Information
  cancelledAt: {
    type: Date
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  cancellationReason: {
    type: String,
    trim: true,
    maxlength: 300
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance (appointmentCode unique index is auto-created by unique: true)
appointmentSchema.index({ patientId: 1, appointmentDate: -1 });
appointmentSchema.index({ dentistId: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1, appointmentDate: 1 });
appointmentSchema.index({ paymentId: 1 });
appointmentSchema.index({ appointmentDate: 1 });

// Virtual: Check if appointment is today
appointmentSchema.virtual('isToday').get(function() {
  const today = new Date();
  const appointmentDate = new Date(this.appointmentDate);
  return today.toDateString() === appointmentDate.toDateString();
});

// Virtual: Check if appointment is upcoming
appointmentSchema.virtual('isUpcoming').get(function() {
  const now = new Date();
  const appointmentDate = new Date(this.appointmentDate);
  return appointmentDate > now && this.status === 'confirmed';
});

// Static: Generate appointment code (AP000001-03102025)
appointmentSchema.statics.generateAppointmentCode = async function(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const dateStr = `${day}${month}${year}`; // ddmmyyyy
  
  // Count appointments on that day
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const count = await this.countDocuments({
    appointmentDate: { $gte: startOfDay, $lte: endOfDay }
  });
  
  const sequence = String(count + 1).padStart(6, '0'); // 000001, 000002, ...
  
  return `AP${sequence}-${dateStr}`;
};

// Static: Find by appointment code
appointmentSchema.statics.findByCode = function(code) {
  return this.findOne({ appointmentCode: code });
};

// Static: Find by patient
appointmentSchema.statics.findByPatient = function(patientId, filters = {}) {
  const query = { patientId };
  
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.dateFrom) {
    query.appointmentDate = { $gte: new Date(filters.dateFrom) };
  }
  if (filters.dateTo) {
    query.appointmentDate = { 
      ...query.appointmentDate, 
      $lte: new Date(filters.dateTo) 
    };
  }
  
  return this.find(query).sort({ appointmentDate: -1 });
};

// Static: Find by dentist
appointmentSchema.statics.findByDentist = function(dentistId, filters = {}) {
  const query = { dentistId };
  
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.date) {
    const date = new Date(filters.date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    query.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
  }
  
  return this.find(query).sort({ appointmentDate: 1, startTime: 1 });
};

// Instance: Check if can be cancelled
appointmentSchema.methods.canBeCancelled = function() {
  return this.status === 'confirmed' && this.isUpcoming;
};

// Instance: Check if can check-in
appointmentSchema.methods.canCheckIn = function() {
  return this.status === 'confirmed' && this.isToday;
};

// Instance: Check if can complete
appointmentSchema.methods.canComplete = function() {
  return ['checked-in', 'in-progress'].includes(this.status);
};

module.exports = mongoose.model('Appointment', appointmentSchema);

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Counter để quản lý sequence appointment
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

// Sub-schemas
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
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  address: {
    type: String,
    trim: true,
    maxlength: 200
  },
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  }
}, { _id: false });

const serviceInfoSchema = new Schema({
  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true 
  },
  serviceName: { 
    type: String, 
    required: true,
    trim: true 
  },
  estimatedDuration: { 
    type: Number, 
    default: 60 // minutes
  },
  price: { 
    type: Number, 
    min: 0 
  }
}, { _id: false });

const slotInfoSchema = new Schema({
  slotId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true 
  },
  date: { 
    type: Date, 
    required: true 
  },
  startTime: { 
    type: String, 
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  endTime: { 
    type: String, 
    required: true,
    match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
  },
  roomId: mongoose.Schema.Types.ObjectId,
  roomName: String
}, { _id: false });

const appointmentSchema = new Schema({
  appointmentCode: {
    type: String,
    unique: true,
    required: true
  },
  
  // Patient information
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null // null for walk-in patients
  },
  patientInfo: {
    type: patientInfoSchema,
    required: true
  },
  
  // Services information
  services: [serviceInfoSchema],
  
  // Dentist assignment
  assignedDentistId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  assignedDentistName: {
    type: String,
    trim: true
  },
  preferredDentistId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  
  // Time slots
  slots: [slotInfoSchema],
  
  // Appointment details
  type: { 
    type: String, 
    enum: ["exam", "treatment", "consultation", "followup"], 
    required: true 
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'], 
    default: 'pending' 
  },
  
  // Booking information
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
    enum: ['online', 'phone', 'walk-in', 'system'],
    default: 'online'
  },
  
  // Notes and special requirements
  notes: {
    type: String,
    maxlength: 500,
    trim: true
  },
  specialRequirements: {
    type: String,
    maxlength: 300,
    trim: true
  },
  reasonForVisit: {
    type: String,
    maxlength: 200,
    trim: true
  },
  
  // Pricing
  totalEstimatedCost: {
    type: Number,
    min: 0,
    default: 0
  },
  deposit: {
    amount: {
      type: Number,
      min: 0,
      default: 0
    },
    status: {
      type: String,
      enum: ['none', 'pending', 'paid', 'refunded'],
      default: 'none'
    },
    paidAt: Date,
    refundedAt: Date
  },
  
  // Reminders and notifications
  reminderSent: {
    type: Boolean,
    default: false
  },
  reminderSentAt: Date,
  
  // Cancellation information
  cancelledAt: Date,
  cancelledBy: mongoose.Schema.Types.ObjectId,
  cancellationReason: {
    type: String,
    maxlength: 200,
    trim: true
  },
  
  // Check-in information
  checkedInAt: Date,
  checkedInBy: mongoose.Schema.Types.ObjectId,
  
  // Completion information
  completedAt: Date,
  actualDuration: Number, // in minutes
  
  // Follow-up
  followUpRequired: {
    type: Boolean,
    default: false
  },
  followUpDate: Date,
  followUpNotes: String
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
appointmentSchema.index({ appointmentCode: 1 });
appointmentSchema.index({ patientId: 1 });
appointmentSchema.index({ assignedDentistId: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ 'slots.date': 1 });
appointmentSchema.index({ createdAt: -1 });
appointmentSchema.index({ 'patientInfo.phone': 1 });

// Virtual fields
appointmentSchema.virtual('isToday').get(function() {
  if (!this.slots || this.slots.length === 0) return false;
  const today = new Date();
  const appointmentDate = new Date(this.slots[0].date);
  return today.toDateString() === appointmentDate.toDateString();
});

appointmentSchema.virtual('isUpcoming').get(function() {
  if (!this.slots || this.slots.length === 0) return false;
  const now = new Date();
  const appointmentDate = new Date(this.slots[0].date);
  return appointmentDate > now;
});

appointmentSchema.virtual('isPast').get(function() {
  if (!this.slots || this.slots.length === 0) return false;
  const now = new Date();
  const appointmentDate = new Date(this.slots[0].date);
  return appointmentDate < now;
});

// Pre-save middleware to generate appointment code
appointmentSchema.pre('save', async function(next) {
  if (this.isNew && !this.appointmentCode) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        { _id: 'appointment' },
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      
      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const sequence = String(counter.seq).padStart(4, '0');
      
      this.appointmentCode = `AP${year}${month}${sequence}`;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Static methods
appointmentSchema.statics.findByCode = function(code) {
  return this.findOne({ appointmentCode: code });
};

appointmentSchema.statics.findByPatient = function(patientId, options = {}) {
  const query = { patientId };
  if (options.status) query.status = options.status;
  if (options.fromDate) query['slots.date'] = { $gte: options.fromDate };
  if (options.toDate) query['slots.date'] = { ...query['slots.date'], $lte: options.toDate };
  
  return this.find(query).sort({ 'slots.date': -1 });
};

appointmentSchema.statics.findByDentist = function(dentistId, options = {}) {
  const query = { assignedDentistId: dentistId };
  if (options.status) query.status = options.status;
  if (options.date) {
    const startOfDay = new Date(options.date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(options.date);
    endOfDay.setHours(23, 59, 59, 999);
    query['slots.date'] = { $gte: startOfDay, $lte: endOfDay };
  }
  
  return this.find(query).sort({ 'slots.date': 1 });
};

// Instance methods
appointmentSchema.methods.canBeModified = function() {
  return ['pending', 'confirmed'].includes(this.status) && this.isUpcoming;
};

appointmentSchema.methods.canBeCancelled = function() {
  return ['pending', 'confirmed', 'checked-in'].includes(this.status);
};

appointmentSchema.methods.calculateTotalCost = function() {
  return this.services.reduce((total, service) => total + (service.price || 0), 0);
};

module.exports = mongoose.model('Appointment', appointmentSchema);

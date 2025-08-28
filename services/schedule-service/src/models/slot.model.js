const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  scheduleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: true
  },
  subRoomId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  dentistId: [{
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }],
  nurseId: [{
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }],
  status: {
    type: String,
    enum: ['available', 'confirmed', 'unavailable', 'reserved'],
    default: 'available'
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Slot', slotSchema);

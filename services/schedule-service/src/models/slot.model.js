const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['available', 'booked', 'unavailable'],
    default: 'available'
  },
  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment',
    default: null
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Slot', slotSchema);

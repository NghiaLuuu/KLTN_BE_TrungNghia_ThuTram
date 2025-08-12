const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  dentistIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', 
    required: true
  }],
  nurseIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', 
    required: true
  }],
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  shiftId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  type: {
    type: String,
    enum: ['fixed', 'extra'], 
    required: true
  },
  slotDuration: {
    type: Number, // đơn vị: phút
    required: true
  },
  slots: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Slot'
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Schedule', scheduleSchema);

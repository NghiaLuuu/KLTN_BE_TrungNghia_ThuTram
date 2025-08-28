const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId, 
    required: true
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  shiftIds: [{
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }],
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

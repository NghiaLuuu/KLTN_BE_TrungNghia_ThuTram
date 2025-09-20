const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  roomId: {
    type: mongoose.Schema.Types.ObjectId, 
    required: true
  },
  // Deprecated: legacy field, no longer used (kept for backward compatibility)
  date: {
    type: Date,
    required: false
  },
  workShifts: [{
    name: { type: String, required: true },
    startTime: { type: String, required: true }, // "HH:mm"
    endTime: { type: String, required: true },   // "HH:mm"
    isActive: { type: Boolean, default: true }
  }],
  // VN date (YYYY-MM-DD) persisted for unambiguous local-day reporting
  dateVNStr: { type: String, index: true },
  // Note: slots array removed - slot documents are looked up from Slot collection by scheduleId
  isActive: { type: Boolean, default: true },
  // Legacy fields kept optional for backward compatibility
  startDate: { type: Date },
  endDate: { type: Date },
  // shiftIds removed: use workShifts (names/times) and map to configured shifts when needed
  slotDuration: { type: Number },
  // Quarterly information
  // quarter/year removed from schema - quarterly metadata handled elsewhere
  generationType: {
    type: String,
    enum: ['manual', 'quarterly', 'auto'],
    default: 'manual'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Schedule', scheduleSchema);

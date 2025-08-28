const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ['exam', 'treatment'], // khám / điều trị
    required: true,
  },
  duration: {
    type: Number, // phút
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  description: {
    type: String,
  },
  requireExamFirst: {
    type: Boolean,
    default: false, // true = cần có hồ sơ khám trước mới làm được
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, {
  timestamps: true,
});

module.exports = mongoose.model('Service', serviceSchema);

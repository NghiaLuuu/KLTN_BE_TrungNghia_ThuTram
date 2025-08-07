const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  type: {
    type: String,
    required: true,
    enum: ['general', 'surgery', 'consultation'], // ví dụ các loại phòng
  },
  maxDoctors: {
    type: Number,
    required: true,
    min: 0,
  },
  maxNurses: {
    type: Number,
    required: true,
    min: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Room', roomSchema);

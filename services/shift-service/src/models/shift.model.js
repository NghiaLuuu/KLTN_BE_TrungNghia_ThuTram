const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  startTime: { type: String, required: true }, 
  endTime: { type: String, required: true },   
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Shift', shiftSchema);

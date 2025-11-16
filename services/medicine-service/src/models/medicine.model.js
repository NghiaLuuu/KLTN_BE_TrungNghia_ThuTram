const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    unique: true
  },
  unit: { 
    type: String,
    trim: true,
    required: true,
    enum: ['viên', 'vỉ', 'hộp', 'ống', 'lọ', 'gói', 'tuýp', 'chai', 'kg', 'g'],
    default: 'viên'
  },
  category: { 
    type: String,
    trim: true,
    enum: ['thuốc giảm đau', 'kháng sinh', 'thuốc bôi', 'thuốc súc miệng', 'vitamin', 'khác'],
    default: 'khác'
  },
  isActive: { 
    type: Boolean, 
    default: true 
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
medicineSchema.index({ name: 1 });
medicineSchema.index({ category: 1 });
medicineSchema.index({ isActive: 1 });

// Static methods
medicineSchema.statics.findActive = function() {
  return this.find({ isActive: true });
};

module.exports = mongoose.model("Medicine", medicineSchema);

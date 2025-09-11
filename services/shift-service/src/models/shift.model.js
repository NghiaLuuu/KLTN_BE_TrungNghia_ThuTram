const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true }, // giữ unique index
  startTime: { type: String, required: true }, // "08:00"
  endTime: { type: String, required: true },   // "17:00"
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// 🔹 Pre-save: kiểm tra tên trùng
shiftSchema.pre('save', async function(next) {
  const shift = this;

  const existing = await mongoose.models.Shift.findOne({ name: shift.name });
  if (existing && existing._id.toString() !== shift._id.toString()) {
    return next(new Error(`Ca/kíp "${shift.name}" đã tồn tại`));
  }

  next();
});

// 🔹 Pre-update (findOneAndUpdate)
shiftSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  const newName = update?.$set?.name;
  if (newName) {
    const existing = await mongoose.models.Shift.findOne({ name: newName });
    if (existing && existing._id.toString() !== this.getQuery()._id.toString()) {
      return next(new Error(`Ca/kíp "${newName}" đã tồn tại`));
    }
  }

  next();
});

module.exports = mongoose.model('Shift', shiftSchema);

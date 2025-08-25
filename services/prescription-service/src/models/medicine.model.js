const mongoose = require("mongoose");

const medicineSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ingredient: { type: String },
  unit: { type: String, required: true }, 
  category: { type: String },
  description: { type: String },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model("Medicine", medicineSchema);

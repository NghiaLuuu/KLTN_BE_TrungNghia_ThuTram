const mongoose = require("mongoose");

// ========== Prescription Medicine Subdoc ==========
const prescribedMedicineSchema = new mongoose.Schema({
  medicineId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dosage: { type: String, required: true },   // liều lượng
  duration: { type: String, required: true }, // số ngày
  note: { type: String }
}, { _id: false });

// ========== Prescription Subdoc ==========
const prescriptionSchema = new mongoose.Schema({
  medicines: [prescribedMedicineSchema],
  notes: { type: String }
}, { _id: false });

// ========== Record Schema ==========
const recordSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: Date, default: Date.now },

  // dịch vụ chính của hồ sơ (khám hoặc điều trị)
  serviceId: { type: mongoose.Schema.Types.ObjectId, required: true },

  dentistId: { type: mongoose.Schema.Types.ObjectId, required: true },

  diagnosis: { type: String, default: "" },
  indications: [{ type: String, default: "" }],
  notes: { type: String, default: "" },

  type: { type: String, enum: ["exam", "treatment"], required: true }, // loại hồ sơ

  // 🔹 chỉ dùng khi type = "exam"
  treatmentServiceIds: [{ type: mongoose.Schema.Types.ObjectId}],

  prescription: prescriptionSchema, // gộp chung vào hồ sơ

  status: { type: String, enum: ["pending", "done"], default: "pending" },
}, {
  timestamps: true
});

module.exports = mongoose.model("Record", recordSchema);

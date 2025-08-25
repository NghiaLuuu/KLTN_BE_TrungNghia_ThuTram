const mongoose = require("mongoose");

const prescribedMedicineSchema = new mongoose.Schema({
  medicineId: { type: mongoose.Schema.Types.ObjectId, ref: "Medicine", required: true },
  dosage: { type: String, required: true }, // liều lượng
  duration: { type: String, required: true }, // số ngày
  note: { type: String }
}, { _id: false });

const prescriptionSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  doctorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  treatmentId: { type: mongoose.Schema.Types.ObjectId, ref: "TreatmentRecord", required: true },
  medicines: [prescribedMedicineSchema],
  notes: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Prescription", prescriptionSchema);

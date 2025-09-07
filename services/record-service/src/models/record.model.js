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

// ========== Treatment Indication Subdoc ==========
const treatmentIndicationSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  used: { type: Boolean, default: false }  // true nếu đã tạo phiếu điều trị
}, { _id: false });

// ========== Patient Info Subdoc ==========
const patientInfoSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  birthYear: { type: Number, required: true }
}, { _id: false });

// ========== Record Schema ==========
const recordSchema = new mongoose.Schema({
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    required: function() {
      // Bắt buộc nếu không có patientInfo
      return !this.patientInfo;
    }
  },
  patientInfo: patientInfoSchema, // chỉ dùng khi staff đặt hộ với patientInfo

  date: { type: Date, default: Date.now },

  serviceId: { type: mongoose.Schema.Types.ObjectId, required: true }, // dịch vụ chính
  dentistId: { type: mongoose.Schema.Types.ObjectId, required: true },

  diagnosisServiceId: { type: mongoose.Schema.Types.ObjectId }, // dịch vụ dùng để chẩn đoán
  indications: [{ type: String, default: "" }],
  notes: { type: String, default: "" },

  type: { type: String, enum: ["exam", "treatment"], required: true }, // loại hồ sơ

  // 🔹 chỉ dùng khi type = "exam"
  treatmentIndications: [treatmentIndicationSchema],

  prescription: prescriptionSchema, // gộp chung vào hồ sơ

  status: { type: String, enum: ["pending", "done"], default: "pending" },
}, {
  timestamps: true
});

module.exports = mongoose.model("Record", recordSchema);

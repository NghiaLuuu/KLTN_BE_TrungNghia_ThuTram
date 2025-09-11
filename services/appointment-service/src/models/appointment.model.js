const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Counter để quản lý sequence appointment (nếu sau này cần)
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', counterSchema);

const appointmentSchema = new Schema({
  appointmentCode: {
    type: String,
    unique: true,   // Optional, bạn có thể gán khi tạo
  },
  patientInfo: {
    name: { type: String },
    phone: { type: String },
    birthYear: { type: Number }
  },
  serviceId: [{ type: mongoose.Schema.Types.ObjectId, required: true }],
  preferredDentistId: { type: mongoose.Schema.Types.ObjectId, default: null },
  slotIds: [{ type: mongoose.Schema.Types.ObjectId, required: true }],
  type: { type: String, enum: ["exam", "treatment"], required: true },
  status: { type: String, enum: ['booked','confirmed','checked-in'], default: 'booked' },
  bookedBy: { type: mongoose.Schema.Types.ObjectId, required: true }
}, { timestamps: true });

// 🔹 Không còn pre-save hook để sinh appointmentCode
// Bạn sẽ gán appointmentCode khi tạo hold hoặc confirm

module.exports = mongoose.model('Appointment', appointmentSchema);

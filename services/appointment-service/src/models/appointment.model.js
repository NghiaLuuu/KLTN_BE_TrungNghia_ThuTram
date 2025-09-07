const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  patientId: { // bệnh nhân
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  patientInfo: { // thông tin snapshot hoặc khách vãng lai
    name: { type: String },
    phone: { type: String },
    birthYear: { type: Number }
  },
  serviceId: [{ // dịch vụ (lấy type, duration, price từ Service)
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }],
  preferredDentistId: { // nha sĩ mong muốn (optional)
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  slotIds: [{ // danh sách slot được giữ/đặt
      type: mongoose.Schema.Types.ObjectId,
      required: true
  }],
  type: {
    type: String,
    enum: ["exam", "treatment"]
  },
  status: {
    type: String,
    enum: [
      'booked',     // đã đặt
      'confirmed',  // đã xác nhận
      'checked-in' // bệnh nhân đã đến

    ],
    default: 'booked'
  },
  bookedBy: { // người tạo lịch
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    require: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Appointment', appointmentSchema);

const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  patientId: { // bệnh nhân
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  serviceId: [{ // dịch vụ (lấy type, duration, price từ Service)
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }],
  preferredDentistId: { // nha sĩ mong muốn (optional)
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  scheduleId: { // lịch làm việc
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  slotId: { // slot thời gian
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  notes: { // ghi chú cho nha sĩ/lễ tân
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: [
      'booked',     // đã đặt
      'confirmed',  // đã xác nhận
      'checked-in', // bệnh nhân đã đến
      'in-progress',// đang thực hiện dịch vụ
      'completed',  // đã hoàn thành
      'cancelled'   // đã hủy
    ],
    default: 'booked'
  },
  bookedBy: { // người tạo lịch
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  channel: {
    type: String,
    enum: ['web', 'app'],
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

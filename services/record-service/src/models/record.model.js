const mongoose = require("mongoose");

// ========== Subdoc Thuốc Kê Đơn ==========
const prescribedMedicineSchema = new mongoose.Schema({
  medicineId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: false, // ✅ Không bắt buộc
    ref: 'Medicine'
  },
  medicineName: { 
    type: String, 
    required: false // ✅ Không bắt buộc
  },
  unit: {
    type: String,
    required: false, // ✅ Không bắt buộc
    trim: true
  },
  category: {
    type: String,
    required: false,
    trim: true
  },
  dosageInstruction: { 
    type: String, 
    required: false, // ✅ Không bắt buộc
    trim: true
  },
  duration: { 
    type: String, 
    required: false, // ✅ Không bắt buộc
    trim: true
  },
  quantity: {
    type: Number,
    required: false, // ✅ Không bắt buộc
    min: 1
  },
  note: { 
    type: String,
    trim: true,
    maxlength: 200
  }
}, { _id: true });

// ========== Subdoc Đơn Thuốc ==========
const prescriptionSchema = new mongoose.Schema({
  medicines: [prescribedMedicineSchema],
  notes: { 
    type: String,
    trim: true,
    maxlength: 500
  },
  prescribedBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: false, // ✅ Không bắt buộc - đơn thuốc là optional
    ref: 'User'
  },
  prescribedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

// ========== Subdoc Chỉ Định Điều Trị ==========
const treatmentIndicationSchema = new mongoose.Schema({
  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Service'
  },
  serviceName: {
    type: String,
    required: true // Lưu tên dịch vụ cho hồ sơ lịch sử
  },
  serviceAddOnId: {
    type: String, // Lưu dạng string vì nó lấy từ mảng serviceAddOns
    required: false
  },
  serviceAddOnName: {
    type: String,
    required: false
  },
  used: { 
    type: Boolean, 
    default: false
  },
  usedAt: {
    type: Date
  },
  usedForAppointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },
  usedReason: {
    type: String,
    trim: true,
    maxlength: 200
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 300
  }
}, { _id: true });

// ========== Subdoc Dịch Vụ Bổ Sung (Dịch vụ sử dụng trong quá trình điều trị) ==========
const additionalServiceSchema = new mongoose.Schema({
  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Service'
  },
  serviceName: {
    type: String,
    required: true
  },
  serviceType: {
    type: String,
    enum: ['exam', 'treatment'],
    required: true
  },
  serviceAddOnId: {
    type: String,
    default: null
  },
  serviceAddOnName: {
    type: String,
    default: null
  },
  serviceAddOnUnit: {
    type: String,
    default: null // 'Răng', 'Hàm', 'Trụ', 'Cái', 'Lần'
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 300
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: true });

// ========== Subdoc Thông Tin Bệnh Nhân ==========
const patientInfoSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  phone: { 
    type: String, 
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^[0-9]{10,11}$/.test(v);
      },
      message: 'Số điện thoại không hợp lệ'
    }
  },
  birthYear: { 
    type: Number, 
    required: true,
    min: 1900,
    max: new Date().getFullYear()
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    default: 'other'
  },
  address: {
    type: String,
    trim: true,
    maxlength: 200
  }
}, { _id: false });

// ========== Schema Hồ Sơ ==========
const recordSchema = new mongoose.Schema({
  recordCode: {
    type: String,
    unique: true,
    required: false // ⭐ Tự động tạo trong pre-save hook
  },
  
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // ✅ Không bắt buộc - có thể dùng patientInfo cho bệnh nhân walk-in
  },
  patientInfo: patientInfoSchema, // Dùng khi nhân viên tạo hồ sơ cho bệnh nhân walk-in

  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  },

  date: { 
    type: Date, 
    default: Date.now 
  },

  serviceId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'Service'
  },
  serviceName: {
    type: String,
    required: true // Lưu tên dịch vụ cho hồ sơ lịch sử
  },
  serviceAddOnId: {
    type: String,
    default: null
  },
  serviceAddOnName: {
    type: String,
    default: null
  },
  serviceAddOnUnit: {
    type: String,
    default: null // 'Răng', 'Hàm', 'Trụ', 'Cái', 'Lần'
  },
  servicePrice: {
    type: Number,
    default: 0
  },
  serviceAddOnPrice: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    default: 1,
    min: 1
  },
  bookingChannel: {
    type: String,
    enum: ['online', 'offline'],
    default: 'offline'
  },
  
  dentistId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    ref: 'User'
  },
  dentistName: {
    type: String,
    required: true // Lưu tên nha sĩ cho hồ sơ lịch sử
  },

  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  },
  roomName: {
    type: String
  },
  subroomId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null // null cho các phòng không có phòng con
  },
  subroomName: {
    type: String,
    default: null
  },

  diagnosisServiceId: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service'
  },
  
  diagnosis: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  indications: [{ 
    type: String, 
    trim: true,
    maxlength: 200
  }],
  
  notes: { 
    type: String, 
    trim: true,
    maxlength: 1000
  },

  type: { 
    type: String, 
    enum: ["exam", "treatment"], 
    required: true 
  },

  // Chỉ sử dụng khi type = "exam"
  treatmentIndications: [treatmentIndicationSchema],

  // ⭐ Dịch vụ bổ sung sử dụng trong quá trình điều trị (để tính tổng chi phí)
  additionalServices: [additionalServiceSchema],

  prescription: prescriptionSchema,

  status: {
    type: String,
    enum: ["pending", "in-progress", "completed", "cancelled"], 
    default: "pending"
  },  priority: {
    type: String,
    enum: ["low", "normal", "high", "urgent"],
    default: "normal"
  },

  totalCost: {
    type: Number,
    min: 0,
    default: 0
  },

  paymentStatus: {
    type: String,
    enum: ["unpaid", "partial", "paid"],
    default: "unpaid"
  },

  hasBeenUsed: {
    type: Boolean,
    default: false
  },

  // ========== Các Trường Quản Lý Hàng Đợi ==========
  queueNumber: {
    type: String,
    trim: true,
    index: true // Để tra cứu nhanh số hàng đợi hiện tại
  },
  
  startedAt: {
    type: Date // Thời điểm trạng thái chuyển sang in-progress (khi nhấn nút Gọi)
  },
  
  completedAt: {
    type: Date // Thời điểm trạng thái chuyển sang completed (khi nhấn nút Hoàn thành)
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },

  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual cho tuổi bệnh nhân
recordSchema.virtual('patientAge').get(function() {
  if (this.patientInfo?.birthYear) {
    return new Date().getFullYear() - this.patientInfo.birthYear;
  }
  return null;
});

// Indexes để cải thiện hiệu suất
recordSchema.index({ recordCode: 1 });
recordSchema.index({ patientId: 1, date: -1 });
recordSchema.index({ dentistId: 1, date: -1 });
recordSchema.index({ appointmentId: 1 });
recordSchema.index({ status: 1 });
recordSchema.index({ type: 1 });
recordSchema.index({ createdAt: -1 });

// Pre-save hook để tạo mã hồ sơ
recordSchema.pre('save', async function(next) {
  if (this.isNew && !this.recordCode) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const dateStr = `${year}${month}${day}`;
    const typePrefix = this.type === 'exam' ? 'EX' : 'TR';
    
    // Tìm hồ sơ cuối cùng trong ngày hôm nay
    const lastRecord = await this.constructor.findOne({
      recordCode: { $regex: `^${typePrefix}${dateStr}` }
    }).sort({ recordCode: -1 });
    
    let sequence = 1;
    if (lastRecord) {
      const lastSequence = parseInt(lastRecord.recordCode.slice(-3));
      sequence = lastSequence + 1;
    }
    
    this.recordCode = `${typePrefix}${dateStr}${String(sequence).padStart(3, '0')}`;
  }
  next();
});

// Phương thức tĩnh
recordSchema.statics.findByPatient = function(patientId) {
  return this.find({ patientId }).sort({ createdAt: -1 });
};

recordSchema.statics.findByDentist = function(dentistId, startDate, endDate) {
  const query = { dentistId };
  if (startDate && endDate) {
    query.date = { $gte: startDate, $lte: endDate };
  }
  return this.find(query).sort({ date: -1 });
};

recordSchema.statics.findPending = function() {
  return this.find({ status: 'pending' }).sort({ priority: -1, createdAt: 1 });
};

module.exports = mongoose.model("Record", recordSchema);

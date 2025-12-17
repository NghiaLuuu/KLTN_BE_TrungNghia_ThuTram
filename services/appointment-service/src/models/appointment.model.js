const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Schema con - Thông tin bệnh nhân
const patientInfoSchema = new Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 100
  },
  phone: { 
    type: String, 
    required: true,
    match: /^[0-9]{10,11}$/
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  birthYear: { 
    type: Number, 
    required: true,
    min: 1900,
    max: new Date().getFullYear()
  }
}, { _id: false });

// Schema chính - Lịch hẹn (Đơn giản hóa cho quy trình đặt lịch)
const appointmentSchema = new Schema({
  // Mã lịch hẹn: AP000001-03102025 (số thứ tự trong ngày)
  appointmentCode: {
    type: String,
    unique: true,
    required: true
  },
  
  // Thông tin bệnh nhân
  // patientId bắt buộc khi đặt online (bệnh nhân có tài khoản)
  // patientId là null khi đặt offline (bệnh nhân walk-in không có tài khoản)
  patientId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  patientInfo: {
    type: patientInfoSchema,
    required: true
  },
  
  // Thông tin dịch vụ (ServiceAddOn - dịch vụ con)
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  serviceName: {
    type: String,
    required: true,
    trim: true
  },
  serviceType: {
    type: String,
    enum: ['exam', 'treatment'],
    required: true
  },
  serviceAddOnId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false, // ✅ Không bắt buộc - dịch vụ có thể không có addon
    default: null
  },
  serviceAddOnName: {
    type: String,
    required: false, // ✅ Không bắt buộc
    trim: true,
    default: null
  },
  serviceDuration: {
    type: Number,
    required: true,
  },
  servicePrice: {
    type: Number,
    required: false, // ✅ Không bắt buộc - sẽ được tính từ service
    min: 0,
    default: 0
  },
  serviceAddOnPrice: {
    type: Number,
    required: false,
    min: 0,
    default: 0
  },
  
  // Phân công nha sĩ
  dentistId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  dentistName: {
    type: String,
    required: true,
    trim: true
  },
  
  // Phân công y tá
  nurseId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  nurseName: {
    type: String,
    trim: true,
    default: null
  },
  
  // Thông tin slot
  slotIds: [{
    type: mongoose.Schema.Types.ObjectId,
    required: true
  }],
  appointmentDate: {
    type: Date,
    required: true
  },
  startTime: {
    type: String, // "09:00"
    required: true
  },
  endTime: {
    type: String, // "09:45"
    required: true
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  roomName: {
    type: String,
    trim: true
  },
  subroomId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null // null nếu phòng không có subroom
  },
  subroomName: {
    type: String,
    trim: true,
    default: null
  },
  
  // Thanh toán & Hóa đơn
  paymentId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  invoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Theo dõi đặt chỗ (để liên kết với hóa đơn)
  reservationId: {
    type: String,
    index: true
  },
  
  // ⭐ Tham chiếu hồ sơ khám (cho dịch vụ yêu cầu khám trước)
  examRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
    index: true
  },
  
  // Trạng thái
  status: {
    type: String,
    enum: ['confirmed', 'pending-cancellation', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'],
    default: 'confirmed'
  },
  
  // Thông tin đặt lịch
  bookedAt: {
    type: Date,
    default: Date.now
  },
  bookedBy: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  bookedByRole: {
    type: String,
    trim: true,
    default: 'patient'
  },
  
  // Ghi chú
  notes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  
  // Thông tin check-in
  checkedInAt: {
    type: Date
  },
  startedAt: {
    type: Date
  },
  
  // Thông tin hoàn thành
  completedAt: {
    type: Date
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  actualDuration: {
    type: Number // phút
  },
  
  // Thông tin hủy
  cancelledAt: {
    type: Date
  },
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  cancellationReason: {
    type: String,
    trim: true,
    maxlength: 300
  },
  cancellationRequestedAt: {
    type: Date
  },
  cancellationRequestedBy: {
    type: mongoose.Schema.Types.ObjectId
  },
  cancellationRequestReason: {
    type: String,
    trim: true,
    maxlength: 300
  },
  
  // Email nhắc nhở
  reminderEmailSent: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes để tối ưu hiệu năng (index unique appointmentCode tự động tạo bởi unique: true)
appointmentSchema.index({ patientId: 1, appointmentDate: -1 });
appointmentSchema.index({ dentistId: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1, appointmentDate: 1 });
appointmentSchema.index({ paymentId: 1 }, { unique: true, sparse: true }); // ✅ Unique để tránh trùng lịch hẹn từ cùng một thanh toán
appointmentSchema.index({ appointmentDate: 1 });
// ⚡ Index kết hợp cho cron gửi email nhắc nhở (tối ưu cao)
appointmentSchema.index({ 
  reminderEmailSent: 1, 
  bookedByRole: 1, 
  status: 1, 
  appointmentDate: 1 
});

// ✅ Pre-save hook: Tự động thử lại nếu appointmentCode bị trùng
appointmentSchema.pre('save', async function(next) {
  // Chỉ xử lý document mới cần tạo appointmentCode
  if (!this.isNew || !this.appointmentCode) {
    return next();
  }
  
  const maxRetries = 100;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      // Kiểm tra tính duy nhất bằng cách tìm code đã tồn tại
      const existing = await this.constructor.findOne({ 
        appointmentCode: this.appointmentCode 
      });
      
      if (!existing) {
        // Code là duy nhất, tiếp tục lưu
        return next();
      }
      
      // Code bị trùng, tăng số thứ tự
      attempt++;
      console.warn(`⚠️ Phát hiện appointmentCode trùng: ${this.appointmentCode}, đang tăng... (${attempt}/${maxRetries})`);
      
      // Tách số thứ tự hiện tại và tăng nó
      const match = this.appointmentCode.match(/^AP(\d{6})-(.+)$/);
      if (match) {
        const currentSeq = parseInt(match[1], 10);
        const dateStr = match[2];
        const newSeq = currentSeq + 1;
        this.appointmentCode = `AP${String(newSeq).padStart(6, '0')}-${dateStr}`;
        console.log(`🔄 Thử lại với code: ${this.appointmentCode}`);
      } else {
        // Nếu pattern không khớp, tạo lại từ đầu
        this.appointmentCode = await this.constructor.generateAppointmentCode(this.appointmentDate);
      }
      
    } catch (error) {
      return next(error);
    }
  }
  
  // Vượt quá số lần thử
  return next(new Error(`Không thể tạo appointmentCode duy nhất sau ${maxRetries} lần thử`));
});

// Virtual: Kiểm tra lịch hẹn có phải hôm nay không
appointmentSchema.virtual('isToday').get(function() {
  const today = new Date();
  const appointmentDate = new Date(this.appointmentDate);
  return today.toDateString() === appointmentDate.toDateString();
});

// Virtual: Kiểm tra lịch hẹn sắp tới
appointmentSchema.virtual('isUpcoming').get(function() {
  const now = new Date();
  const appointmentDate = new Date(this.appointmentDate);
  return appointmentDate > now && this.status === 'confirmed';
});

appointmentSchema.virtual('bookingChannel').get(function() {
  return this.bookedByRole === 'patient' ? 'online' : 'offline';
});

// Static: Tạo mã lịch hẹn (AP000001-03102025)
appointmentSchema.statics.generateAppointmentCode = async function(date) {
  // ✅ Lấy các phần ngày theo múi giờ Việt Nam
  const vietnamDateStr = date.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }); // Trả về MM/DD/YYYY
  
  const [month, day, year] = vietnamDateStr.split('/');
  const dateStr = `${day}${month}${year}`; // ddmmyyyy
  
  // Tìm số thứ tự cao nhất trong ngày
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  
  const existingCodes = await this.find({
    appointmentDate: { $gte: startOfDay, $lte: endOfDay }
  }).select('appointmentCode').lean();
  
  let maxSequence = 0;
  const pattern = new RegExp(`^AP(\\d{6})-${dateStr}$`);
  
  for (const doc of existingCodes) {
    const match = doc.appointmentCode.match(pattern);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSequence) {
        maxSequence = seq;
      }
    }
  }
  
  // Đánh số thứ tự tuần tự (không random)
  const sequence = maxSequence + 1;
  return `AP${String(sequence).padStart(6, '0')}-${dateStr}`;
};

// Static: Tìm theo mã lịch hẹn
appointmentSchema.statics.findByCode = function(code) {
  return this.findOne({ appointmentCode: code });
};

// Static: Tìm theo bệnh nhân
appointmentSchema.statics.findByPatient = function(patientId, filters = {}) {
  const query = { patientId };
  
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.dateFrom) {
    query.appointmentDate = { $gte: new Date(filters.dateFrom) };
  }
  if (filters.dateTo) {
    query.appointmentDate = { 
      ...query.appointmentDate, 
      $lte: new Date(filters.dateTo) 
    };
  }
  
  return this.find(query).sort({ appointmentDate: -1 });
};

// Static: Tìm theo nha sĩ
appointmentSchema.statics.findByDentist = function(dentistId, filters = {}) {
  const query = { dentistId };
  
  if (filters.status) {
    query.status = filters.status;
  }
  if (filters.date) {
    const date = new Date(filters.date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    query.appointmentDate = { $gte: startOfDay, $lte: endOfDay };
  }
  
  return this.find(query).sort({ appointmentDate: 1, startTime: 1 });
};

// Instance: Kiểm tra có thể hủy không
appointmentSchema.methods.canBeCancelled = function() {
  return this.status === 'confirmed' && this.isUpcoming;
};

// Instance: Kiểm tra có thể yêu cầu hủy không (cho bệnh nhân online)
appointmentSchema.methods.canRequestCancellation = function() {
  // Phải có status confirmed và đặt online bởi bệnh nhân
  if (this.status !== 'confirmed' || this.bookedByRole !== 'patient') {
    return { canRequest: false, reason: 'Chỉ bệnh nhân đặt online mới có thể yêu cầu hủy' };
  }
  
  // ✅ Tính khoảng cách thời gian theo múi giờ Việt Nam
  const now = new Date();
  
  // appointmentDate được lưu dạng UTC nửa đêm đại diện cho ngày Việt Nam
  // vd: 2025-12-03T17:00:00.000Z = 2025-12-04 00:00 Việt Nam
  // Parse startTime (định dạng: "HH:MM") và tạo datetime Việt Nam
  const [hours, minutes] = this.startTime.split(':').map(Number);
  
  // Chuyển appointmentDate từ UTC sang datetime Việt Nam
  const vietnamDateStr = this.appointmentDate.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }); // Trả về MM/DD/YYYY
  
  const [month, day, year] = vietnamDateStr.split('/');
  
  // Tạo datetime lịch hẹn theo múi giờ Việt Nam
  const appointmentDateTime = new Date(`${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+07:00`);
  
  const timeDiff = appointmentDateTime - now;
  const oneDayInMs = 24 * 60 * 60 * 1000; // 24 giờ tính bằng mili giây
  
  if (timeDiff < oneDayInMs) {
    return { 
      canRequest: false, 
      reason: 'Chỉ có thể yêu cầu hủy phiếu khám trước thời gian khám ít nhất 1 ngày' 
    };
  }
  
  return { canRequest: true };
};

// Instance: Kiểm tra có thể check-in không
appointmentSchema.methods.canCheckIn = function() {
  // Cho phép check-in nếu status là 'confirmed' hoặc 'no-show' (châm chước cho bệnh nhân đến muộn)
  // Nhân viên có thể check-in lịch hẹn từ ngày quá khứ hoặc tương lai
  return ['confirmed', 'no-show'].includes(this.status);
};

// Instance: Kiểm tra có thể hoàn thành không
appointmentSchema.methods.canComplete = function() {
  return ['checked-in', 'in-progress'].includes(this.status);
};

module.exports = mongoose.model('Appointment', appointmentSchema);

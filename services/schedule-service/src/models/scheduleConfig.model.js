const mongoose = require('mongoose');

const workShiftSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true },   // HH:mm
  isActive: { type: Boolean, default: true }
}, { _id: true });

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true }, // Tên kỳ nghỉ
  
  // 🆕 Phân biệt ngày nghỉ cố định (lặp lại mỗi tuần) vs ngày nghỉ trong khoảng thời gian
  isRecurring: { type: Boolean, default: false }, // true = ngày nghỉ cố định trong tuần
  
  // Cho ngày nghỉ cố định (isRecurring = true)
  dayOfWeek: { 
    type: Number, 
    min: 1, // 1 = Chủ nhật, 2 = Thứ 2, ..., 7 = Thứ 7
    max: 7,
    // Required nếu isRecurring = true, được validate trong pre-save hook
  },
  
  // Cho ngày nghỉ trong khoảng thời gian (isRecurring = false)
  startDate: { type: Date },
  endDate: { type: Date },
  
  note: { type: String },
  isActive: { type: Boolean, default: true },
  
  // Chỉ áp dụng cho ngày nghỉ không cố định (isRecurring = false)
  // Ngày nghỉ cố định (isRecurring = true) không cần hasBeenUsed vì lặp lại mỗi tuần
  hasBeenUsed: { type: Boolean, default: false, index: true },
}, { 
  _id: true,
  timestamps: true 
});

// Validation: Kiểm tra logic cho ngày nghỉ cố định vs khoảng thời gian
holidaySchema.pre('save', function(next) {
  if (this.isRecurring) {
    // Ngày nghỉ cố định: PHẢI có dayOfWeek, KHÔNG được có startDate/endDate
    if (!this.dayOfWeek) {
      return next(new Error('Ngày nghỉ cố định phải có dayOfWeek (2-7 cho Thứ 2 - Thứ 7, 1 cho Chủ nhật)'));
    }
    if (this.startDate || this.endDate) {
      return next(new Error('Ngày nghỉ cố định không được có startDate/endDate'));
    }
    // Ngày nghỉ cố định không cần hasBeenUsed (luôn set = false)
    this.hasBeenUsed = false;
  } else {
    // Ngày nghỉ trong khoảng thời gian: PHẢI có startDate/endDate, KHÔNG được có dayOfWeek
    if (!this.startDate || !this.endDate) {
      return next(new Error('Ngày nghỉ trong khoảng thời gian phải có startDate và endDate'));
    }
    if (this.dayOfWeek) {
      return next(new Error('Ngày nghỉ trong khoảng thời gian không được có dayOfWeek'));
    }
    if (this.endDate < this.startDate) {
      return next(new Error('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu'));
    }
  }
  next();
});

// Cấu hình Lịch chính
const scheduleConfigSchema = new mongoose.Schema({
  singletonKey: {
    type: String,
    default: 'SCHEDULE_CONFIG_SINGLETON',
    unique: true,
    immutable: true
  },
  
  // Fixed 3 work shifts - user must provide startTime/endTime
  morningShift: {
    name: { type: String, default: 'Ca Sáng' },
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true },   // HH:mm
    isActive: { type: Boolean, default: true }
  },
  
  afternoonShift: {
    name: { type: String, default: 'Ca Chiều' },
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true },   // HH:mm
    isActive: { type: Boolean, default: true }
  },
  
  eveningShift: {
    name: { type: String, default: 'Ca Tối' },
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true },   // HH:mm
    isActive: { type: Boolean, default: true }
  },
  
  // Thời lượng và giới hạn
  unitDuration: { 
    type: Number, 
    required: true, 
    default: 15,
    min: 5,
    max: 180
  },
  
  maxBookingDays: { 
    type: Number, 
    required: true, 
    default: 30,
    min: 1,
    max: 365
  },
  
  // 🆕 Deposit amount per slot (tiền cọc mỗi slot)
  depositAmount: {
    type: Number,
    required: true,
    default: 100000, // 50,000 VND per slot
    min: 0
  }
}, { timestamps: true });

// Cấu hình Ngày nghỉ (collection riêng)
const holidayConfigSchema = new mongoose.Schema({
  holidays: {
    type: [holidaySchema],
    default: []
  }
}, { timestamps: true });

// Phương thức Singleton cho ScheduleConfig
scheduleConfigSchema.statics.getSingleton = async function() {
  let config = await this.findOne({ singletonKey: 'SCHEDULE_CONFIG_SINGLETON' });
  // Không tự động tạo config mới nếu chưa có, trả về null để caller xử lý
  return config;
};

scheduleConfigSchema.statics.updateSingleton = async function(updateData) {
  const config = await this.getSingleton();
  if (!config) {
    throw new Error('Schedule config chưa được khởi tạo. Vui lòng tạo config trước khi cập nhật.');
  }
  Object.assign(config, updateData);
  return await config.save();
};

// Các phương thức hỗ trợ
scheduleConfigSchema.methods.getWorkShifts = function() {
  return [
    this.morningShift,
    this.afternoonShift,
    this.eveningShift
  ].filter(shift => shift.isActive);
};

// Trả về quý/năm hiện tại theo múi giờ Việt Nam
scheduleConfigSchema.methods.getCurrentQuarter = function() {
  const now = new Date();
  // Chuyển sang múi giờ Việt Nam
  const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return Math.ceil((vnTime.getMonth() + 1) / 3);
};

scheduleConfigSchema.methods.getCurrentYear = function() {
  const now = new Date();
  // Chuyển sang múi giờ Việt Nam
  const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return vnTime.getFullYear();
};

// Biệt danh tương thích ngược
scheduleConfigSchema.methods.getCurrentQuarterVN = scheduleConfigSchema.methods.getCurrentQuarter;
scheduleConfigSchema.methods.getCurrentYearVN = scheduleConfigSchema.methods.getCurrentYear;

scheduleConfigSchema.methods.getQuarterDateRange = function(quarter, year) {
  const startMonth = (quarter - 1) * 3;
  
  // Tạo ngày bắt đầu quý theo timezone Việt Nam
  // Sử dụng Date constructor với local timezone (VN server time)
  const startDate = new Date(year, startMonth, 1, 0, 0, 0, 0);
  
  // Tạo ngày kết thúc quý (ngày cuối cùng của quý)
  const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  
  return { startDate, endDate };
};

// ❌ REMOVED: canGenerateQuarter() - lastQuarterGenerated field removed

// Hook trước khi lưu
scheduleConfigSchema.pre('save', function(next) {
  this.currentQuarter = this.getCurrentQuarter();
  this.currentYear = this.getCurrentYear();
  next();
});

module.exports = {
  ScheduleConfig: mongoose.model('ScheduleConfig', scheduleConfigSchema),
  HolidayConfig: mongoose.model('HolidayConfig', holidayConfigSchema)
};
const mongoose = require('mongoose');

const workShiftSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startTime: { type: String, required: true }, // HH:mm
  endTime: { type: String, required: true },   // HH:mm
  isActive: { type: Boolean, default: true }
}, { _id: true });

const holidaySchema = new mongoose.Schema({
  name: { type: String, required: true }, // Tên kỳ nghỉ
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  note: { type: String },
  isActive: { type: Boolean, default: true },
  hasBeenUsed: { type: Boolean, default: false, index: true },
  // Note: removed isRecurring per new requirement
}, { 
  _id: true,
  timestamps: true 
});

// Validation: endDate phải >= startDate
holidaySchema.pre('save', function(next) {
  if (this.endDate < this.startDate) {
    return next(new Error('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu'));
  }
  next();
});

// Main Schedule Configuration
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
  
  // Duration and limits
  unitDuration: { 
    type: Number, 
    required: true, 
    default: 15,
    min: 5,
    max: 180
  },
  
  // maxGenerateScheduleMonths removed per new requirement (generation is quarter-based)
  
  maxBookingDays: { 
    type: Number, 
    required: true, 
    default: 30,
    min: 1,
    max: 365
  },
  // Track the last generated quarter to prevent duplicates and enforce sequence
  lastQuarterGenerated: {
    quarter: { type: Number, default: null },
    year: { type: Number, default: null }
  }
}, { timestamps: true });

// Holiday Configuration (separate collection)
const holidayConfigSchema = new mongoose.Schema({
  holidays: {
    type: [holidaySchema],
    default: []
  }
}, { timestamps: true });

// Singleton methods for ScheduleConfig
scheduleConfigSchema.statics.getSingleton = async function() {
  let config = await this.findOne({ singletonKey: 'SCHEDULE_CONFIG_SINGLETON' });
  if (!config) {
    config = new this({});
    await config.save();
  }
  return config;
};

scheduleConfigSchema.statics.updateSingleton = async function(updateData) {
  const config = await this.getSingleton();
  Object.assign(config, updateData);
  return await config.save();
};

// Helper methods
scheduleConfigSchema.methods.getWorkShifts = function() {
  return [
    this.morningShift,
    this.afternoonShift,
    this.eveningShift
  ].filter(shift => shift.isActive);
};

// Return current quarter/year in Vietnam timezone
scheduleConfigSchema.methods.getCurrentQuarter = function() {
  const now = new Date();
  // Convert to Vietnam timezone
  const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return Math.ceil((vnTime.getMonth() + 1) / 3);
};

scheduleConfigSchema.methods.getCurrentYear = function() {
  const now = new Date();
  // Convert to Vietnam timezone
  const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  return vnTime.getFullYear();
};

// Backwards-compatible aliases
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

scheduleConfigSchema.methods.canGenerateQuarter = function(targetQuarter, targetYear) {
  const currentQuarter = this.getCurrentQuarter();
  const currentYear = this.getCurrentYear();
  
  // Chỉ được tạo quý hiện tại hoặc quý tiếp theo (bắt buộc tạo quý hiện tại trước)
  if (targetYear < currentYear) return false;
  if (targetYear === currentYear && targetQuarter < currentQuarter) return false;
  
  // Nếu muốn tạo quý tiếp theo, phải đã tạo quý hiện tại
  if (targetYear === currentYear && targetQuarter === currentQuarter + 1) {
    return this.lastQuarterGenerated?.quarter === currentQuarter && 
           this.lastQuarterGenerated?.year === currentYear;
  }
  
  // Chỉ cho phép tạo quý hiện tại
  if (targetYear === currentYear && targetQuarter === currentQuarter) return true;
  
  // Tạo quý 1 năm sau (chỉ khi đã tạo quý 4 năm hiện tại)
  if (targetYear === currentYear + 1 && targetQuarter === 1 && currentQuarter === 4) {
    return this.lastQuarterGenerated?.quarter === 4 && 
           this.lastQuarterGenerated?.year === currentYear;
  }
  
  return false;
};

// Pre-save hook
scheduleConfigSchema.pre('save', function(next) {
  this.currentQuarter = this.getCurrentQuarter();
  this.currentYear = this.getCurrentYear();
  next();
});

module.exports = {
  ScheduleConfig: mongoose.model('ScheduleConfig', scheduleConfigSchema),
  HolidayConfig: mongoose.model('HolidayConfig', holidayConfigSchema)
};
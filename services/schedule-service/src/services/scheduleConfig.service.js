const { ScheduleConfig, HolidayConfig } = require('../models/scheduleConfig.model');
const Slot = require('../models/slot.model');
const redis = require('../utils/redis.client');

const CACHE_KEY = 'schedule_config_cache';
const HOLIDAY_CACHE_KEY = 'holiday_config_cache';

// Helper function: Check if slots are used in date range
const checkSlotsUsageInDateRange = async (startDate, endDate) => {
  try {
    // Convert to Vietnam timezone dates for accurate comparison
    const startVN = new Date(startDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    const endVN = new Date(endDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    
    // Set time to cover full days
    startVN.setHours(0, 0, 0, 0);
    endVN.setHours(23, 59, 59, 999);
    
    // Find slots in date range that have appointments
    const usedSlots = await Slot.find({
      startTime: {
        $gte: startVN,
        $lte: endVN
      },
      appointmentId: { $ne: null }
    }).select('startTime endTime appointmentId roomId subRoomId');
    
    if (usedSlots.length > 0) {
      const slotDetails = usedSlots.map(slot => ({
        date: slot.dateVN,
        startTime: slot.startTimeVN,
        endTime: slot.endTimeVN,
        appointmentId: slot.appointmentId
      }));
      
      return {
        hasUsedSlots: true,
        usedSlots: slotDetails,
        count: usedSlots.length
      };
    }
    
    return { hasUsedSlots: false, usedSlots: [], count: 0 };
  } catch (error) {
    console.error('Error checking slots usage:', error);
    throw error;
  }
};

// Helper function: Hide slots in date range
const hideSlotsInDateRange = async (startDate, endDate) => {
  try {
    const startVN = new Date(startDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    const endVN = new Date(endDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    
    startVN.setHours(0, 0, 0, 0);
    endVN.setHours(23, 59, 59, 999);
    
    // Hide all slots in date range that are not used
    const result = await Slot.updateMany(
      {
        startTime: {
          $gte: startVN,
          $lte: endVN
        },
        appointmentId: null // Only hide unused slots
      },
      {
        $set: { isActive: false }
      }
    );
    
    console.log(`🔒 Đã ẩn ${result.modifiedCount} slots trong khoảng thời gian nghỉ`);
    return result.modifiedCount;
  } catch (error) {
    console.error('Error hiding slots:', error);
    throw error;
  }
};

// Helper function: Show slots in date range (when removing holiday)
const showSlotsInDateRange = async (startDate, endDate) => {
  try {
    const startVN = new Date(startDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    const endVN = new Date(endDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    
    startVN.setHours(0, 0, 0, 0);
    endVN.setHours(23, 59, 59, 999);
    
    // Show all slots in date range
    const result = await Slot.updateMany(
      {
        startTime: {
          $gte: startVN,
          $lte: endVN
        }
      },
      {
        $set: { isActive: true }
      }
    );
    
    console.log(`🔓 Đã hiện ${result.modifiedCount} slots sau khi xóa ngày nghỉ`);
    return result.modifiedCount;
  } catch (error) {
    console.error('Error showing slots:', error);
    throw error;
  }
};

// Mark holiday as used when schedule is created
const markHolidayAsUsed = async (holidayId) => {
  try {
    const holidayConfig = await HolidayConfig.findOne();
    if (!holidayConfig) return;

    const holiday = holidayConfig.holidays.id(holidayId);
    if (holiday && !holiday.hasBeenUsed) {
      holiday.hasBeenUsed = true;
      await holidayConfig.save();
      console.log(`✅ Đã đánh dấu holiday "${holiday.name}" đã được sử dụng`);
      
      // Update cache
      try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
    }
  } catch (error) {
    console.error('Error marking holiday as used:', error);
  }
};

// Check if any holidays are used in date range
const checkHolidaysUsedInDateRange = async (startDate, endDate) => {
  try {
    const holidayConfig = await HolidayConfig.findOne();
    if (!holidayConfig) return [];

    const startVN = new Date(startDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    const endVN = new Date(endDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
    
    const overlappingHolidays = holidayConfig.holidays.filter(holiday => {
      const holidayStart = new Date(holiday.startDate);
      const holidayEnd = new Date(holiday.endDate);
      
      // Check if date ranges overlap
      return !(endVN < holidayStart || startVN > holidayEnd);
    });

    return overlappingHolidays;
  } catch (error) {
    console.error('Error checking holidays in date range:', error);
    return [];
  }
};

// ===== SCHEDULE CONFIG (shifts, duration, limits, quarter tracking) =====
exports.getConfig = async () => {
  // Always get fresh data from database to ensure we have Mongoose document with methods
  const cfg = await ScheduleConfig.getSingleton();
  if (cfg) {
    try { 
      // Cache as JSON for other services that only need data
      await redis.set(CACHE_KEY, JSON.stringify(cfg)); 
    } catch (e) {}
  }
  return cfg; // Return Mongoose document with methods
};

exports.initializeConfig = async () => {
  // Check if config already exists
  const existing = await ScheduleConfig.findOne({ singletonKey: 'SCHEDULE_CONFIG_SINGLETON' });
  if (existing) {
    throw new Error('Cấu hình hệ thống đã tồn tại');
  }

  // Create default config with required shift times
  const defaultConfig = {
    morningShift: {
      name: 'Ca Sáng',
      startTime: '08:00',
      endTime: '12:00',
      isActive: true
    },
    afternoonShift: {
      name: 'Ca Chiều', 
      startTime: '13:00',
      endTime: '17:00',
      isActive: true
    },
    eveningShift: {
      name: 'Ca Tối',
      startTime: '18:00', 
      endTime: '21:00',
      isActive: true
    },
    unitDuration: 15,
    maxBookingDays: 30
  };

  const config = new ScheduleConfig(defaultConfig);
  await config.save();
  
  try { 
    await redis.set(CACHE_KEY, JSON.stringify(config)); 
  } catch (e) {
    console.warn('Cache set failed:', e.message);
  }
  
  return config;
};

exports.checkConfigExists = async () => {
  const config = await ScheduleConfig.findOne({ singletonKey: 'SCHEDULE_CONFIG_SINGLETON' });
  return !!config;
};

exports.updateConfig = async (data) => {
  const updated = await ScheduleConfig.updateSingleton(data);
  try { await redis.set(CACHE_KEY, JSON.stringify(updated)); } catch (e) {}
  return updated;
};

exports.getCurrentQuarterInfo = async () => {
  const config = await this.getConfig();
  return {
    quarter: config.getCurrentQuarter(),
    year: config.getCurrentYear(),
    lastGenerated: config.lastQuarterGenerated
  };
};

exports.canGenerateQuarter = async (quarter, year) => {
  const config = await this.getConfig();
  return config.canGenerateQuarter(quarter, year);
};

exports.markQuarterGenerated = async (quarter, year) => {
  const config = await this.getConfig();
  config.lastQuarterGenerated = { quarter, year };
  await config.save();
  try { await redis.set(CACHE_KEY, JSON.stringify(config)); } catch (e) {}
  return config;
};

// ===== HOLIDAY CONFIG (separate) =====
exports.getHolidays = async () => {
  try {
    const cached = await redis.get(HOLIDAY_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    // ignore cache errors
  }

  let holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    holidayConfig = new HolidayConfig({});
    await holidayConfig.save();
  }

  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
  return holidayConfig;
};



exports.addHoliday = async (holiday) => {
  // Ensure we operate on a mongoose document (not a cached plain object)
  let holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    holidayConfig = new HolidayConfig({ holidays: [] });
  }

  // Normalize and validate
  const h = {
    name: holiday.name,
    startDate: new Date(holiday.startDate),
    endDate: new Date(holiday.endDate),
    note: holiday.note
  };

  if (!h.name || isNaN(h.startDate.getTime()) || isNaN(h.endDate.getTime()) || h.endDate < h.startDate) {
    throw new Error('Invalid holiday: require name and valid startDate <= endDate');
  }

  // Check duplicate name
  if (holidayConfig.holidays.some(x => x.name === h.name)) {
    throw new Error(`Holiday name already exists: ${h.name}`);
  }

  // Check overlap with existing holidays
  for (const ex of holidayConfig.holidays) {
    const exStart = new Date(ex.startDate);
    const exEnd = new Date(ex.endDate);
    if (!(h.endDate < exStart || h.startDate > exEnd)) {
      throw new Error(`Holiday range overlaps with existing holiday '${ex.name}'`);
    }
  }

  // 🔹 NEW: Check if slots in this date range are already used
  console.log(`🔍 Kiểm tra slots đã được sử dụng trong khoảng ${h.startDate.toISOString().split('T')[0]} - ${h.endDate.toISOString().split('T')[0]}`);
  
  const slotUsage = await checkSlotsUsageInDateRange(h.startDate, h.endDate);
  
  if (slotUsage.hasUsedSlots) {
    // Found used slots - cannot create holiday
    const usedDates = [...new Set(slotUsage.usedSlots.map(slot => slot.date))];
    throw new Error(
      `Không thể tạo ngày nghỉ vì có ${slotUsage.count} lịch đã được sử dụng trong các ngày: ${usedDates.join(', ')}. ` +
      `Vui lòng hủy các cuộc hẹn trước khi tạo ngày nghỉ.`
    );
  }

  // No used slots - safe to create holiday and hide slots
  holidayConfig.holidays.push(h);
  await holidayConfig.save();

  // Hide slots in the holiday date range
  const hiddenCount = await hideSlotsInDateRange(h.startDate, h.endDate);
  console.log(`✅ Đã tạo ngày nghỉ "${h.name}" và ẩn ${hiddenCount} slots`);

  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
  return holidayConfig;
};

exports.removeHoliday = async (holidayId) => {
  // Ensure we operate on a mongoose document
  const holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    throw new Error('Holiday configuration not found');
  }

  // Find the holiday to check if it has been used
  const holidayToRemove = holidayConfig.holidays.find(h => h._id.toString() === holidayId.toString());
  if (!holidayToRemove) {
    throw new Error('Holiday not found');
  }

  // 🔹 Kiểm tra holiday đã được sử dụng chưa
  if (holidayToRemove.hasBeenUsed) {
    throw new Error(`Không thể xóa ngày nghỉ "${holidayToRemove.name}" vì đã được sử dụng trong hệ thống`);
  }

  const { startDate, endDate, name } = holidayToRemove;
  
  // Remove the holiday
  holidayConfig.holidays.pull(holidayId);
  await holidayConfig.save();

  // Show slots again in the date range
  const shownCount = await showSlotsInDateRange(startDate, endDate);
  console.log(`✅ Đã xóa ngày nghỉ "${name}" và hiện lại ${shownCount} slots`);

  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
  return holidayConfig;
};

// Update a single holiday by its id with validations
exports.updateHolidayById = async (holidayId, updates) => {
  const holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) throw new Error('Holiday configuration not found');

  // Try to find holiday by subdocument id
  let idx = holidayConfig.holidays.findIndex(h => h._id.toString() === holidayId.toString());

  // Fallback: if the client passed the HolidayConfig document id (not sub-id)
  // and there is exactly one holiday, allow updating that one for convenience.
  if (idx === -1) {
    if (holidayConfig._id.toString() === holidayId.toString() && holidayConfig.holidays.length === 1) {
      idx = 0;
    }
  }

  if (idx === -1) throw new Error('Holiday not found');

  const current = holidayConfig.holidays[idx];

  // 🔹 Kiểm tra holiday đã được sử dụng chưa
  if (current.hasBeenUsed) {
    throw new Error(`Không thể cập nhật ngày nghỉ "${current.name}" vì đã được sử dụng trong hệ thống`);
  }

  // Build proposed holiday
  const prop = {
    name: updates.name ?? current.name,
    startDate: updates.startDate ? new Date(updates.startDate) : new Date(current.startDate),
    endDate: updates.endDate ? new Date(updates.endDate) : new Date(current.endDate),
    note: updates.note ?? current.note
  };

  if (!prop.name || isNaN(prop.startDate.getTime()) || isNaN(prop.endDate.getTime()) || prop.endDate < prop.startDate) {
    throw new Error('Invalid holiday update: require name and valid startDate <= endDate');
  }

  // Check duplicate name among other holidays
  if (holidayConfig.holidays.some((h, i) => i !== idx && h.name === prop.name)) {
    throw new Error(`Holiday name already exists: ${prop.name}`);
  }

  // Check overlap with other holidays
  for (let i = 0; i < holidayConfig.holidays.length; i++) {
    if (i === idx) continue;
    const ex = holidayConfig.holidays[i];
    const exStart = new Date(ex.startDate);
    const exEnd = new Date(ex.endDate);
    if (!(prop.endDate < exStart || prop.startDate > exEnd)) {
      throw new Error(`Updated holiday range overlaps with existing holiday '${ex.name}'`);
    }
  }

  // 🔹 NEW: Check if dates are being changed
  const oldStartDate = new Date(current.startDate);
  const oldEndDate = new Date(current.endDate);
  const datesChanged = oldStartDate.getTime() !== prop.startDate.getTime() || 
                      oldEndDate.getTime() !== prop.endDate.getTime();

  if (datesChanged) {
    console.log(`📅 Ngày nghỉ "${current.name}" thay đổi từ ${oldStartDate.toISOString().split('T')[0]}-${oldEndDate.toISOString().split('T')[0]} ` +
                `sang ${prop.startDate.toISOString().split('T')[0]}-${prop.endDate.toISOString().split('T')[0]}`);

    // Show slots in old date range
    const oldShownCount = await showSlotsInDateRange(oldStartDate, oldEndDate);
    console.log(`🔓 Đã hiện lại ${oldShownCount} slots từ khoảng thời gian cũ`);

    // Check if new date range has used slots
    const slotUsage = await checkSlotsUsageInDateRange(prop.startDate, prop.endDate);
    
    if (slotUsage.hasUsedSlots) {
      // Rollback: hide slots in old range again
      await hideSlotsInDateRange(oldStartDate, oldEndDate);
      
      const usedDates = [...new Set(slotUsage.usedSlots.map(slot => slot.date))];
      throw new Error(
        `Không thể cập nhật ngày nghỉ vì có ${slotUsage.count} lịch đã được sử dụng trong các ngày mới: ${usedDates.join(', ')}. ` +
        `Vui lòng hủy các cuộc hẹn trước khi thay đổi ngày nghỉ.`
      );
    }

    // Hide slots in new date range
    const newHiddenCount = await hideSlotsInDateRange(prop.startDate, prop.endDate);
    console.log(`🔒 Đã ẩn ${newHiddenCount} slots trong khoảng thời gian mới`);
  }

  // Apply updates
  holidayConfig.holidays[idx].name = prop.name;
  holidayConfig.holidays[idx].startDate = prop.startDate;
  holidayConfig.holidays[idx].endDate = prop.endDate;
  holidayConfig.holidays[idx].note = prop.note;

  await holidayConfig.save();
  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
  return holidayConfig;
};

// Export helper functions for use in schedule service
exports.markHolidayAsUsed = markHolidayAsUsed;
exports.checkHolidaysUsedInDateRange = checkHolidaysUsedInDateRange;

const { ScheduleConfig, HolidayConfig } = require('../models/scheduleConfig.model');
const Slot = require('../models/slot.model');
const redis = require('../utils/redis.client');

const CACHE_KEY = 'schedule_config_cache';
const HOLIDAY_CACHE_KEY = 'holiday_config_cache';

// Mark holiday as used when schedule is created
const markHolidayAsUsed = async (holidayId) => {
  try {
    const holidayConfig = await HolidayConfig.findOne();
    if (!holidayConfig) return;

    const holiday = holidayConfig.holidays.id(holidayId);
    if (!holiday) return;
    
    // 🔹 Chỉ mark hasBeenUsed cho ngày nghỉ KHÔNG cố định
    if (holiday.isRecurring) {
      console.log(`ℹ️  Ngày nghỉ cố định "${holiday.name}" không cần đánh dấu hasBeenUsed`);
      return;
    }
    
    // Ngày nghỉ không cố định
    if (!holiday.hasBeenUsed) {
      holiday.hasBeenUsed = true;
      await holidayConfig.save();
      console.log(`✅ Đã đánh dấu ngày nghỉ "${holiday.name}" đã được sử dụng`);
      
      // Update cache
      try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); } catch (e) {}
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
    
    // 🔹 Chỉ trả về các ngày nghỉ KHÔNG cố định (isRecurring = false)
    // Ngày nghỉ cố định không cần mark hasBeenUsed
    const overlappingHolidays = holidayConfig.holidays.filter(holiday => {
      if (holiday.isRecurring) {
        return false; // Bỏ qua ngày nghỉ cố định
      }
      
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
      await redis.set(CACHE_KEY, JSON.stringify(cfg), { EX: 3600 }); // 1h TTL
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
    maxBookingDays: 30,
    depositAmount: 100000 // 🆕 Default deposit: 50,000 VND per slot
  };

  const config = new ScheduleConfig(defaultConfig);
  await config.save();
  
  try { 
    await redis.set(CACHE_KEY, JSON.stringify(config), { EX: 3600 }); // 1h TTL 
  } catch (e) {
    console.warn('Cache set failed:', e.message);
  }
  
  // 🆕 Tạo holiday config với 7 ngày nghỉ cố định (Chủ nhật + Thứ 2-7) mặc định isActive=false
  console.log('🗓️  Tạo holiday config với ngày nghỉ cố định mặc định...');
  
  let holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    const dayNames = {
      1: 'Chủ nhật',
      2: 'Thứ Hai',
      3: 'Thứ Ba',
      4: 'Thứ Tư',
      5: 'Thứ Năm',
      6: 'Thứ Sáu',
      7: 'Thứ Bảy'
    };
    
    // Tạo 7 ngày nghỉ cố định: 1=Chủ nhật, 2-7=Thứ 2 đến Thứ 7
    const defaultRecurringHolidays = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({
      name: `Nghỉ ${dayNames[dayOfWeek]}`,
      isRecurring: true,
      dayOfWeek: dayOfWeek,
      isActive: false, // Mặc định tắt, admin có thể bật lại nếu cần
      note: 'Ngày nghỉ cố định trong tuần (mặc định tắt)'
    }));
    
    holidayConfig = new HolidayConfig({
      holidays: defaultRecurringHolidays
    });
    
    await holidayConfig.save();
    console.log(`✅ Đã tạo ${defaultRecurringHolidays.length} ngày nghỉ cố định mặc định (isActive=false)`);
    
    try {
      await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 });
    } catch (e) {
      console.warn('Holiday cache set failed:', e.message);
    }
  }
  
  return config;
};

exports.checkConfigExists = async () => {
  const config = await ScheduleConfig.findOne({ singletonKey: 'SCHEDULE_CONFIG_SINGLETON' });
  return !!config;
};

exports.updateConfig = async (data) => {
  const updated = await ScheduleConfig.updateSingleton(data);
  try { await redis.set(CACHE_KEY, JSON.stringify(updated), { EX: 3600 }); } catch (e) {}
  return updated;
};

exports.getCurrentQuarterInfo = async () => {
  const config = await this.getConfig();
  return {
    quarter: config.getCurrentQuarter(),
    year: config.getCurrentYear()
  };
};

// ❌ REMOVED: canGenerateQuarter, markQuarterGenerated - lastQuarterGenerated field removed

// ===== HOLIDAY CONFIG (separate) =====
exports.getHolidays = async () => {
  try {
    const cached = await redis.get(HOLIDAY_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (err) {
    console.warn('⚠️ HOLIDAY_CACHE_KEY read error:', err.message);
  }

  // 🔄 AUTO-REBUILD: Cache miss, load from DB
  console.warn('⚠️ HOLIDAY_CACHE_KEY empty - rebuilding...');
  let holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    holidayConfig = new HolidayConfig({});
    await holidayConfig.save();
  }

  try { 
    await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); 
    console.log('✅ Rebuilt HOLIDAY_CACHE_KEY');
  } catch (e) {
    console.error('❌ Failed to rebuild HOLIDAY_CACHE_KEY:', e.message);
  }
  return holidayConfig;
};



exports.addHoliday = async (holiday) => {
  // Ensure we operate on a mongoose document (not a cached plain object)
  let holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    holidayConfig = new HolidayConfig({ holidays: [] });
  }

  const isRecurring = holiday.isRecurring === true;

  // 🔹 KHÔNG cho phép tạo ngày nghỉ cố định qua API
  // Các ngày cố định (Chủ nhật, Thứ 2-7) đã được tạo sẵn khi init config
  // User chỉ có thể toggle isActive của các ngày cố định đã có
  if (isRecurring) {
    throw new Error(
      'Không thể tạo ngày nghỉ cố định mới. ' +
      'Các ngày nghỉ cố định (Chủ nhật, Thứ 2-7) đã được tạo sẵn trong hệ thống. ' +
      'Bạn chỉ có thể bật/tắt các ngày nghỉ cố định đã có.'
    );
  }

  // 🆕 Tạo ngày nghỉ trong khoảng thời gian (KHÔNG cố định)
  const h = {
    name: holiday.name,
    isRecurring: false,
    startDate: new Date(holiday.startDate),
    endDate: new Date(holiday.endDate),
    note: holiday.note || '',
    isActive: true, // Ngày nghỉ khoảng thời gian luôn active khi tạo
    hasBeenUsed: false
  };

  // ✅ Validate: startDate và endDate phải hợp lệ
  if (!h.name || isNaN(h.startDate.getTime()) || isNaN(h.endDate.getTime()) || h.endDate < h.startDate) {
    throw new Error('Ngày nghỉ trong khoảng thời gian cần có name và startDate <= endDate hợp lệ');
  }

  // ✅ Validate: startDate phải > ngày hiện tại
  const now = new Date();
  now.setHours(0, 0, 0, 0); // Reset to start of day for comparison
  const startDateOnly = new Date(h.startDate);
  startDateOnly.setHours(0, 0, 0, 0);
  
  if (startDateOnly <= now) {
    throw new Error('Ngày bắt đầu phải lớn hơn ngày hiện tại');
  }

  // ✅ Validate: Tên không trùng (chỉ trong các ngày nghỉ không cố định)
  if (holidayConfig.holidays.some(x => !x.isRecurring && x.name === h.name)) {
    throw new Error(`Tên ngày nghỉ "${h.name}" đã tồn tại`);
  }
  
  console.log(`➕ Tạo ngày nghỉ khoảng thời gian: ${h.name} (${h.startDate.toISOString().split('T')[0]} - ${h.endDate.toISOString().split('T')[0]})`);

  // Add holiday
  holidayConfig.holidays.push(h);
  await holidayConfig.save();

  console.log(`✅ Đã tạo ngày nghỉ "${h.name}"`);

  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); } catch (e) {}
  return holidayConfig;
};

// 🆕 Nhiệm vụ 2.1: Tạo nhiều ngày nghỉ cùng lúc (bulk create)
exports.addHolidays = async (holidays) => {
  if (!Array.isArray(holidays) || holidays.length === 0) {
    throw new Error('Danh sách ngày nghỉ phải là mảng và không rỗng');
  }

  let holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    holidayConfig = new HolidayConfig({ holidays: [] });
  }

  const createdHolidays = [];
  const errors = [];

  for (let i = 0; i < holidays.length; i++) {
    const holiday = holidays[i];
    try {
      const isRecurring = holiday.isRecurring === true;

      if (isRecurring) {
        errors.push({
          index: i,
          name: holiday.name,
          error: 'Không thể tạo ngày nghỉ cố định mới qua API'
        });
        continue;
      }

      const h = {
        name: holiday.name,
        isRecurring: false,
        startDate: new Date(holiday.startDate),
        endDate: new Date(holiday.endDate),
        note: holiday.note || '',
        isActive: true,
        hasBeenUsed: false
      };

      if (!h.name || isNaN(h.startDate.getTime()) || isNaN(h.endDate.getTime()) || h.endDate < h.startDate) {
        errors.push({
          index: i,
          name: holiday.name,
          error: 'Dữ liệu không hợp lệ (name, startDate, endDate)'
        });
        continue;
      }

      // Check duplicate name
      if (holidayConfig.holidays.some(x => !x.isRecurring && x.name === h.name)) {
        errors.push({
          index: i,
          name: h.name,
          error: `Tên ngày nghỉ đã tồn tại`
        });
        continue;
      }

      // Check overlap
      let hasOverlap = false;
      for (const ex of holidayConfig.holidays) {
        if (ex.isRecurring) continue;
        const exStart = new Date(ex.startDate);
        const exEnd = new Date(ex.endDate);
        if (!(h.endDate < exStart || h.startDate > exEnd)) {
          errors.push({
            index: i,
            name: h.name,
            error: `Trùng với ngày nghỉ '${ex.name}'`
          });
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) continue;

      // Check existing slots
      const startOfDay = new Date(h.startDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(h.endDate);
      endOfDay.setHours(23, 59, 59, 999);
      
      const existingSlots = await Slot.countDocuments({
        $or: [
          { date: { $gte: startOfDay, $lte: endOfDay } },
          { startTime: { $gte: startOfDay, $lte: endOfDay } }
        ]
      });
      
      if (existingSlots > 0) {
        errors.push({
          index: i,
          name: h.name,
          error: `Đã có ${existingSlots} slots trong khoảng thời gian này`
        });
        continue;
      }

      // Success - add to config
      holidayConfig.holidays.push(h);
      createdHolidays.push(h);
      console.log(`✅ [${i}] Tạo ngày nghỉ: ${h.name}`);

    } catch (error) {
      errors.push({
        index: i,
        name: holiday.name || 'N/A',
        error: error.message
      });
    }
  }

  // Save if there are any successfully created holidays
  if (createdHolidays.length > 0) {
    await holidayConfig.save();
    try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); } catch (e) {}
  }

  return {
    success: createdHolidays.length,
    failed: errors.length,
    createdHolidays,
    errors
  };
};

// Helper function to get day name
function getDayName(dayOfWeek) {
  const names = {
    1: 'Chủ nhật',
    2: 'Thứ Hai',
    3: 'Thứ Ba',
    4: 'Thứ Tư',
    5: 'Thứ Năm',
    6: 'Thứ Sáu',
    7: 'Thứ Bảy'
  };
  return names[dayOfWeek] || 'Không xác định';
}

exports.removeHoliday = async (holidayId) => {
  // Ensure we operate on a mongoose document
  const holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    throw new Error('Holiday configuration not found');
  }

  // Find the holiday to check if it can be removed
  const holidayToRemove = holidayConfig.holidays.find(h => h._id.toString() === holidayId.toString());
  if (!holidayToRemove) {
    throw new Error('Holiday not found');
  }

  // 🔹 Kiểm tra ngày nghỉ cố định - KHÔNG được xóa
  if (holidayToRemove.isRecurring) {
    throw new Error(
      `Không thể xóa ngày nghỉ cố định "${holidayToRemove.name}". ` +
      `Ngày nghỉ cố định chỉ có thể tắt bằng cách set isActive=false.`
    );
  }

  // 🔹 Kiểm tra hasBeenUsed - KHÔNG cho xóa nếu đã sử dụng
  if (holidayToRemove.hasBeenUsed === true) {
    throw new Error(`Không thể xóa ngày nghỉ "${holidayToRemove.name}" vì đã được sử dụng trong hệ thống`);
  }

  // ✅ Ngày nghỉ không cố định (hasBeenUsed = false hoặc undefined) có thể xóa tự do
  // Remove the holiday
  holidayConfig.holidays.pull(holidayId);
  await holidayConfig.save();

  console.log(`✅ Đã xóa ngày nghỉ "${holidayToRemove.name}"`);

  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); } catch (e) {}
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

  // 🆕 Logic khác nhau cho ngày nghỉ cố định vs không cố định
  if (current.isRecurring) {
    // ===== NGÀY NGHỈ CỐ ĐỊNH =====
    // Chỉ cho phép update isActive và note, KHÔNG cho update dayOfWeek
    
    console.log(`📝 Update ngày nghỉ cố định "${current.name}"`);
    
    if (updates.dayOfWeek !== undefined && updates.dayOfWeek !== current.dayOfWeek) {
      throw new Error(
        `Không thể thay đổi dayOfWeek của ngày nghỉ cố định. ` +
        `Vui lòng xóa và tạo ngày nghỉ mới nếu cần thay đổi ngày trong tuần.`
      );
    }
    
    if (updates.startDate !== undefined || updates.endDate !== undefined) {
      throw new Error('Ngày nghỉ cố định không có startDate/endDate');
    }
    
    // Cho phép update isActive và note
    if (updates.isActive !== undefined) {
      holidayConfig.holidays[idx].isActive = updates.isActive;
      console.log(`  ➡️ isActive: ${current.isActive} → ${updates.isActive}`);
    }
    
    if (updates.name !== undefined) {
      holidayConfig.holidays[idx].name = updates.name;
      console.log(`  ➡️ name: "${current.name}" → "${updates.name}"`);
    }
    
    if (updates.note !== undefined) {
      holidayConfig.holidays[idx].note = updates.note;
      console.log(`  ➡️ note updated`);
    }
    
  } else {
    // ===== NGÀY NGHỈ KHÔNG CỐ ĐỊNH (KHOẢNG THỜI GIAN) =====
    
    console.log(`📝 Update ngày nghỉ khoảng thời gian "${current.name}"`);
    
    // ✅ Validate: Không cho phép update ngày nghỉ đã kết thúc (quá khứ)
    const now = new Date();
    const currentEndDate = new Date(current.endDate);
    currentEndDate.setHours(23, 59, 59, 999); // Set to end of day
    
    if (now > currentEndDate) {
      throw new Error(`Không thể cập nhật ngày nghỉ "${current.name}" vì đã kết thúc`);
    }
    
    // ✅ Allow updating isActive for non-recurring holidays (if not past)
    if (updates.isActive !== undefined) {
      holidayConfig.holidays[idx].isActive = updates.isActive;
      console.log(`  ➡️ isActive: ${current.isActive} → ${updates.isActive}`);
      
      // If only updating isActive, save and return early
      if (Object.keys(updates).length === 1 && updates.isActive !== undefined) {
        await holidayConfig.save();
        // ✅ Update Redis cache
        try { 
          await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); 
          console.log('✅ Updated holiday cache after toggle');
        } catch (e) {
          console.warn('⚠️ Failed to update holiday cache:', e.message);
        }
        return holidayConfig;
      }
    }
    
    // Kiểm tra holiday đã được sử dụng chưa
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

    // ✅ Validate: startDate và endDate phải hợp lệ
    if (!prop.name || isNaN(prop.startDate.getTime()) || isNaN(prop.endDate.getTime()) || prop.endDate < prop.startDate) {
      throw new Error('Invalid holiday update: require name and valid startDate <= endDate');
    }

    // ✅ Validate: startDate phải > ngày hiện tại (khi update dates)
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset to start of day for comparison
    const propStartDate = new Date(prop.startDate);
    propStartDate.setHours(0, 0, 0, 0);
    
    if (propStartDate <= today) {
      throw new Error('Ngày bắt đầu phải lớn hơn ngày hiện tại');
    }

    // ✅ Validate: Tên không trùng với ngày nghỉ khác
    if (holidayConfig.holidays.some((h, i) => i !== idx && !h.isRecurring && h.name === prop.name)) {
      throw new Error(`Tên ngày nghỉ "${prop.name}" đã tồn tại`);
    }

    // Apply updates
    holidayConfig.holidays[idx].name = prop.name;
    holidayConfig.holidays[idx].startDate = prop.startDate;
    holidayConfig.holidays[idx].endDate = prop.endDate;
    holidayConfig.holidays[idx].note = prop.note;
  }

  await holidayConfig.save();
  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 }); } catch (e) {}
  return holidayConfig;
};

// 🆕 Get blocked date ranges (months with existing schedules + existing non-recurring holidays)
exports.getBlockedDateRanges = async () => {
  try {
    const Schedule = require('../models/schedule.model');
    
    // 1. Get all schedules to find months with existing slots
    const schedules = await Schedule.find({}, 'startDate endDate').lean();
    
    const blockedMonths = new Set();
    const monthRanges = [];
    
    schedules.forEach(schedule => {
      const start = new Date(schedule.startDate);
      const end = new Date(schedule.endDate);
      
      // Get all months covered by this schedule
      let current = new Date(start.getFullYear(), start.getMonth(), 1);
      const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
      
      while (current <= endMonth) {
        const monthKey = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        
        if (!blockedMonths.has(monthKey)) {
          blockedMonths.add(monthKey);
          
          // Add range for this month
          const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
          const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0, 23, 59, 59);
          
          monthRanges.push({
            type: 'schedule',
            year: current.getFullYear(),
            month: current.getMonth() + 1,
            startDate: monthStart.toISOString(),
            endDate: monthEnd.toISOString()
          });
        }
        
        // Move to next month
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
      }
    });
    
    // 2. Get existing non-recurring holidays
    const holidayConfig = await HolidayConfig.findOne();
    const existingHolidays = [];
    
    if (holidayConfig) {
      holidayConfig.holidays.forEach(holiday => {
        if (!holiday.isRecurring) {
          existingHolidays.push({
            type: 'holiday',
            id: holiday._id.toString(),
            name: holiday.name,
            startDate: holiday.startDate.toISOString(),
            endDate: holiday.endDate.toISOString(),
            hasBeenUsed: holiday.hasBeenUsed || false
          });
        }
      });
    }
    
    return {
      blockedMonths: monthRanges,
      existingHolidays: existingHolidays.sort((a, b) => 
        new Date(a.startDate) - new Date(b.startDate)
      )
    };
  } catch (error) {
    console.error('Error getting blocked date ranges:', error);
    throw error;
  }
};

// Export helper functions for use in schedule service
exports.markHolidayAsUsed = markHolidayAsUsed;
exports.checkHolidaysUsedInDateRange = checkHolidaysUsedInDateRange;

/**
 * 🆕 Auto-initialize schedule config and holidays on service startup
 * Called when service starts to ensure default config exists
 */
exports.autoInitializeDefaults = async () => {
  try {
    console.log('🔍 Checking for existing schedule config...');
    
    // Check if schedule config exists
    const existingConfig = await ScheduleConfig.findOne({ singletonKey: 'SCHEDULE_CONFIG_SINGLETON' });
    
    if (!existingConfig) {
      console.log('⚙️  No schedule config found. Creating default config...');
      
      // Create default config
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
        await redis.set(CACHE_KEY, JSON.stringify(config), { EX: 3600 }); // 1h TTL 
      } catch (e) {
        console.warn('⚠️  Cache set failed:', e.message);
      }
      
      console.log('✅ Default schedule config created successfully');
    } else {
      console.log('✅ Schedule config already exists');
    }
    
    // Check if holiday config exists
    let holidayConfig = await HolidayConfig.findOne();
    
    if (!holidayConfig) {
      console.log('🗓️  No holiday config found. Creating default recurring holidays...');
      
      const dayNames = {
        1: 'Chủ nhật',
        2: 'Thứ Hai',
        3: 'Thứ Ba',
        4: 'Thứ Tư',
        5: 'Thứ Năm',
        6: 'Thứ Sáu',
        7: 'Thứ Bảy'
      };
      
      // Create 7 recurring holidays (Sunday to Saturday)
      const defaultRecurringHolidays = [1, 2, 3, 4, 5, 6, 7].map(dayOfWeek => ({
        name: `Nghỉ ${dayNames[dayOfWeek]}`,
        isRecurring: true,
        dayOfWeek: dayOfWeek,
        isActive: false, // Default to inactive, admin can enable if needed
        note: 'Ngày nghỉ cố định trong tuần (mặc định tắt)'
      }));
      
      holidayConfig = new HolidayConfig({
        holidays: defaultRecurringHolidays
      });
      
      await holidayConfig.save();
      console.log(`✅ Created ${defaultRecurringHolidays.length} default recurring holidays (all inactive)`);
      
      try {
        await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig), { EX: 3600 });
      } catch (e) {
        console.warn('⚠️  Holiday cache set failed:', e.message);
      }
    } else {
      console.log('✅ Holiday config already exists');
    }
    
    console.log('🎉 Schedule service defaults initialization complete!');
    
  } catch (error) {
    console.error('❌ Error auto-initializing defaults:', error);
    // Don't throw - service should still start even if initialization fails
  }
};

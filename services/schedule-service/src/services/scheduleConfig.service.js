const { ScheduleConfig, HolidayConfig } = require('../models/scheduleConfig.model');
const redis = require('../utils/redis.client');

const CACHE_KEY = 'schedule_config_cache';
const HOLIDAY_CACHE_KEY = 'holiday_config_cache';

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

  // Check overlap with existing
  for (const ex of holidayConfig.holidays) {
    const exStart = new Date(ex.startDate);
    const exEnd = new Date(ex.endDate);
    if (!(h.endDate < exStart || h.startDate > exEnd)) {
      throw new Error(`Holiday range overlaps with existing holiday '${ex.name}'`);
    }
  }

  holidayConfig.holidays.push(h);
  await holidayConfig.save();
  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
  return holidayConfig;
};

exports.removeHoliday = async (holidayId) => {
  // Ensure we operate on a mongoose document
  const holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    throw new Error('Holiday configuration not found');
  }

  holidayConfig.holidays.pull(holidayId);
  await holidayConfig.save();
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

  // Apply updates
  holidayConfig.holidays[idx].name = prop.name;
  holidayConfig.holidays[idx].startDate = prop.startDate;
  holidayConfig.holidays[idx].endDate = prop.endDate;
  holidayConfig.holidays[idx].note = prop.note;

  await holidayConfig.save();
  try { await redis.set(HOLIDAY_CACHE_KEY, JSON.stringify(holidayConfig)); } catch (e) {}
  return holidayConfig;
};

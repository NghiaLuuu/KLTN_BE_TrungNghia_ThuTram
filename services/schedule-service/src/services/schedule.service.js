const scheduleRepo = require('../repositories/schedule.repository');
const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');
const cfgService = require('./scheduleConfig.service');
const { publishToQueue } = require('../utils/rabbitClient');
const Schedule = require('../models/schedule.model');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const isSameOrBefore = require('dayjs/plugin/isSameOrBefore');
const isSameOrAfter = require('dayjs/plugin/isSameOrAfter');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

// ✅ dayjs installed successfully
// Helper functions
function toVNDateOnlyString(d) {
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vn.getFullYear();
  const m = String(vn.getMonth() + 1).padStart(2, '0');
  const day = String(vn.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ⭐ Helper to format Date to HH:mm in Vietnam timezone
function toVNTimeString(d) {
  if (!d) return null;
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const h = String(vn.getHours()).padStart(2, '0');
  const m = String(vn.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ⭐ Helper to format Date to full ISO string in Vietnam timezone
function toVNDateTimeString(d) {
  if (!d) return null;
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const dateStr = toVNDateOnlyString(d);
  const timeStr = toVNTimeString(d);
  return `${dateStr} ${timeStr}`;
}

// 🆕 MOVED TO TOP: GET STAFF SCHEDULE (Fix export issue)
async function getStaffSchedule({ staffId, fromDate, toDate }) {
  try {
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    
    // Lấy tất cả slots mà staff được assign
    const slots = await slotRepo.findWithPopulate({
      $or: [
        { dentist: staffId },
        { nurse: staffId }
      ],
      date: { $gte: startDate, $lte: endDate }
    }, [
      {
        path: 'scheduleId',
        populate: { path: 'roomId', select: 'name roomNumber' }
      }
    ])
    .sort({ date: 1, startTime: 1 });
    
    // Format schedule
    const schedule = slots.map(slot => {
      const assignedAs = slot.dentist?.toString() === staffId ? 'dentist' : 'nurse';
      const roomName = slot.scheduleId?.roomId?.name || 'N/A';
      
      return {
        _id: slot._id,
        slotId: slot._id,
        scheduleId: slot.scheduleId?._id,
        date: slot.date, // Date object (UTC)
        dateStr: toVNDateOnlyString(slot.date), // YYYY-MM-DD (VN timezone)
        shiftName: slot.shiftName,
        startTime: toVNTimeString(slot.startTime), // ⭐ HH:mm string (VN timezone)
        endTime: toVNTimeString(slot.endTime), // ⭐ HH:mm string (VN timezone)
        startDateTime: toVNDateTimeString(slot.startTime), // ⭐ YYYY-MM-DD HH:mm (VN timezone)
        endDateTime: toVNDateTimeString(slot.endTime), // ⭐ YYYY-MM-DD HH:mm (VN timezone)
        duration: slot.duration,
        roomName,
        roomId: slot.scheduleId?.roomId?._id,
        subRoomId: slot.subRoomId || null,
        assignedAs
      };
    });
    
    // Thống kê
    const stats = {
      total: schedule.length,
      asDentist: schedule.filter(s => s.assignedAs === 'dentist').length,
      asNurse: schedule.filter(s => s.assignedAs === 'nurse').length,
      dateRange: {
        from: fromDate,
        to: toDate
      }
    };
    
    return { schedule, stats };
    
  } catch (error) {
    console.error('❌ Error getting staff schedule:', error);
    throw error;
  }
}

exports.getStaffSchedule = getStaffSchedule;

// 🆕 SERVICE: Check conflicts for selected slots (Optimized approach)
async function checkConflictsForSlots({ slots }) {
  try {
    const slotRepo = require('../repositories/slot.repository');
    
    if (!slots || !Array.isArray(slots) || slots.length === 0) {
      throw new Error('slots array is required');
    }
    
    console.log(`⚡ Checking conflicts for ${slots.length} selected slots`);
    
    // Build OR queries for overlapping slots
    const conflictQueries = slots.map(slot => {
      const slotDate = new Date(slot.date);
      const slotStart = new Date(slot.startTime);
      const slotEnd = new Date(slot.endTime);
      
      return {
        startTime: { 
          $gte: new Date(slotDate.setHours(0, 0, 0, 0)),
          $lt: new Date(slotDate.setHours(23, 59, 59, 999))
        },
        // Time overlap: existing.start < new.end AND new.start < existing.end
        $and: [
          { startTime: { $lt: slotEnd } },
          { endTime: { $gt: slotStart } }
        ]
      };
    });
    
    // Query: Find all slots that overlap with selected slots
    const Slot = require('../models/slot.model');
    const conflictingSlots = await Slot.find({
      $or: conflictQueries
    })
    .select('_id dentist nurse startTime endTime date shiftName roomId subRoomId')
    .lean();
    
    console.log(`📊 Found ${conflictingSlots.length} potentially conflicting slots`);
    
    // Extract conflicting staff IDs and build conflict details
    const conflictingDentists = new Set();
    const conflictingNurses = new Set();
    const conflictDetails = {}; // { staffId: [conflicts] }
    const staffStats = {}; // { staffId: { total, asDentist, asNurse } }
    
    conflictingSlots.forEach(slot => {
      // Process dentists
      const dentists = Array.isArray(slot.dentist) 
        ? slot.dentist.map(d => d?.toString()).filter(Boolean)
        : (slot.dentist ? [slot.dentist.toString()] : []);
      
      dentists.forEach(dentistId => {
        conflictingDentists.add(dentistId);
        
        // Add conflict detail
        if (!conflictDetails[dentistId]) conflictDetails[dentistId] = [];
        conflictDetails[dentistId].push({
          slotId: slot._id,
          date: slot.startTime,
          dateStr: toVNDateOnlyString(slot.startTime),
          shiftName: slot.shiftName,
          startTime: toVNTimeString(slot.startTime),
          endTime: toVNTimeString(slot.endTime),
          startDateTime: toVNDateTimeString(slot.startTime),
          endDateTime: toVNDateTimeString(slot.endTime),
          roomId: slot.roomId,
          subRoomId: slot.subRoomId,
          assignedAs: 'dentist'
        });
        
        // Update stats
        if (!staffStats[dentistId]) {
          staffStats[dentistId] = { total: 0, asDentist: 0, asNurse: 0 };
        }
        staffStats[dentistId].total++;
        staffStats[dentistId].asDentist++;
      });
      
      // Process nurses
      const nurses = Array.isArray(slot.nurse)
        ? slot.nurse.map(n => n?.toString()).filter(Boolean)
        : (slot.nurse ? [slot.nurse.toString()] : []);
      
      nurses.forEach(nurseId => {
        conflictingNurses.add(nurseId);
        
        // Add conflict detail
        if (!conflictDetails[nurseId]) conflictDetails[nurseId] = [];
        conflictDetails[nurseId].push({
          slotId: slot._id,
          date: slot.startTime,
          dateStr: toVNDateOnlyString(slot.startTime),
          shiftName: slot.shiftName,
          startTime: toVNTimeString(slot.startTime),
          endTime: toVNTimeString(slot.endTime),
          startDateTime: toVNDateTimeString(slot.startTime),
          endDateTime: toVNDateTimeString(slot.endTime),
          roomId: slot.roomId,
          subRoomId: slot.subRoomId,
          assignedAs: 'nurse'
        });
        
        // Update stats
        if (!staffStats[nurseId]) {
          staffStats[nurseId] = { total: 0, asDentist: 0, asNurse: 0 };
        }
        staffStats[nurseId].total++;
        staffStats[nurseId].asNurse++;
      });
    });
    
    console.log(`✅ Conflicts detected: ${conflictingDentists.size} dentists, ${conflictingNurses.size} nurses`);
    
    return {
      conflictingDentists: Array.from(conflictingDentists),
      conflictingNurses: Array.from(conflictingNurses),
      conflictDetails,
      staffStats,
      totalConflictingSlots: conflictingSlots.length
    };
    
  } catch (error) {
    console.error('❌ Error checking conflicts for slots:', error);
    throw error;
  }
}

exports.checkConflictsForSlots = checkConflictsForSlots;

// Helper: Get Vietnam timezone date
function getVietnamDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
}

// Helper: Check if current date is exactly the last day of month
function isLastDayOfMonth(date = null) {
  const checkDate = date || getVietnamDate();
  const currentDay = checkDate.getDate();
  
  // Get last day of current month
  const year = checkDate.getFullYear();
  const month = checkDate.getMonth(); // 0-based
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
  
  // Check if current day is exactly the last day
  return currentDay === lastDayOfMonth;
}

// Convert a Vietnam local date-time (y-m-d h:m) to a UTC Date instance
function fromVNToUTC(y, m, d, h, min) {
  // Stable regardless of server TZ: VN is UTC+7 => subtract 7 hours in UTC
  return new Date(Date.UTC(y, m - 1, d, h - 7, min, 0, 0));
}

// Get UTC Date that represents Vietnam local midnight for a y-m-d
function vnMidnightUTC(y, m, d) {
  // 00:00 VN = previous day 17:00Z; using -7 hours in UTC avoids server TZ issues
  return new Date(Date.UTC(y, m - 1, d, -7, 0, 0, 0));
}

// Helper: Calculate quarter info
function getQuarterInfo(date = null) {
  const vnDate = date ? new Date(date.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})) : getVietnamDate();
  const quarter = Math.ceil((vnDate.getMonth() + 1) / 3);
  const year = vnDate.getFullYear();
  return { quarter, year };
}

// Helper: Kiểm tra có phải ngày cuối quý không (31/3, 30/6, 30/9, 31/12)
function isLastDayOfQuarter(date = null) {
  const vnDate = date ? new Date(date.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})) : getVietnamDate();
  const day = vnDate.getDate();
  const month = vnDate.getMonth() + 1; // JavaScript month is 0-based
  
  // Các ngày cuối quý
  const quarterEndDays = [
    { month: 3, day: 31 },  // Q1
    { month: 6, day: 30 },  // Q2  
    { month: 9, day: 30 },  // Q3
    { month: 12, day: 31 }  // Q4
  ];
  
  return quarterEndDays.some(end => end.month === month && end.day === day);
}

// Helper: Tính quý tiếp theo để tạo lịch khi là ngày cuối quý
function getNextQuarterForScheduling(date = null) {
  const vnDate = date ? new Date(date.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})) : getVietnamDate();
  
  if (isLastDayOfQuarter(vnDate)) {
    // Nếu là ngày cuối quý, return quý tiếp theo
    const currentQuarter = getQuarterInfo(vnDate);
    if (currentQuarter.quarter === 4) {
      // Q4 -> Q1 năm sau
      return { quarter: 1, year: currentQuarter.year + 1 };
    } else {
      // Q1,Q2,Q3 -> quý tiếp theo cùng năm
      return { quarter: currentQuarter.quarter + 1, year: currentQuarter.year };
    }
  } else {
    // Ngày bình thường, return quý hiện tại
    return getQuarterInfo(vnDate);
  }
}

// Helper: Get quarter date range (Vietnam timezone)
function getQuarterDateRange(quarter, year) {
  const startMonth = (quarter - 1) * 3;
  
  // Tạo ngày bắt đầu quý theo timezone Việt Nam
  const startDate = new Date(year, startMonth, 1);
  
  // Tạo ngày kết thúc quý (ngày cuối cùng của quý)
  const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  
  return { startDate, endDate };
}

// Helper: Quarter dates normalized to UTC (for API response)
function getQuarterUTCDates(quarter, year) {
  const startMonth = (quarter - 1) * 3;
  const startDateUTC = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const endDateUTC = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
  return { startDateUTC, endDateUTC };
}

// Helper: VN date-only strings for display
function getQuarterVNDateStrings(quarter, year) {
  const startMonth = (quarter - 1) * 3;
  const startVN = new Date(Date.UTC(year, startMonth, 1, 17, 0, 0, 0)); // 00:00+07:00
  const endVN = new Date(Date.UTC(year, startMonth + 3, 0, 17, 0, 0, 0));
  const toDateOnly = (d) => d.toISOString().split('T')[0];
  return { startDateVN: toDateOnly(startVN), endDateVN: toDateOnly(endVN) };
}

// Validate start/end dates against basic constraints
async function validateDates(startDate, endDate) {
  if (!startDate || !endDate) {
    throw new Error('startDate và endDate là bắt buộc');
  }

  const start = startDate instanceof Date ? new Date(startDate.getTime()) : new Date(startDate);
  const end = endDate instanceof Date ? new Date(endDate.getTime()) : new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Ngày bắt đầu hoặc kết thúc không hợp lệ');
  }

  if (start > end) {
    throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  }

  const nowVN = getVietnamDate();
  const vnTodayStart = new Date(nowVN.getFullYear(), nowVN.getMonth(), nowVN.getDate(), 0, 0, 0, 0);

  if (end < vnTodayStart) {
    throw new Error('Khoảng thời gian đã nằm hoàn toàn trong quá khứ');
  }

  return true;
}

// Helper: Get all active rooms from Redis cache (rooms_cache)
async function getAllRooms() {
  try {
    const cached = await redisClient.get('rooms_cache');
    if (!cached) return [];
    const allRooms = JSON.parse(cached);
    
    // ✅ Chỉ lấy rooms đang hoạt động và có autoScheduleEnabled = true
    const activeRooms = (allRooms || []).filter(room => 
      room.isActive === true && 
      room.autoScheduleEnabled !== false // default true nếu không có field này
    );
    
    console.log(`📋 Found ${activeRooms.length} active rooms out of ${allRooms.length} total rooms`);
    return activeRooms;
  } catch (error) {
    console.error('Failed to read rooms_cache from redis:', error);
    throw new Error('Không thể lấy danh sách phòng từ cache');
  }
}

function toObjectIdString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.$oid) return value.$oid;
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (value._id) return toObjectIdString(value._id);
  }
  return String(value);
}

async function getRoomByIdFromCache(roomId) {
  try {
    const cached = await redisClient.get('rooms_cache');
    if (!cached) return null;
    const rooms = JSON.parse(cached);
    const targetId = toObjectIdString(roomId);
    return rooms.find(room => toObjectIdString(room._id) === targetId) || null;
  } catch (error) {
    console.error('Failed to fetch room from cache:', error);
    return null;
  }
}

function calculateShiftDurationMinutes(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const parseToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return NaN;
    return hours * 60 + minutes;
  };

  const startMinutes = parseToMinutes(startTime);
  const endMinutes = parseToMinutes(endTime);

  if (Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) return 0;

  return endMinutes - startMinutes;
}

// Helper: Check if date is holiday (Vietnam calendar day)
async function isHoliday(date) {
  const holidayConfig = await cfgService.getHolidays();
  const holidays = holidayConfig?.holidays || [];

  const checkVN = toVNDateOnlyString(date);
  const checkDate = new Date(checkVN); // Parse back to Date for day of week check
  const dayOfWeek = checkDate.getDay() + 1; // JavaScript: 0=Sunday, 1=Monday... -> Convert to 1=Sunday, 2=Monday...
  
  // Get current date in VN timezone (00:00:00)
  const nowVN = getVietnamDate();
  nowVN.setHours(0, 0, 0, 0);
  
  // Tomorrow in VN
  const tomorrowVN = new Date(nowVN);
  tomorrowVN.setDate(tomorrowVN.getDate() + 1);
  
  const result = holidays.some(holiday => {
    // ===== 1. Kiểm tra ngày nghỉ CỐ ĐỊNH (lặp lại mỗi tuần) =====
    if (holiday.isRecurring && holiday.isActive) {
      // Chỉ kiểm tra nếu isActive = true
      return holiday.dayOfWeek === dayOfWeek;
    }
    
    // ===== 2. Kiểm tra ngày nghỉ KHOẢNG THỜI GIAN =====
    if (!holiday.isRecurring) {
      // Chỉ kiểm tra các ngày nghỉ trong tương lai (sau ngày hiện tại)
      // Không kiểm tra hasBeenUsed - tất cả ngày nghỉ đều được áp dụng
      
      if (checkDate <= nowVN) {
        return false; // Bỏ qua ngày trong quá khứ hoặc hôm nay
      }
      
      // Kiểm tra date có nằm trong [startDate, endDate] không
      const startVN = toVNDateOnlyString(new Date(holiday.startDate));
      const endVN = toVNDateOnlyString(new Date(holiday.endDate));
      return checkVN >= startVN && checkVN <= endVN;
    }
    
    return false;
  });
  
  return result;
}

// 🆕 Helper: Lấy holiday snapshot cho khoảng thời gian tạo lịch
async function getHolidaySnapshot(scheduleStartDate, scheduleEndDate) {
  const holidayConfig = await cfgService.getHolidays();
  const holidays = holidayConfig?.holidays || [];
  
  const recurringHolidays = [];
  const nonRecurringHolidays = [];
  const nonRecurringHolidayIds = []; // 🆕 Lưu IDs để update hasBeenUsed sau
  
  holidays.forEach(holiday => {
    if (holiday.isRecurring && holiday.isActive) {
      // Lưu ngày nghỉ cố định có isActive = true
      recurringHolidays.push({
        name: holiday.name,
        dayOfWeek: holiday.dayOfWeek,
        note: holiday.note || ''
      });
    } else if (!holiday.isRecurring) {
      // Kiểm tra ngày nghỉ không cố định có nằm trong khoảng thời gian tạo lịch không
      const holidayStart = new Date(holiday.startDate);
      const holidayEnd = new Date(holiday.endDate);
      const scheduleStart = new Date(scheduleStartDate);
      const scheduleEnd = new Date(scheduleEndDate);
      
      // Chỉ lưu các ngày nghỉ nằm trong hoặc overlap với khoảng thời gian tạo lịch
      if (holidayEnd >= scheduleStart && holidayStart <= scheduleEnd) {
        nonRecurringHolidays.push({
          name: holiday.name,
          startDate: holiday.startDate,
          endDate: holiday.endDate,
          note: holiday.note || ''
        });
        // 🆕 Lưu ID để update hasBeenUsed
        nonRecurringHolidayIds.push(holiday._id);
      }
    }
  });
  
  return {
    recurringHolidays,
    nonRecurringHolidays,
    nonRecurringHolidayIds // 🆕 Trả về IDs
  };
}

// 🆕 Helper: Kiểm tra ngày có phải holiday dựa trên snapshot
function isHolidayFromSnapshot(date, holidaySnapshot) {
  if (!holidaySnapshot) return false;
  
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  const dayOfWeek = checkDate.getDay() + 1; // 1=CN, 2=T2, ..., 7=T7
  
  // Kiểm tra ngày nghỉ cố định
  const recurringHolidays = holidaySnapshot.recurringHolidays || [];
  const isRecurringHoliday = recurringHolidays.some(h => h.dayOfWeek === dayOfWeek);
  
  if (isRecurringHoliday) return true;
  
  // Kiểm tra ngày nghỉ không cố định
  const nonRecurringHolidays = holidaySnapshot.nonRecurringHolidays || [];
  const isNonRecurringHoliday = nonRecurringHolidays.some(h => {
    const holidayStart = new Date(h.startDate);
    const holidayEnd = new Date(h.endDate);
    holidayStart.setHours(0, 0, 0, 0);
    holidayEnd.setHours(23, 59, 59, 999);
    
    return checkDate >= holidayStart && checkDate <= holidayEnd;
  });
  
  return isNonRecurringHoliday;
}

// Main function: Generate schedules for a quarter (all rooms)
async function generateQuarterSchedule(quarter, year) {
  try {
    const config = await cfgService.getConfig();
    if (!config) {
      throw new Error('Chưa có cấu hình hệ thống');
    }

    // Validate quarter
    if (quarter < 1 || quarter > 4) {
      throw new Error('Quý phải từ 1 đến 4');
    }

    // Config marker of last generated quarter (may be missing or partial)
    const lastGenerated = config.lastQuarterGenerated;

    // Get quarter date range (local VN for internal calculation)
    let { startDate, endDate } = getQuarterDateRange(quarter, year);
    const originalStartDate = new Date(startDate);
    const originalEndDate = new Date(endDate);

    // Hard guard: if any schedules already exist for this quarter, block duplicate generation
    const existingInQuarter = await scheduleRepo.findByDateRange(originalStartDate, originalEndDate);
    if (existingInQuarter && existingInQuarter.length > 0) {
      throw new Error(`Quý ${quarter}/${year} đã được tạo trước đó. Không thể tạo lại.`);
    }

    // If the requested quarter has fully ended before now (VN), block generation
    const nowVN = getVietnamDate();
    if (endDate < nowVN) {
      throw new Error(`Không thể tạo lịch cho quý ${quarter}/${year} vì đã kết thúc (theo giờ VN)`);
    }

    // 🆕 KIỂM TRA NGÀY CUỐI QUÝ: Không cho tạo lịch trong ngày cuối quý
    if (isLastDayOfQuarter(nowVN)) {
      const nextQuarter = getNextQuarterForScheduling(nowVN);
      throw new Error(`Hôm nay là ngày cuối quý. Vui lòng tạo lịch cho quý ${nextQuarter.quarter}/${nextQuarter.year} thay thế.`);
    }

    // If current quarter, start from the NEXT day (VN), not from today or the 1st
    const current = getQuarterInfo();
    if (year === current.year && quarter === current.quarter) {
      const startNextDay = new Date(
        nowVN.getFullYear(),
        nowVN.getMonth(),
        nowVN.getDate() + 1,
        0, 0, 0, 0
      );
      if (startNextDay > startDate) startDate = startNextDay;
    }
    
    // Get current Vietnam time
    const currentQuarter = getQuarterInfo();
    
    // Validate: không tạo lịch quá trong quá khứ
    if (year < currentQuarter.year || (year === currentQuarter.year && quarter < currentQuarter.quarter)) {
      throw new Error('Không thể tạo lịch cho quý trong quá khứ');
    }

    // Duplicate prevention based on config marker (only if marker is valid)
    // NOTE: previous behavior blocked recreation purely based on the config.marker even if DB records were removed.
    // To allow manual cleanup (delete schedules/slots) followed by recreation, we first check the DB: if there are
    // no schedules in the requested quarter, allow recreation regardless of the config marker. If schedules exist,
    // keep enforcing the config marker to avoid accidental duplicate generation.
    const hasValidMarker = lastGenerated && Number.isInteger(lastGenerated.quarter) && Number.isInteger(lastGenerated.year);
    if (hasValidMarker) {
      const requestedIdx = year * 4 + quarter;
      const lastIdx = lastGenerated.year * 4 + lastGenerated.quarter;

      // If there are any schedules in the DB for this quarter, respect the marker and block recreation when appropriate
      const schedulesInQuarter = await scheduleRepo.findByDateRange(originalStartDate, originalEndDate);
      const hasSchedules = schedulesInQuarter && schedulesInQuarter.length > 0;

      if (hasSchedules) {
        if (requestedIdx <= lastIdx) {
          throw new Error(`Quý ${quarter}/${year} đã được tạo rồi. Không thể tạo lại.`);
        }
      } else {
        // No schedules exist in DB for this quarter: allow recreation even if config marker indicates it was generated before.
        // This supports manual deletion flows where operator removed schedules and expects to recreate the quarter.
      }
    }

    // Enforce sequence from current quarter onward
    const requestedIdx = year * 4 + quarter;
    const currentIdx = currentQuarter.year * 4 + currentQuarter.quarter;
    if (requestedIdx > currentIdx) {
      if (!hasValidMarker || (lastGenerated.year * 4 + lastGenerated.quarter) < currentIdx) {
        // Must create current quarter first
        throw new Error(`Phải tạo lịch quý hiện tại (Quý ${currentQuarter.quarter}/${currentQuarter.year}) trước`);
      }
      const lastIdx = lastGenerated.year * 4 + lastGenerated.quarter;
      if (requestedIdx !== lastIdx + 1) {
        // Compute next expected quarter after lastGenerated
        const nextQ = lastGenerated.quarter === 4 ? 1 : lastGenerated.quarter + 1;
        const nextY = lastGenerated.quarter === 4 ? lastGenerated.year + 1 : lastGenerated.year;
        throw new Error(`Phải tạo lịch quý ${nextQ}/${nextY} trước khi tạo quý ${quarter}/${year}`);
      }
    }

    // Get all rooms
    const rooms = await getAllRooms();
    if (!rooms || rooms.length === 0) {
      throw new Error('Không có phòng nào để tạo lịch');
    }

    const results = [];
    
    // Generate schedule for each room
    for (const room of rooms) {
      try {
        const roomSchedules = await generateScheduleForRoom(room, startDate, endDate, config);
        results.push({
          roomId: room._id,
          roomName: room.name,
          success: true,
          scheduleCount: roomSchedules.length,
          message: `Tạo thành công ${roomSchedules.length} lịch`
        });
      } catch (error) {
        results.push({
          roomId: room._id,
          roomName: room.name,
          success: false,
          error: error.message
        });
      }
    }

    // Mark quarter as generated if at least some rooms succeeded
    const successCount = results.filter(r => r.success).length;
    if (successCount > 0) {
      await cfgService.markQuarterGenerated(quarter, year);
      
      // 🆕 Mark all successfully scheduled rooms as used
      try {
        const successfulResults = results.filter(r => r.success);
        for (const result of successfulResults) {
          const roomId = result.roomId;
          const originalRoom = rooms.find(r => r._id.toString() === roomId.toString());
          
          if (originalRoom) {
            await markMainRoomAsUsed(roomId);
            if (originalRoom.hasSubRooms && originalRoom.subRooms && originalRoom.subRooms.length > 0) {
              const activeSubRoomIds = originalRoom.subRooms
                .filter(subRoom => subRoom.isActive)
                .map(subRoom => subRoom._id);
              
              if (activeSubRoomIds.length > 0) {
                await markSubRoomsAsUsed(roomId, activeSubRoomIds);
              }
            }
          }
        }
      } catch (markError) {
        console.error('⚠️ Failed to mark some rooms as used:', markError);
        // Don't fail the entire operation due to room marking errors
      }
    }

    const { startDateUTC, endDateUTC } = getQuarterUTCDates(quarter, year);
    const { startDateVN, endDateVN } = getQuarterVNDateStrings(quarter, year);

    // 🔹 NEW: Mark any holidays in this quarter as used
    if (successCount > 0) {
      try {
        const overlappingHolidays = await cfgService.checkHolidaysUsedInDateRange(originalStartDate, originalEndDate);
        for (const holiday of overlappingHolidays) {
          await cfgService.markHolidayAsUsed(holiday._id);
        }
        if (overlappingHolidays.length > 0) {
          console.log(`📅 Đã đánh dấu ${overlappingHolidays.length} holidays đã được sử dụng trong quý ${quarter}/${year}`);
        }
      } catch (error) {
        console.error('⚠️ Error marking holidays as used:', error);
        // Don't fail schedule creation if holiday marking fails
      }
    }

    return {
      quarter,
      year,
      startDate: startDateUTC,
      endDate: endDateUTC,
      startDateVN,
      endDateVN,
      totalRooms: rooms.length,
      successCount,
      results
    };
    
  } catch (error) {
    throw new Error(`Lỗi tạo lịch quý: ${error.message}`);
  }
}

// ✅ Generate quarter schedule for a single room (for auto-schedule)
// Uses EXACT same logic as generateQuarterSchedule but for one room only
async function generateQuarterScheduleForSingleRoom(roomId, quarter, year) {
  try {
    const config = await cfgService.getConfig();
    if (!config) {
      throw new Error('Chưa có cấu hình hệ thống');
    }

    // Validate quarter
    if (quarter < 1 || quarter > 4) {
      throw new Error('Quý phải từ 1 đến 4');
    }

    // Get quarter date range (local VN for internal calculation)
    let { startDate, endDate } = getQuarterDateRange(quarter, year);
    const originalStartDate = new Date(startDate);
    const originalEndDate = new Date(endDate);

    // Hard guard: if any schedules already exist for this quarter AND room, block duplicate
    const existingInQuarter = await scheduleRepo.findByRoomAndDateRange(roomId, originalStartDate, originalEndDate);
    if (existingInQuarter && existingInQuarter.length > 0) {
      throw new Error(`Room ${roomId} already has schedules for Q${quarter}/${year}. Cannot recreate.`);
    }

    // If the requested quarter has fully ended before now (VN), block generation
    const nowVN = getVietnamDate();
    if (endDate < nowVN) {
      throw new Error(`Cannot create schedule for Q${quarter}/${year} as it has already ended (VN time)`);
    }

    // 🆕 KIỂM TRA NGÀY CUỐI QUÝ cho single room
    if (isLastDayOfQuarter(nowVN)) {
      const nextQuarter = getNextQuarterForScheduling(nowVN);
      throw new Error(`Today is the last day of quarter. Please create schedule for Q${nextQuarter.quarter}/${nextQuarter.year} instead.`);
    }

    // If current quarter, start from the NEXT day (VN), not from today or the 1st
    const current = getQuarterInfo();
    if (year === current.year && quarter === current.quarter) {
      const startNextDay = new Date(
        nowVN.getFullYear(),
        nowVN.getMonth(),
        nowVN.getDate() + 1,
        0, 0, 0, 0
      );
      if (startNextDay > startDate) startDate = startNextDay;
    }
    
    // Validate: không tạo lịch quá trong quá khứ
    const currentQuarter = getQuarterInfo();
    if (year < currentQuarter.year || (year === currentQuarter.year && quarter < currentQuarter.quarter)) {
      throw new Error('Không thể tạo lịch cho quý trong quá khứ');
    }

    // Get room from cache (fallback to fetch fresh if not found)
    let rooms = await getAllRooms();
    let room = rooms.find(r => r._id.toString() === roomId.toString());
    
    if (!room) {
      // Room might be newly created and not in cache yet, try fresh fetch
      console.log(`⚠️ Room ${roomId} không tìm thấy trong cache, thử fetch lại từ Redis...`);
      try {
        const cached = await redisClient.get('rooms_cache');
        if (cached) {
          const allRooms = JSON.parse(cached);
          room = allRooms.find(r => r._id.toString() === roomId.toString());
        }
      } catch (error) {
        console.error('Failed to re-fetch room from cache:', error);
      }
      
      if (!room) {
        throw new Error(`Không tìm thấy phòng ${roomId} trong hệ thống`);
      }
    }
    
    if (!room.isActive) {
      throw new Error(`Phòng ${roomId} hiện không hoạt động`);
    }
    
    if (room.autoScheduleEnabled === false) {
      throw new Error(`Phòng ${roomId} đã tắt tính năng tự động tạo lịch`);
    }

    // Generate schedule for the single room using same logic
    const roomSchedules = await generateScheduleForRoom(room, startDate, endDate, config);
    
    if (roomSchedules.length === 0) {
      throw new Error(`Không thể tạo lịch nào cho phòng ${roomId} trong Q${quarter}/${year}`);
    }

    // Mark room as used (same as manual generation)
    try {
      await markMainRoomAsUsed(roomId);
      
      if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
        const activeSubRoomIds = room.subRooms
          .filter(subRoom => subRoom.isActive)
          .map(subRoom => subRoom._id);
        
        if (activeSubRoomIds.length > 0) {
          await markSubRoomsAsUsed(roomId, activeSubRoomIds);
        }
      }
      
    } catch (markError) {
      console.error(`⚠️ Failed to mark room ${roomId} as used:`, markError);
      // Don't fail the entire operation due to room marking errors
    }

    const { startDateUTC, endDateUTC } = getQuarterUTCDates(quarter, year);
    const { startDateVN, endDateVN } = getQuarterVNDateStrings(quarter, year);

    // 🔹 NEW: Mark any holidays in this quarter as used
    try {
      const overlappingHolidays = await cfgService.checkHolidaysUsedInDateRange(originalStartDate, originalEndDate);
      for (const holiday of overlappingHolidays) {
        await cfgService.markHolidayAsUsed(holiday._id);
      }
      if (overlappingHolidays.length > 0) {
        console.log(`📅 Đã đánh dấu ${overlappingHolidays.length} holidays đã được sử dụng trong quý ${quarter}/${year} cho room ${roomId}`);
      }
    } catch (error) {
      console.error('⚠️ Error marking holidays as used:', error);
      // Don't fail schedule creation if holiday marking fails
    }

    return {
      quarter,
      year,
      roomId,
      roomName: room.name,
      startDate: startDateUTC,
      endDate: endDateUTC,
      startDateVN,
      endDateVN,
      scheduleCount: roomSchedules.length,
      success: true,
      message: `Successfully generated ${roomSchedules.length} schedules for Q${quarter}/${year}`
    };
    
  } catch (error) {
    throw new Error(`Failed to generate Q${quarter}/${year} for room ${roomId}: ${error.message}`);
  }
}

// Generate schedule for a specific room
async function generateScheduleForRoom(room, startDate, endDate, config) {
  // ✅ Kiểm tra room có đang hoạt động không
  if (!room.isActive) {
    console.log(`⚠️ Skipping room ${room.name} (ID: ${room._id}) - not active`);
    return [];
  }

  // ✅ Kiểm tra room có cho phép tự động tạo lịch không
  if (room.autoScheduleEnabled === false) {
    console.log(`⚠️ Skipping room ${room.name} (ID: ${room._id}) - auto schedule disabled`);
    return [];
  }

  console.log(`📅 Generating schedule for active room: ${room.name} (ID: ${room._id})`);

  const schedules = [];
  const currentDate = new Date(startDate);
  // Enforce start from next VN day at this layer too, in case caller passed earlier date
  const nowVN = getVietnamDate();
  const nextVN = new Date(nowVN.getFullYear(), nowVN.getMonth(), nowVN.getDate() + 1, 0, 0, 0, 0);
  if (currentDate < nextVN) {
    currentDate.setFullYear(nextVN.getFullYear(), nextVN.getMonth(), nextVN.getDate());
    currentDate.setHours(0, 0, 0, 0);
  }
  
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0];
    
    // Check if it's a holiday (remove weekend check)
    const isHolidayDay = await isHoliday(currentDate);
    
    if (!isHolidayDay) {
      // Check if schedule already exists
      const existingSchedule = await scheduleRepo.findByRoomAndDate(
        room._id, 
        new Date(currentDate)
      );
      
      if (!existingSchedule) {
        const schedule = await createDailySchedule(room, new Date(currentDate), config);
        if (schedule) { // Chỉ push nếu schedule được tạo thành công
          schedules.push(schedule);
        }
      }
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return schedules;
}

// Create daily schedule for a room (DEPRECATED - use createPeriodSchedule instead)
async function createDailySchedule(room, date, config) {
  // DEPRECATED: This only creates schedule for 1 day
  // For proper slot generation, use createPeriodSchedule instead
  console.warn('⚠️ createDailySchedule is deprecated - single day schedules cannot generate multi-day slots');
  
  // Get work shifts - chỉ lấy các shift đang hoạt động
  const allWorkShifts = config.getWorkShifts();
  const activeWorkShifts = allWorkShifts.filter(shift => shift.isActive === true);
  
  if (activeWorkShifts.length === 0) {
    console.log(`⚠️ No active work shifts found for room ${room.name} on ${toVNDateOnlyString(date)}`);
    return null; // Không tạo schedule nếu không có shift nào hoạt động
  }
  
  const schedule = {
    roomId: room._id,
    // Add startDate and endDate (same day for backward compatibility)
    startDate: new Date(date),
    endDate: new Date(date),
    // Keep dateVNStr for backward compatibility
    dateVNStr: toVNDateOnlyString(date),
    workShifts: activeWorkShifts.map(shift => ({
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      isActive: shift.isActive // Should all be true since we filtered above
    })),
    isActive: true,
    createdAt: getVietnamDate()
  };
  
  const savedSchedule = await scheduleRepo.create(schedule);
  
  // Generate slots for this schedule (now has startDate/endDate)
  await generateSlotsForSchedule(savedSchedule, room, config);
  
  return savedSchedule;
}

// Generate slots for a schedule (FIXED: Generate for all days in schedule)
async function generateSlotsForSchedule(schedule, room, config) {
  const effectiveDuration = Number.isFinite(slotDuration) && slotDuration > 0 ? slotDuration : 30;
  const slots = [];
  
  console.log('🔧 generateSlotsForSchedule called:');
  console.log('  📅 Schedule ID:', schedule._id);
  console.log('  🏥 Room:', room.name, '(ID:', room._id + ')');
  console.log('  📋 workShifts count:', schedule.workShifts?.length || 0);
  
  if (!schedule.workShifts || schedule.workShifts.length === 0) {
    console.log('  ❌ ERROR: No workShifts in schedule!');
    return slots;
  }
  
  // Get date range from schedule
  const scheduleStartDate = schedule.startDate;
  const scheduleEndDate = schedule.endDate;
  
  console.log(`  📆 Date range: ${scheduleStartDate} to ${scheduleEndDate}`);
  
  for (const shift of schedule.workShifts) {
    console.log(`  🔍 Processing shift: ${shift.name} (isActive: ${shift.isActive})`);
    
    if (!shift.isActive) {
      console.log(`    ⏭️ Skipped (inactive)`);
      continue;
    }
    
    // Use the UPDATE function logic - generate slots for all days
    const shiftSlots = await generateSlotsForShiftAllDays({
      scheduleId: schedule._id,
      roomId: room._id,
      subRoomId: null,
      shiftName: shift.name,
      shiftStart: shift.startTime,
      shiftEnd: shift.endTime,
      slotDuration: config.unitDuration || 30,
      scheduleStartDate,
      scheduleEndDate
    });
    
    console.log(`    ✅ Generated ${shiftSlots.length} slots for ${shift.name}`);
    slots.push(...shiftSlots);
  }
  
  console.log(`  📊 Total slots generated: ${slots.length}`);
  
  return slots;
}

// Generate slots for a specific shift
function generateSlotsForShift(schedule, room, shift, config) {
  // DEPRECATED: This function only generates for 1 day (schedule.dateVNStr)
  // Use generateSlotsForShiftAllDays instead
  console.warn('⚠️ generateSlotsForShift (single day) is deprecated, use generateSlotsForShiftAllDays');
  const slots = [];
  
  console.log(`    🔧 generateSlotsForShift: ${shift.name || shift.shiftName}`);
  console.log(`      Date: ${schedule.dateVNStr}`);
  console.log(`      Shift time: ${shift.startTime} - ${shift.endTime}`);
  console.log(`      Room hasSubRooms: ${room.hasSubRooms}`);
  
  // Parse start and end time
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  
  const [y, mo, d] = (schedule.dateVNStr).split('-').map(Number);
  // Build UTC Date objects that represent the Vietnam-local wall-clock times.
  // We convert VN local (y,mo,d,h,m) -> UTC instant using fromVNToUTC helper so stored Date is canonical UTC but
  // when interpreted in VN timezone will show the intended wall-clock time.
  const startTime = fromVNToUTC(y, mo, d, startHour, startMin);
  const endTime = fromVNToUTC(y, mo, d, endHour, endMin);
  
  console.log(`      Start UTC: ${startTime.toISOString()}`);
  console.log(`      End UTC: ${endTime.toISOString()}`);
  
  // Check if room has subrooms
  if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    console.log(`      Room has ${room.subRooms.length} subrooms`);
    
    // Room has subrooms - create slots based on unitDuration for each subroom
    const unitDuration = config.unitDuration || 15;
    let currentTime = startTime.getTime();
    const endMillis = endTime.getTime();
    const step = (unitDuration || 15) * 60 * 1000;

    let slotCount = 0;
    while (currentTime < endMillis) {
      const slotEndMillis = currentTime + step;
      if (slotEndMillis <= endMillis) {
        const slotStartUTC = new Date(currentTime);
        const slotEndUTC = new Date(slotEndMillis);
        // Create slot for each active subroom
        room.subRooms.forEach(subRoom => {
          // ✅ Chỉ tạo slot cho subroom đang hoạt động
          if (subRoom.isActive === true) {
            slots.push(createSlotData(schedule, room, subRoom, shift, slotStartUTC, slotEndUTC));
            slotCount++;
          } else {
            console.log(`      ⚠️ Skipped slot for inactive subroom: ${subRoom.name}`);
          }
        });
      }
      currentTime += step;
    }
    console.log(`      Created ${slotCount} slots for subrooms`);
  } else {
    console.log(`      Room WITHOUT subrooms - creating single slot`);
    // Room without subrooms - create one slot per shift (entire shift duration)
    slots.push(createSlotData(schedule, room, null, shift, startTime, endTime));
    console.log(`      Created 1 slot`);
  }
  
  console.log(`      ✅ Returning ${slots.length} slots`);
  return slots;
}

// NEW: Generate slots for a shift across ALL days in schedule (WORKING VERSION)
async function generateSlotsForShiftAllDays({
  scheduleId,
  roomId,
  subRoomId,
  shiftName,
  shiftStart,
  shiftEnd,
  slotDuration,
  scheduleStartDate,
  scheduleEndDate
}) {
  const slots = [];
  const currentDate = new Date(scheduleStartDate);
  const endDate = new Date(scheduleEndDate);
  
  console.log(`      🔧 generateSlotsForShiftAllDays: ${shiftName}`);
  console.log(`      📆 Date range: ${scheduleStartDate} to ${scheduleEndDate}`);
  console.log(`      ⏰ Shift time: ${shiftStart} - ${shiftEnd}`);
  console.log(`      ⏱️ Slot duration: ${slotDuration} minutes`);
  
  let dayCount = 0;
  let totalSlotsGenerated = 0;
  
  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();
    
    // Parse shift times (format: "HH:mm")
    const [startHour, startMin] = shiftStart.split(':').map(Number);
    const [endHour, endMin] = shiftEnd.split(':').map(Number);
    
    // Create UTC times (VN is UTC+7)
    let slotStartTime = new Date(Date.UTC(year, month - 1, day, startHour - 7, startMin, 0, 0));
    const shiftEndTime = new Date(Date.UTC(year, month - 1, day, endHour - 7, endMin, 0, 0));
    
    let slotsForDay = 0;
    
    // Generate slots within the shift
    while (slotStartTime < shiftEndTime) {
  const slotEndTime = new Date(slotStartTime.getTime() + effectiveDuration * 60 * 1000);
      
      if (slotEndTime > shiftEndTime) break; // Don't exceed shift end time
      
      slots.push({
        scheduleId,
        roomId,
        subRoomId: subRoomId || null,
        shiftName,
        startTime: new Date(slotStartTime),
        endTime: new Date(slotEndTime),
        date: new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0)), // Midnight VN time
  duration: effectiveDuration,
        isAvailable: true,
        isBooked: false,
        status: 'available'
      });
      
  slotStartTime = slotEndTime;
      slotsForDay++;
      totalSlotsGenerated++;
    }
    
    dayCount++;
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log(`      ✅ Generated ${totalSlotsGenerated} slots across ${dayCount} days`);
  
  // Bulk insert slots
  if (slots.length > 0) {
    await slotRepo.insertMany(slots);
    console.log(`      💾 Saved ${slots.length} slots to database`);
  }
  
  return slots;
}

// Create slot data object
function createSlotData(schedule, room, subRoom, shift, startTime, endTime) {
  // Helper to format a Date (UTC) into VN local 'YYYY-MM-DDTHH:mm'
  const toVNLocal = (dt) => {
    const vn = new Date(dt.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const yyyy = vn.getFullYear();
    const mm = String(vn.getMonth() + 1).padStart(2, '0');
    const dd = String(vn.getDate()).padStart(2, '0');
    const hh = String(vn.getHours()).padStart(2, '0');
    const mi = String(vn.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  };

  return {
    roomId: room._id,
    subRoomId: subRoom ? subRoom._id : null,
    scheduleId: schedule._id,
    // date is deprecated, keep null
    date: null,
    shiftName: shift.name,
    // startTime/endTime already UTC of the intended VN times
    startTime: new Date(startTime),
    endTime: new Date(endTime),
  // Note: VN-local display fields removed; caller will apply +7 when formatting on read
    dentist: null, // Will be assigned later
    nurse: null,   // Will be assigned later
    isBooked: false,
    isActive: true,
    createdAt: getVietnamDate()
  };
}

// Get available quarters to generate
async function getAvailableQuarters() {
  const currentQuarter = getQuarterInfo();
  const availableQuarters = [];

  // 🆕 LOGIC NGÀY CUỐI QUÝ: Nếu là ngày cuối quý, bắt đầu từ quý tiếp theo
  let startQuarter, startYear;
  if (isLastDayOfQuarter()) {
    const nextQuarter = getNextQuarterForScheduling();
    startQuarter = nextQuarter.quarter;
    startYear = nextQuarter.year;
    console.log(`📅 Hôm nay là ngày cuối quý, bắt đầu từ Q${startQuarter}/${startYear}`);
  } else {
    startQuarter = currentQuarter.quarter;
    startYear = currentQuarter.year;
  }

  // Build candidate quarters: từ quarter được tính toán đến hết năm, rồi sang năm sau
  const candidates = [];
  
  // Thêm các quý từ startQuarter đến cuối năm startYear
  for (let q = startQuarter; q <= 4; q++) {
    candidates.push({ quarter: q, year: startYear });
  }
  
  // Thêm các quý của năm tiếp theo (nếu startYear khác currentYear + 1)
  const nextYear = startYear === currentQuarter.year ? currentQuarter.year + 1 : startYear + 1;
  for (let q = 1; q <= 4; q++) {
    candidates.push({ quarter: q, year: nextYear });
  }

  const config = await cfgService.getConfig();
  const lastGenerated = config?.lastQuarterGenerated;
  const hasValidMarker = lastGenerated && Number.isInteger(lastGenerated.quarter) && Number.isInteger(lastGenerated.year);

  for (const c of candidates) {
    const { quarter, year } = c;
    const label = `Quý ${quarter}/${year}`;
  const isCurrent = year === currentQuarter.year && quarter === currentQuarter.quarter;

    // Determine if schedules exist in DB for this quarter
    const { startDate, endDate } = getQuarterDateRange(quarter, year);
    const schedulesInQuarter = await scheduleRepo.findByDateRange(startDate, endDate);
    const hasSchedules = schedulesInQuarter && schedulesInQuarter.length > 0;

    // Marker info
    const requestedIdx = year * 4 + quarter;
    const markerIdx = hasValidMarker ? (lastGenerated.year * 4 + lastGenerated.quarter) : null;
    const isMarked = hasValidMarker && markerIdx >= requestedIdx;

    // Determine creatable according to the same rules as generateQuarterSchedule (but do not throw)
    let isCreatable = true;

    // If DB already has schedules -> cannot create (would be duplicate)
    if (hasSchedules) {
      isCreatable = false;
    } else {
      // If quarter already ended in VN -> cannot create
      const nowVN = getVietnamDate();
      if (endDate < nowVN) isCreatable = false;

      // Cannot create quarters in the past (relative to current quarter VN)
      const currentIdx = currentQuarter.year * 4 + currentQuarter.quarter;
      if (year < currentQuarter.year || (year === currentQuarter.year && quarter < currentQuarter.quarter)) {
        isCreatable = false;
      }

      // If requested quarter is after current, ensure sequence rules
      if (isCreatable && requestedIdx > currentIdx) {
        // Need a valid marker and the marker must be >= currentIdx (i.e., current created or at least marker points to a quarter >= current)
        if (!hasValidMarker || markerIdx < currentIdx) {
          isCreatable = false;
        } else {
          // requested must be exactly lastIdx + 1
          if (requestedIdx !== markerIdx + 1) isCreatable = false;
        }
      }

      // If requested <= markerIdx then it's considered already generated (but since hasSchedules is false, we allow recreation — treat as not creatable)
      if (hasValidMarker && requestedIdx <= markerIdx) {
        isCreatable = false;
      }
    }

    availableQuarters.push({
      quarter,
      year,
      label,
      hasSchedules,
      isCreated: isMarked || hasSchedules,
      isCreatable
    });
  }

  return availableQuarters;
}

async function countSlotsForQuarter(subRoomIds, quarter, year) {
  if (!Array.isArray(subRoomIds) || subRoomIds.length === 0) {
    return 0;
  }

  const { startDate, endDate } = getQuarterDateRange(quarter, year);

  const counts = await Promise.all(
    subRoomIds.map(subRoomId =>
      slotRepo.countSlots({
        subRoomId,
        startTime: { $gte: startDate, $lte: endDate }
      })
    )
  );

  return counts.reduce((sum, val) => sum + (val || 0), 0);
}

// Get schedules by room and date range
async function getSchedulesByRoom(roomId, startDate, endDate) {
  const schedules = await scheduleRepo.findByRoomAndDateRange(roomId, startDate, endDate);
  
  // Lấy tên room từ cache
  try {
    const roomCache = await redisClient.get('rooms_cache');
    if (roomCache) {
      const rooms = JSON.parse(roomCache);
      const room = rooms.find(r => r._id === roomId);
      
      // Thêm roomName vào mỗi schedule
      const schedulesWithRoomName = schedules.map(schedule => ({
        ...schedule,
        roomName: room ? room.name : null
      }));
      
      return schedulesWithRoomName;
    }
  } catch (error) {
    console.error('Lỗi khi lấy room name từ cache:', error);
  }
  
  return schedules;
}

// Get schedules by date range (all rooms)
async function getSchedulesByDateRange(startDate, endDate) {
  const schedules = await scheduleRepo.findByDateRange(startDate, endDate);
  
  // Lấy danh sách rooms từ cache
  try {
    const roomCache = await redisClient.get('rooms_cache');
    if (roomCache) {
      const rooms = JSON.parse(roomCache);
      
      // Tạo map roomId -> roomName để lookup nhanh
      const roomMap = {};
      rooms.forEach(room => {
        roomMap[room._id] = room.name;
      });
      
      // Thêm roomName vào mỗi schedule
      const schedulesWithRoomName = schedules.map(schedule => ({
        ...schedule,
        roomName: roomMap[schedule.roomId] || null
      }));
      
      return schedulesWithRoomName;
    }
  } catch (error) {
    console.error('Lỗi khi lấy room names từ cache:', error);
  }
  
  return schedules;
}



// Get quarter status
async function getQuarterStatus(quarter, year) {
  const { startDate, endDate } = getQuarterDateRange(quarter, year);
  const { startDateUTC, endDateUTC } = getQuarterUTCDates(quarter, year);
  const { startDateVN, endDateVN } = getQuarterVNDateStrings(quarter, year);
  const rooms = await getAllRooms();
  
  const status = {
    quarter,
    year,
    startDate: startDateUTC,
    endDate: endDateUTC,
    startDateVN,
    endDateVN,
    totalRooms: rooms.length,
    roomsWithSchedule: 0,
    totalSchedules: 0,
    rooms: []
  };
  
  for (const room of rooms) {
    const schedules = await scheduleRepo.findByRoomAndDateRange(room._id, startDate, endDate);
    const hasSchedule = schedules.length > 0;
    
    if (hasSchedule) {
      status.roomsWithSchedule++;
      status.totalSchedules += schedules.length;
    }
    
    status.rooms.push({
      roomId: room._id,
      roomName: room.name,
      hasSchedule,
      scheduleCount: schedules.length
    });
  }
  
  return status;
}

// 🔍 Lấy danh sách các quý đã có lịch trong hệ thống (sử dụng API available quarters)
async function getExistingScheduleQuarters() {
  try {
    // Sử dụng logic có sẵn từ getAvailableQuarters
    const availableQuarters = await getAvailableQuarters();
    
    // Lọc chỉ những quý đã được tạo (isCreated: true)
    const existingQuarters = availableQuarters
      .filter(q => q.isCreated)
      .map(q => ({
        quarter: q.quarter,
        year: q.year
      }));

    console.log(`🔍 Found ${existingQuarters.length} existing quarters:`, existingQuarters.map(q => `Q${q.quarter}/${q.year}`));
    return existingQuarters;
  } catch (error) {
    console.error('Error getting existing schedule quarters:', error);
    return [];
  }
}

module.exports = {
  generateQuarterSchedule,
  generateQuarterScheduleForSingleRoom,
  generateScheduleForRoom,
  getAvailableQuarters,
  getSchedulesByRoom,
  getSchedulesByDateRange,
  getStaffSchedule,
  getQuarterStatus,
  getQuarterInfo,
  getVietnamDate,
  getQuarterDateRange,
  hasScheduleForPeriod,
  getQuarterAnalysisForRoom,
  createSchedulesForNewRoom,
  isLastDayOfQuarter,
  getNextQuarterForScheduling,
  isLastDayOfMonth,
  checkConflictsForSlots
};

// 🔧 Check conflict chung
// Note: schedules no longer persist shiftIds. Conflict is determined by overlapping start/end for the same room.
async function checkScheduleConflict(roomId, startDate, endDate, excludeId = null) {
  const filter = {
    roomId,
    $or: [
      {
        startDate: { $lte: new Date(endDate) },
        endDate: { $gte: new Date(startDate) }
      }
    ]
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return await scheduleRepo.findOne(filter);
}

// 🔹 Kiểm tra khả năng tạo slot cho tất cả subRoom
async function checkSlotsAvailability(subRooms, shiftIdsOrWorkShifts, slotDuration, startDate, endDate) {
  // shiftIdsOrWorkShifts may be an array of shift IDs (legacy) or an array of workShift objects
  const cfg = await cfgService.getConfig();
  const configShifts = cfg.workShifts || [];

  let selectedShifts = [];
  if (Array.isArray(shiftIdsOrWorkShifts) && shiftIdsOrWorkShifts.length > 0 && typeof shiftIdsOrWorkShifts[0] === 'object') {
    // Provided workShift objects directly
    selectedShifts = shiftIdsOrWorkShifts.filter(s => s.isActive);
  } else if (Array.isArray(shiftIdsOrWorkShifts)) {
    // Provided shift ids - map them to config
    const ids = shiftIdsOrWorkShifts.map(String);
    selectedShifts = configShifts.filter(s => ids.includes(String(s._id)) && s.isActive);
  }

  if (!selectedShifts.length) throw new Error('Không tìm thấy ca/kíp hợp lệ hoặc ca/kíp không hoạt động');

  const now = new Date();
  const minStart = new Date(now.getTime() + 5 * 60000); // slot bắt đầu sau 5 phút
  const unit = cfg?.unitDuration ?? 15;

  for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
    for (const shift of selectedShifts) {
  const [startHour, startMinute] = shift.startTime.split(':').map(Number);
  const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      const shiftStart = new Date(d);
      shiftStart.setHours(startHour, startMinute, 0, 0);
      const shiftEnd = new Date(d);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // Bỏ ca đã kết thúc hoàn toàn
      if (shiftEnd <= minStart) continue;

      // Tính thời gian còn lại cho slot đầu tiên
  const firstSlotStart = shiftStart > minStart ? shiftStart : minStart;
  // Align firstSlotStart to unitDuration
  const rem = firstSlotStart.getMinutes() % unit;
  if (rem !== 0) firstSlotStart.setMinutes(firstSlotStart.getMinutes() + (unit - rem));
  const availableMinutes = Math.floor((shiftEnd - firstSlotStart) / 60000);

  if (availableMinutes < slotDuration) {
        throw new Error(
          `Không thể tạo slot cho ca ${shift.name} vào ngày ${d.toISOString().split('T')[0]}. ` +
          `Thời gian còn lại sau 5 phút từ giờ hiện tại là ${availableMinutes} phút, ` +
          `không đủ cho slotDuration ${slotDuration} phút.`
        );
      }
    }
  }
  return true; // có thể tạo slot
}
// 🔹 Sinh slot core với Vietnam timezone và scheduleConfig
async function generateSlotsCore(scheduleId, subRoomId, selectedShifts, slotDuration, startDate, endDate) {
  // selectedShifts is an array of workShift-like objects ({name,startTime,endTime,isActive})
  if (!Array.isArray(selectedShifts) || selectedShifts.length === 0) {
    throw new Error('Không tìm thấy ca làm việc hợp lệ nào để tạo slot');
  }

  const slots = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Convert to Vietnam timezone for date calculations
  const vnStart = new Date(start.getTime() + 7 * 60 * 60 * 1000);
  const vnEnd = new Date(end.getTime() + 7 * 60 * 60 * 1000);
  const vnNow = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
  const minStart = new Date(vnNow.getTime() + 5 * 60000); // start after 5 minutes

  // Loop through each day in Vietnam timezone
  for (let d = new Date(vnStart); d <= vnEnd; d.setDate(d.getDate() + 1)) {
    const dayString = d.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // 🔹 Skip holidays - don't create slots for holidays
    const isHolidayDay = await isHoliday(new Date(dayString + 'T00:00:00.000Z'));
    if (isHolidayDay) {
      console.log(`📅 Skipping holiday: ${dayString}`);
      continue;
    }
    
  for (const shift of selectedShifts) {
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      // Create shift times in Vietnam timezone
      const shiftStart = new Date(d);
      shiftStart.setHours(startHour, startMinute, 0, 0);

      const shiftEnd = new Date(d);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // Skip shifts that have completely ended
      if (shiftEnd <= minStart) continue;

      // Start slot from max(shiftStart, minStart)
      let cur = shiftStart > minStart ? new Date(shiftStart) : new Date(minStart);
      let slotCreated = false;

      while (cur < shiftEnd) {
        const next = new Date(cur.getTime() + slotDuration * 60000);

        // If slot doesn't fit in remaining time → break
        if (next > shiftEnd) break;

        // Convert back to UTC for storage
        const slotDate = new Date(dayString + 'T00:00:00.000Z');
        const utcStartTime = new Date(cur.getTime() - 7 * 60 * 60 * 1000);
        const utcEndTime = new Date(next.getTime() - 7 * 60 * 60 * 1000);

        slots.push({
          date: slotDate,
          startTime: utcStartTime,
          endTime: utcEndTime,
          scheduleId,
          subRoomId,
          shiftName: shift.name,
          roomId: null, // filled when saving (slotRepo.createManySlots should set roomId)
          status: 'available'
        });

        slotCreated = true;
        cur = next;
      }

      // If no slot was created in this shift → throw error
      if (!slotCreated && shiftStart < shiftEnd) {
        const availableMinutes = Math.floor((shiftEnd - minStart) / 60000);
        if (availableMinutes > 0) {
          throw new Error(
            `Không thể tạo slot cho ca ${shift.name} vào ngày ${dayString}. ` +
            `Thời gian còn lại là ${availableMinutes} phút, ` +
            `không đủ cho slotDuration ${slotDuration} phút.`
          );
        }
      }
    }
  }

  return slots;
}

// 🔹 Wrapper: sinh + lưu DB sau khi có schedule._id  
async function generateSlotsAndSave(scheduleId, subRoomId, selectedShifts, slotDuration, startDate, endDate) {
  // Generate slots using the core function with Vietnam timezone handling
  const slots = await generateSlotsCore(scheduleId, subRoomId, selectedShifts, slotDuration, startDate, endDate);
  
  if (slots.length === 0) {
    console.log(`⚠️ Không có slot nào được tạo cho subRoom ${subRoomId}`);
    return [];
  }

  // Resolve parent roomId from cache and set on slots
  const roomCache = await redisClient.get('rooms_cache');
  const rooms = roomCache ? JSON.parse(roomCache) : [];
  let roomId = null;
  
  // Check if subRoomId is actually a subroom or just a roomId (for rooms without subrooms)
  for (const r of rooms) {
    // Case 1: Room has subrooms - find parent room by subroom ID
    if (r.subRooms && r.subRooms.find(sr => sr._id.toString() === subRoomId.toString())) {
      roomId = r._id;
      break;
    }
    // Case 2: Room has NO subrooms - subRoomId is the roomId itself
    if (r._id.toString() === subRoomId.toString()) {
      roomId = r._id;
      break;
    }
  }

  const slotsToSave = slots.map(s => ({ ...s, roomId }));

  // Save slots to database
  const savedSlots = await slotRepo.createManySlots(slotsToSave);
  console.log(`✅ Đã tạo ${savedSlots.length} slot cho subRoom ${subRoomId} từ ${startDate} đến ${endDate}`);
  
  return savedSlots.map(s => s._id);
}

// ✅ Tạo schedule
exports.createSchedule = async (data) => {
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Không tìm thấy bộ nhớ đệm phòng');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id.toString() === data.roomId.toString());
  if (!room) throw new Error('Không tìm thấy phòng');
  if (!room.isActive) throw new Error(`Phòng ${room._id} hiện không hoạt động`);

  // Determine shifts: prefer provided workShifts array; fallback to mapping shiftIds via config
  const cfg = await cfgService.getConfig();
  const configShifts = cfg?.workShifts || [];

  let incomingShifts = [];
  if (Array.isArray(data.workShifts) && data.workShifts.length > 0) {
    incomingShifts = data.workShifts;
  } else if (Array.isArray(data.shiftIds) && data.shiftIds.length > 0) {
    const ids = data.shiftIds.map(String);
    incomingShifts = configShifts.filter(s => ids.includes(String(s._id)));
  }

  const conflict = await checkScheduleConflict(data.roomId, data.startDate, data.endDate);
  if (conflict) throw new Error(`Lịch bị trùng với schedule ${conflict._id}`);

  // Kiểm tra khả năng tạo slot cho tất cả subRoom
  await checkSlotsAvailability(room.subRooms, incomingShifts, data.slotDuration, data.startDate, data.endDate);

  // ✅ Kiểm tra ngày bắt đầu/kết thúc (dùng config)
  await validateDates(data.startDate, data.endDate);

  // Tạo schedule thực
  const schedule = await scheduleRepo.createSchedule({
    roomId: room._id,
    startDate: data.startDate,
    endDate: data.endDate,
    // store workShifts if caller provided them; otherwise schedule keeps no shiftIds
    workShifts: Array.isArray(incomingShifts) ? incomingShifts.map(s => ({ name: s.name, startTime: s.startTime, endTime: s.endTime, isActive: s.isActive })) : [],
    slotDuration: data.slotDuration
  });

  // Sinh slot thực cho tất cả subRoom
  let allSlotIds = [];
  for (const subRoom of room.subRooms) {
    const slotIds = await generateSlotsAndSave(
      schedule._id,
      subRoom._id,
      incomingShifts,
      data.slotDuration,
      data.startDate,
      data.endDate
    );
    allSlotIds = allSlotIds.concat(slotIds);
  }

  // 🔹 NEW: Mark any holidays in this date range as used
  try {
    const overlappingHolidays = await cfgService.checkHolidaysUsedInDateRange(data.startDate, data.endDate);
    for (const holiday of overlappingHolidays) {
      await cfgService.markHolidayAsUsed(holiday._id);
    }
    if (overlappingHolidays.length > 0) {
      console.log(`📅 Đã đánh dấu ${overlappingHolidays.length} holidays đã được sử dụng trong lịch mới`);
    }
  } catch (error) {
    console.error('Error marking holidays as used:', error);
    // Don't fail schedule creation if holiday marking fails
  }

  // slots are stored in Slot collection; do not persist slot IDs on schedule
  return schedule;
};


// ✅ Update schedule
exports.updateSchedule = async (id, data) => {
  const schedule = await scheduleRepo.findById(id);
  if (!schedule) throw new Error('Không tìm thấy lịch');

  // Không cho phép update shift identifiers via shiftIds (use new schedule creation for different shifts)
  if (data.shiftIds) {
    throw new Error('Không được phép cập nhật shiftIds. Để thay đổi ca/kíp, hãy tạo lịch mới.');
  }

  // Không cho phép update startDate/endDate
  if (data.startDate || data.endDate) {
    const oldStart = new Date(schedule.startDate);
    const oldEnd = new Date(schedule.endDate);
    const newStart = data.startDate ? new Date(data.startDate) : oldStart;
    const newEnd = data.endDate ? new Date(data.endDate) : oldEnd;

    if (newStart.getTime() !== oldStart.getTime() || newEnd.getTime() !== oldEnd.getTime()) {
      throw new Error('Không thể thay đổi ngày bắt đầu/kết thúc. Nếu muốn tạo lịch mới, hãy dùng createSchedule.');
    }
  }

  const slotDurationChanged = data.slotDuration && data.slotDuration !== schedule.slotDuration;

  if (slotDurationChanged) {
    // 🔹 Trước khi regenerate slot, kiểm tra xem có slot nào đã có dentistId/nurseId/appointmentId không
    const existingSlots = await slotRepo.findSlots({ scheduleId: schedule._id });

    const hasAssignedSlot = existingSlots.some(slot =>
      (slot.dentistId && slot.dentistId.length > 0) ||
      (slot.nurseId && slot.nurseId.length > 0) ||
      (slot.appointmentId !== null)
    );

    if (hasAssignedSlot) {
      throw new Error('Không thể thay đổi slotDuration vì đã có slot chứa dentistId, nurseId hoặc appointmentId');
    }

    // 🔹 Determine shifts from schedule.workShifts or config
    const cfg = await cfgService.getConfig();
    const configShifts = cfg?.workShifts || [];
    const selectedShifts = (Array.isArray(schedule.workShifts) && schedule.workShifts.length > 0)
      ? schedule.workShifts
      : configShifts.filter(s => s.isActive);

    for (const shift of selectedShifts) {
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);
      const shiftMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
      if (data.slotDuration > shiftMinutes) {
        throw new Error(`slotDuration (${data.slotDuration} phút) vượt quá độ dài của ca ${shift._id} (${shiftMinutes} phút)`);
      }
    }

  // 1️⃣ Xóa tất cả slot cũ
  await slotRepo.deleteMany({ scheduleId: schedule._id });

    // 2️⃣ Lấy room từ cache
    const roomCache = await redisClient.get('rooms_cache');
    if (!roomCache) throw new Error('Không tìm thấy bộ nhớ đệm phòng');
    const rooms = JSON.parse(roomCache);
    const room = rooms.find(r => r._id.toString() === schedule.roomId.toString());

    // 3️⃣ Sinh slot mới cho tất cả subRoom
    let allSlotIds = [];
    for (const subRoom of room.subRooms) {
      const slotIds = await generateSlotsAndSave(
        schedule._id,
        subRoom._id,
        selectedShifts,
        data.slotDuration,
        schedule.startDate,
        schedule.endDate
      );
      allSlotIds = allSlotIds.concat(slotIds);
    }

  // slots saved in Slot collection; schedule document already has metadata updated
  schedule.slotDuration = data.slotDuration;
  }

  // Cập nhật các trường khác (isActive, note, name…)
  const allowedFields = ['isActive', 'note', 'name'];
  for (const field of allowedFields) {
    if (data[field] !== undefined) schedule[field] = data[field];
  }

  await schedule.save();
  return schedule;
};

// ✅ Toggle schedule status
exports.toggleStatus = async (id) => {
  const schedule = await scheduleRepo.findById(id);
  if (!schedule) throw new Error('Không tìm thấy lịch');

  // Toggle boolean isActive
  schedule.isActive = schedule.isActive === false ? true : false;
  await schedule.save();
  return schedule;
};

// Ensure the toggle function is available on module.exports (module.exports was assigned earlier)
module.exports.toggleStatus = exports.toggleStatus;

// 🆕 Tạo lịch cho room mới theo logic generateQuarterSchedule  
async function createSchedulesForNewRoom(roomData) {
  try {
    console.log(`📅 Tạo lịch cho room mới: ${roomData.roomId}, hasSubRooms: ${roomData.hasSubRooms}`);
    
    // ✅ KIỂM TRA CẤU HÌNH HỆ THỐNG
    const config = await cfgService.getConfig();
    if (!config) {
      console.warn(`⚠️ Chưa có cấu hình hệ thống. Bỏ qua tạo lịch cho room ${roomData.roomId}`);
      return {
        success: true,
        roomId: roomData.roomId,
        hasSubRooms: roomData.hasSubRooms,
        totalSchedulesCreated: 0,
        quartersProcessed: 0,
        message: `Bỏ qua tạo lịch do chưa có cấu hình hệ thống`
      };
    }
    console.log(`✅ Đã tìm thấy cấu hình hệ thống`);
    
    // 🆕 LOGIC NGÀY CUỐI QUÝ: Kiểm tra ngày hiện tại
    const nowVN = getVietnamDate();
    if (isLastDayOfQuarter(nowVN)) {
      const nextQuarter = getNextQuarterForScheduling(nowVN);
      console.log(`📅 Hôm nay là ngày cuối quý, sẽ tạo lịch cho Q${nextQuarter.quarter}/${nextQuarter.year}`);
    }

    // 🔍 Tìm các quý đã có lịch trong hệ thống (từ các room khác)
    const existingQuarters = await getExistingScheduleQuarters();
    console.log(`🔍 Existing quarters in system:`, existingQuarters.map(q => `Q${q.quarter}/${q.year}`));
    
    if (existingQuarters.length === 0) {
      console.log(`⚠️ Chưa có lịch nào trong hệ thống. Bỏ qua tạo lịch cho room mới.`);
      return {
        success: true,
        roomId: roomData.roomId,
        hasSubRooms: roomData.hasSubRooms,
        totalSchedulesCreated: 0,
        quartersProcessed: 0,
        message: `Bỏ qua tạo lịch do chưa có lịch nào trong hệ thống`
      };
    }
    
    // Chỉ tạo lịch cho các quý đã có trong hệ thống
    const creatableQuarters = existingQuarters;
    
    let totalSchedulesCreated = 0;
    
    for (const { quarter, year } of creatableQuarters) {
      try {
        console.log(`🚀 Bắt đầu tạo lịch Q${quarter}/${year} cho room ${roomData.roomId}...`);
        
        // Tạo lịch trực tiếp cho room mới (không qua cache)
        const result = await createScheduleForNewRoomDirect(roomData, quarter, year);
        totalSchedulesCreated += result.scheduleCount || 0;
        console.log(`✅ Đã tạo lịch Q${quarter}/${year} cho room ${roomData.roomId}: ${result.scheduleCount || 0} schedules`);
        
        // Debug: Kiểm tra schedules đã được lưu vào DB chưa
        const { startDate, endDate } = getQuarterDateRange(quarter, year);
        const savedSchedules = await scheduleRepo.findByRoomAndDateRange(roomData.roomId, startDate, endDate);
        console.log(`🔍 Debug: Tìm thấy ${savedSchedules.length} schedules trong DB cho room ${roomData.roomId} Q${quarter}/${year}`);
      } catch (error) {
        console.error(`❌ Lỗi tạo lịch Q${quarter}/${year} cho room ${roomData.roomId}:`, error.message);
        // Không throw error, tiếp tục với quý khác
      }
    }
    
    console.log(`📊 Tổng kết tạo lịch: ${totalSchedulesCreated} schedules từ ${creatableQuarters.length} quý`);

    // Mark room as used
    try {
      await markMainRoomAsUsed(roomData.roomId);
      if (roomData.hasSubRooms && roomData.subRoomIds) {
        await markSubRoomsAsUsed(roomData.roomId, roomData.subRoomIds);
      }
    } catch (markError) {
      console.warn('⚠️ Không thể mark room as used:', markError.message);
    }

    return {
      success: true,
      roomId: roomData.roomId,
      hasSubRooms: roomData.hasSubRooms,
      totalSchedulesCreated,
      quartersProcessed: creatableQuarters.length,
      message: `Đã tạo ${totalSchedulesCreated} schedules cho room mới`
    };
  } catch (error) {
    console.error('❌ Lỗi tạo lịch cho room mới:', error);
    throw error;
  }
}

// 🆕 Tạo lịch trực tiếp cho room mới từ roomData (không qua cache)
async function createScheduleForNewRoomDirect(roomData, quarter, year) {
  try {
    // Config đã được kiểm tra ở hàm cha, lấy lại để sử dụng
    const config = await cfgService.getConfig();

    // Get quarter date range
    let { startDate, endDate } = getQuarterDateRange(quarter, year);
    
    // If current quarter, start from next day
    const nowVN = getVietnamDate();
    const current = getQuarterInfo();
    if (year === current.year && quarter === current.quarter) {
      const startNextDay = new Date(
        nowVN.getFullYear(),
        nowVN.getMonth(),
        nowVN.getDate() + 1,
        0, 0, 0, 0
      );
      if (startNextDay > startDate) startDate = startNextDay;
    }

    // Construct room object from roomData
    const room = {
      _id: roomData.roomId,
      name: `Room ${roomData.roomId}`, // Placeholder name
      isActive: true,
      autoScheduleEnabled: true,
      hasSubRooms: roomData.hasSubRooms,
      subRooms: roomData.hasSubRooms ? (roomData.subRoomIds || []).map(id => ({
        _id: id,
        isActive: true,
        name: `SubRoom ${id}`
      })) : [],
      maxDoctors: roomData.maxDoctors || 1,
      maxNurses: roomData.maxNurses || 1
    };

    console.log(`📅 Tạo lịch trực tiếp cho room: ${room.name}, hasSubRooms: ${room.hasSubRooms}, subRooms: ${room.subRooms.length}`);

    // Generate schedules using same logic as generateScheduleForRoom
    const roomSchedules = await generateScheduleForRoom(room, startDate, endDate, config);
    
    return {
      quarter,
      year,
      roomId: roomData.roomId,
      scheduleCount: roomSchedules.length,
      success: true,
      message: `Tạo thành công ${roomSchedules.length} schedules cho Q${quarter}/${year}`
    };
    
  } catch (error) {
    console.error(`❌ Lỗi tạo lịch trực tiếp cho room ${roomData.roomId}:`, error);
    throw error;
  }
}

// 🆕 Tạo lịch thông minh cho subRooms mới - SAO CHÉP từ lịch hiện có thay vì tạo theo quý
exports.createSchedulesForNewSubRooms = async (roomId, subRoomIds) => {
  try {
    console.log(`📩 Bắt đầu tạo schedule documents cho ${subRoomIds.length} subRoom mới của room ${roomId}`);
    
    // 🆕 TÌM TẤT CẢ schedules hiện có của room (để biết cần tạo schedules cho những tháng nào)
    const existingSchedules = await scheduleRepo.findByRoomId(roomId);
    
    if (existingSchedules.length === 0) {
      console.warn(`⚠️ Room ${roomId} chưa có lịch nào. Không tạo schedule cho subRoom mới.`);
      return { success: true, schedulesCreated: 0, subRoomIds, roomId, reason: 'no_existing_schedules' };
    }

    console.log(`✅ Tìm thấy ${existingSchedules.length} schedules hiện có của room ${roomId}`);

    // 🆕 LẤY DANH SÁCH CÁC THÁNG ĐÃ CÓ (unique startDate) - CHỈ TỪ THÁNG HIỆN TẠI TRỞ ĐI
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    
    const uniqueMonths = new Set();
    const monthConfigs = new Map(); // Lưu config của từng tháng

    for (const schedule of existingSchedules) {
      const scheduleYear = schedule.startDate.getFullYear();
      const scheduleMonth = schedule.startDate.getMonth() + 1; // 1-12
      
      // 🔍 CHỈ LẤY THÁNG >= THÁNG HIỆN TẠI
      if (scheduleYear > currentYear || (scheduleYear === currentYear && scheduleMonth >= currentMonth)) {
        const monthKey = `${scheduleYear}-${scheduleMonth}`;
        if (!uniqueMonths.has(monthKey)) {
          uniqueMonths.add(monthKey);
          monthConfigs.set(monthKey, {
            year: scheduleYear,
            month: scheduleMonth,
            startDate: schedule.startDate,
            endDate: schedule.endDate,
            shiftConfig: schedule.shiftConfig // Lấy config từ schedule hiện có
          });
        }
      }
    }

    console.log(`📅 Tìm thấy ${uniqueMonths.size} tháng (từ ${currentMonth}/${currentYear} trở đi) cần tạo schedule cho subRoom mới`);

    let schedulesCreated = 0;

    // 🆕 DUYỆT QUA TỪNG SUBROOM MỚI
    for (const subRoomId of subRoomIds) {
      // 🆕 DUYỆT QUA TỪNG THÁNG ĐÃ CÓ
      for (const [monthKey, config] of monthConfigs.entries()) {
        try {
          // Kiểm tra xem subRoom này đã có schedule cho tháng này chưa
          const existingSchedule = await scheduleRepo.findOne({
            roomId,
            subRoomId,
            startDate: config.startDate
          });

          if (existingSchedule) {
            console.log(`✅ SubRoom ${subRoomId} đã có schedule cho tháng ${monthKey}, bỏ qua`);
            continue;
          }

          // 🆕 TẠO SCHEDULE MỚI với isActiveSubRoom=true (subroom mới mặc định đang hoạt động)
          const newScheduleData = {
            roomId,
            subRoomId,
            year: config.year, // ✅ Bắt buộc
            month: config.month, // ✅ Bắt buộc
            startDate: config.startDate,
            endDate: config.endDate,
            isActiveSubRoom: true, // ✅ TRUE vì subroom mới được tạo với isActive=true
            shiftConfig: {
              morning: {
                isActive: config.shiftConfig.morning.isActive, // ✅ Lấy từ config hiện có
                isGenerated: false, // ✅ Luôn là false cho subRoom mới
                startTime: config.shiftConfig.morning.startTime,
                endTime: config.shiftConfig.morning.endTime,
                slotDuration: config.shiftConfig.morning.slotDuration
              },
              afternoon: {
                isActive: config.shiftConfig.afternoon.isActive,
                isGenerated: false,
                startTime: config.shiftConfig.afternoon.startTime,
                endTime: config.shiftConfig.afternoon.endTime,
                slotDuration: config.shiftConfig.afternoon.slotDuration
              },
              evening: {
                isActive: config.shiftConfig.evening.isActive,
                isGenerated: false,
                startTime: config.shiftConfig.evening.startTime,
                endTime: config.shiftConfig.evening.endTime,
                slotDuration: config.shiftConfig.evening.slotDuration
              }
            }
          };

          const newSchedule = await scheduleRepo.create(newScheduleData);
          schedulesCreated++;

          console.log(`✅ Tạo schedule ${newSchedule._id} cho subRoom ${subRoomId} tháng ${monthKey}`);

        } catch (scheduleError) {
          console.error(`❌ Lỗi tạo schedule cho subRoom ${subRoomId} tháng ${monthKey}:`, scheduleError.message);
        }
      }
    }

    console.log(
      `📊 Tổng kết: tạo ${schedulesCreated} schedules cho ${subRoomIds.length} subRoom mới (không tạo slots)`
    );
    
    return { success: true, schedulesCreated, subRoomIds, roomId };

  } catch (error) {
    console.error('❌ Lỗi trong createSchedulesForNewSubRooms:', error);
    throw error;
  }
};

// Ensure RPC layer can call the helper after module.exports assignment above
module.exports.createSchedulesForNewSubRooms = exports.createSchedulesForNewSubRooms;

// ✅ Tạo slot cho 1 subRoom, nhưng chỉ nếu chưa có slot trong khoảng ngày đó

exports.createSlotsForSubRoom = async (scheduleId, subRoomId) => {
  const schedule = await scheduleRepo.findById(scheduleId);
  if (!schedule) {
    console.log(`⚠️ Không tìm thấy lịch ${scheduleId} cho subRoom ${subRoomId}, bỏ qua`);
    return null;
  }

  const cfg = await cfgService.getConfig();
  const resolvedSlotDuration = schedule.slotDuration || cfg?.unitDuration || 15;

  let resolvedStart = schedule.startDate ? new Date(schedule.startDate) : null;
  let resolvedEnd = schedule.endDate ? new Date(schedule.endDate) : null;

  if (!resolvedStart || !resolvedEnd) {
    if (schedule.dateVNStr) {
      const [y, m, d] = schedule.dateVNStr.split('-').map(Number);
      resolvedStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      resolvedEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
    } else {
      const fallback = schedule.createdAt ? new Date(schedule.createdAt) : new Date();
      resolvedStart = new Date(fallback);
      resolvedStart.setHours(0, 0, 0, 0);
      resolvedEnd = new Date(resolvedStart);
      resolvedEnd.setHours(23, 59, 59, 999);
    }
  }

  

  // ✅ Kiểm tra ngày (dùng config)
  await validateDates(resolvedStart, resolvedEnd);

  // ✅ Kiểm tra subRoom đã có slot chưa trong schedule này
  const existingSlots = await slotRepo.findSlots({
    scheduleId,
    subRoomId
  });

  if (existingSlots.length > 0) {
    return { schedule, createdSlotIds: [] };
  }

  console.log(`✅ SubRoom ${subRoomId} chưa có slot trong schedule ${scheduleId}, tiến hành tạo mới`);

  // 🔹 Lấy shift từ cache để kiểm tra slotDuration
  // Determine shifts from schedule.workShifts or from config
  const configShifts = cfg?.workShifts || [];
  const selectedShifts = (Array.isArray(schedule.workShifts) && schedule.workShifts.length > 0)
    ? schedule.workShifts
    : configShifts.filter(s => s.isActive);

  if (!selectedShifts.length) throw new Error('Không tìm thấy ca/kíp hợp lệ');

  // 🔹 Kiểm tra slotDuration cho từng ca
  for (const shift of selectedShifts) {
    const [startHour, startMinute] = shift.startTime.split(':').map(Number);
    const [endHour, endMinute] = shift.endTime.split(':').map(Number);

    const shiftStart = new Date();
    shiftStart.setHours(startHour, startMinute, 0, 0);

    const shiftEnd = new Date();
    shiftEnd.setHours(endHour, endMinute, 0, 0);

    const shiftMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);

    let remainingMinutes = shiftMinutes;
    const now = new Date();
    if (now >= shiftStart && now < shiftEnd) {
      remainingMinutes = Math.floor((shiftEnd - now) / 60000);
    }

    if (resolvedSlotDuration >= remainingMinutes) {
      console.log(`⚠️ slotDuration (${resolvedSlotDuration} phút) không hợp lệ cho ca ${shift.name || shift._id}. Chỉ còn ${remainingMinutes} phút khả dụng. Bỏ qua subRoom ${subRoomId}`);
      return { schedule, createdSlotIds: [] };
    }
  }

  console.log(`🔧 Bắt đầu generateSlotsAndSave với ${selectedShifts.length} shifts cho subRoom ${subRoomId}`);

  // 🔹 Sinh slot mới
  const slotIds = await generateSlotsAndSave(
    schedule._id,
    subRoomId,
    selectedShifts,
    resolvedSlotDuration,
    resolvedStart,
    resolvedEnd
  );

  console.log(`🔧 generateSlotsAndSave trả về ${slotIds ? slotIds.length : 0} slotIds`);

  console.log(`✅ Đã tạo ${slotIds.length} slot mới cho subRoom ${subRoomId}`);
  // Do not store slot IDs on schedule document; slots persisted in Slot collection

  return { schedule, createdSlotIds: slotIds };
};

module.exports.createSlotsForSubRoom = exports.createSlotsForSubRoom;

exports.listSchedules = async ({ roomId, page = 1, limit = 10 }) => {
  // Nếu có roomId => trả danh sách như cũ
  if (roomId) {
    const skip = (page - 1) * limit;

    const { schedules, total } = await scheduleRepo.findSchedules({
      roomId,
      skip,
      limit
    });

    // Enrich từng schedule
    const enrichedSchedules = [];
    for (const sch of schedules) {
      const { slots: dbSlots } = await slotRepo.findSlotsByScheduleId(sch._id);
      const enrichedSlots = await enrichSlots(dbSlots);

      const base = (typeof sch.toObject === 'function') ? sch.toObject() : sch;
      enrichedSchedules.push({
        ...base,
        slots: enrichedSlots
      });
    }

    return {
      total,
      totalPages: Math.ceil(total / limit),
      page: Number(page),
      limit: Number(limit),
      schedules: enrichedSchedules
    };
  }

  // Nếu không có roomId => gom theo từng roomId và trả summary
  const schedules = await scheduleRepo.findAll();
  const grouped = schedules.reduce((acc, s) => {
    const rid = s.roomId.toString();
    if (!acc[rid]) acc[rid] = [];
    acc[rid].push(s);
    return acc;
  }, {});

  const summaries = [];
  for (const [rid, roomSchedules] of Object.entries(grouped)) {
    const summary = await exports.getRoomSchedulesSummaryActive(rid);
    summaries.push(summary);
  }

  return {
    total: summaries.length,
    summaries
  };
};



exports.getScheduleById = async (id) => {
  const schedule = await scheduleRepo.findScheduleById(id);
  if (!schedule) {
    throw new Error('Không tìm thấy schedule');
  }
  return schedule;
};


/**
 * Lấy thông tin user từ Redis cache theo mảng ids
 */
async function getUsersFromCache(ids = []) {
  if (!ids.length) return [];

  // Lấy toàn bộ cache (string JSON)
  const cache = await redisClient.get('users_cache');
  if (!cache) return [];

  let users;
  try {
    users = JSON.parse(cache); // users là mảng
  } catch (err) {
    console.error('Lỗi parse users_cache:', err);
    return [];
  }

  // Lọc và chỉ lấy _id + fullName
  const filtered = users
    .filter(u => ids.includes(u._id))
    .map(u => ({ _id: u._id, fullName: u.fullName, employeeCode: u.employeeCode}));

  return filtered;
}



/**
 * Lấy slot theo scheduleId kèm thông tin nha sĩ và y tá
 */
exports.getSlotsByScheduleId = async ({ scheduleId, page = 1, limit }) => {
  // 1️⃣ Lấy slot từ repository
  const { total, totalPages, slots: dbSlots } = await slotRepo.findSlotsByScheduleId(scheduleId, page, limit);

  // 2️⃣ Lấy tất cả dentistId / nurseId
  const dentistIds = [...new Set(dbSlots.flatMap(s => s.dentistId.map(id => id.toString())))];
  const nurseIds = [...new Set(dbSlots.flatMap(s => s.nurseId.map(id => id.toString())))];

  // 3️⃣ Lấy thông tin từ Redis
  const dentists = await getUsersFromCache(dentistIds);
  const nurses = await getUsersFromCache(nurseIds);

  const dentistMap = Object.fromEntries(dentists.map(d => [d._id, d]));
  const nurseMap = Object.fromEntries(nurses.map(n => [n._id, n]));

  // 4️⃣ Gán thông tin staff vào slot
  const slots = dbSlots.map(s => ({
    ...s.toObject(),
    dentists: s.dentistId.map(id => dentistMap[id.toString()] || { _id: id, fullName: null }),
    nurses: s.nurseId.map(id => nurseMap[id.toString()] || { _id: id, fullName: null })
  }));

  return {
    total,
    totalPages,
    page,
    limit: limit || total,
    slots
  };
};

async function getSubRoomMapFromCache() {
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) return {};

  let rooms;
  try {
    rooms = JSON.parse(roomCache); // mảng room
  } catch (err) {
    console.error('Lỗi parse rooms_cache:', err);
    return {};
  }

  const subRoomMap = {};
  for (const r of rooms) {
    if (r.subRooms && r.subRooms.length) {
      for (const sub of r.subRooms) {
        subRoomMap[sub._id] = {
          subRoomId: sub._id,
          subRoomName: sub.name,
          roomId: r._id,
          roomName: r.name,
          roomStatus: r.isActive,   // ✅ thêm trạng thái của room
          isActive: sub.isActive    // ✅ thêm trạng thái subRoom
        };
      }
    }
  }

  return subRoomMap;
}

// 🔹 Hàm enrich slots
async function enrichSlots(dbSlots) {
  if (!dbSlots.length) return [];

  // Dentist + Nurse
  const dentistIds = [...new Set(dbSlots.flatMap(s => s.dentistId.map(id => id.toString())))];
  const nurseIds = [...new Set(dbSlots.flatMap(s => s.nurseId.map(id => id.toString())))];

  const dentists = await getUsersFromCache(dentistIds);
  const nurses = await getUsersFromCache(nurseIds);

  const dentistMap = Object.fromEntries(dentists.map(d => [d._id, d]));
  const nurseMap = Object.fromEntries(nurses.map(n => [n._id, n]));

  // SubRoom
  const subRoomMap = await getSubRoomMapFromCache();

  return dbSlots.map(s => {
    const subRoomInfo = subRoomMap[s.subRoomId?.toString()] || {};
    return {
      ...s.toObject(),
      dentists: s.dentistId.map(id => dentistMap[id.toString()] || { _id: id, fullName: null }),
      nurses: s.nurseId.map(id => nurseMap[id.toString()] || { _id: id, fullName: null }),
      subRoomId: subRoomInfo.subRoomId || s.subRoomId,
      subRoomName: subRoomInfo.subRoomName || null,
      roomId: subRoomInfo.roomId || null,
      roomName: subRoomInfo.roomName || null
    };
  });
}

exports.getRoomSchedulesSummary = async (roomId) => {
  if (!roomId) throw new Error("Thiếu roomId");
  const schedules = await scheduleRepo.findByRoomId(roomId);
  if (!schedules.length) {
    return {
      roomId,
      startDate: null,
      endDate: null,
      shifts: [],
      subRooms: [],
      schedules: []
    };
  }

  // startDate sớm nhất
  const startDate = schedules.reduce(
    (min, s) => (!min || new Date(s.startDate) < min ? new Date(s.startDate) : min),
    null
  );

  // endDate trễ nhất
  const endDate = schedules.reduce(
    (max, s) => (!max || new Date(s.endDate) > max ? new Date(s.endDate) : max),
    null
  );

  // 🔹 Tập hợp thông tin ca từ schedules.workShifts (unique)
  const shiftKeySet = new Set();
  const shifts = [];
  for (const s of schedules) {
    const ws = Array.isArray(s.workShifts) ? s.workShifts : [];
    for (const sh of ws) {
      const key = `${sh.name}|${sh.startTime}|${sh.endTime}`;
      if (!shiftKeySet.has(key)) {
        shiftKeySet.add(key);
        shifts.push({ name: sh.name, startTime: sh.startTime, endTime: sh.endTime, isActive: sh.isActive });
      }
    }
  }
  // 🔹 Lấy toàn bộ slot từ schedules
  // Collect slots for all schedules by querying Slot repository per schedule
  const perScheduleSlots = await Promise.all(schedules.map(sch => slotRepo.findSlotsByScheduleId(sch._id).then(res => res.slots)));
  const dbSlots = perScheduleSlots.flat();
  // 🔹 Map sang subRoom
  const subRoomMap = await getSubRoomMapFromCache();
  const subRooms = [];
  for (const slot of dbSlots) {
    const subInfo = subRoomMap[slot.subRoomId?.toString()];
    if (subInfo && !subRooms.find(sr => sr.subRoomId === subInfo.subRoomId)) {
      subRooms.push(subInfo);
    }
  }

  // 🔹 Chỉ lấy ngày (YYYY-MM-DD)
  const toDateOnly = (date) =>
    date ? new Date(date).toISOString().split("T")[0] : null;

  return {
    roomId,
    startDate: toDateOnly(startDate),
    endDate: toDateOnly(endDate),
    shiftIds,
    shifts,     // ✅ thêm thông tin ca làm việc
    subRooms
  };
};

// Hàm mới: chỉ lấy shift còn hiệu lực, startDate = ngày hiện tại
exports.getRoomSchedulesSummaryActive = async (roomId) => {
  if (!roomId) throw new Error("Thiếu roomId");
  const schedules = await scheduleRepo.findByRoomId(roomId);
  if (!schedules.length) {
    return {
      roomId,
      roomName: null,
      isActive: null,
      startDate: null,
      endDate: null,
      shifts: [],
      subRooms: []
    };
  }

  const today = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const todayStr = today.toISOString().split("T")[0];

  const activeSchedules = schedules.filter(s => new Date(s.endDate) >= today);
  if (!activeSchedules.length) {
    return {
      roomId,
      roomName: null,
      isActive: null,
      startDate: todayStr,
      endDate: null,
      shifts: [],
      subRooms: []
    };
  }

  const endDate = activeSchedules.reduce(
    (max, s) => (!max || new Date(s.endDate) > max ? new Date(s.endDate) : max),
    null
  );

  const shiftIds = [...new Set(activeSchedules.flatMap(s => s.shiftIds.map(id => id.toString())))];
  const shiftMap = await getShiftMapFromCache();
  const shifts = shiftIds
    .map(id => shiftMap[id])
    .filter(Boolean)
    .filter(shift => {
      const [sh, sm] = shift.startTime.split(':').map(Number);
      const [eh, em] = shift.endTime.split(':').map(Number);
      const shiftEnd = new Date(today);
      shiftEnd.setHours(eh, em, 0, 0);
      return shiftEnd > new Date();
    });

  const allSlotIds = activeSchedules.flatMap(s => s.slots.map(slot => slot._id));
  const dbSlots = await slotRepo.findByIds(allSlotIds);

  const subRoomMap = await getSubRoomMapFromCache();

  const subRooms = [];
  let roomInfo = { roomId, roomName: null, isActive: null };

  for (const slot of dbSlots) {
    const subInfo = subRoomMap[slot.subRoomId?.toString()];
    if (subInfo) {
      // Lấy room info 1 lần duy nhất
      if (!roomInfo.roomName) {
        roomInfo = {
          roomId: subInfo.roomId,
          roomName: subInfo.roomName, // tên room
          isActive: subInfo.roomStatus
        };
      }
      // Push subRoom (chỉ giữ id, name, isActive)
      if (!subRooms.find(sr => sr.subRoomId === subInfo.subRoomId)) {
        subRooms.push({
          subRoomId: subInfo.subRoomId,
          subRoomName: subInfo.subRoomName,
          isActive: subInfo.isActive
        });
      }
    }
  }

  const toDateOnly = (date) => date ? new Date(date).toISOString().split("T")[0] : null;

  return {
    ...roomInfo,
    startDate: todayStr,
    endDate: toDateOnly(endDate),
    shifts,
    subRooms
  };
};



async function getShiftMapFromCache() {
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) return {};

  let shifts;
  try {
    shifts = JSON.parse(shiftCache); // mảng shift
  } catch (err) {
    console.error('Lỗi parse shifts_cache:', err);
    return {};
  }

  const shiftMap = {};
  for (const s of shifts) {
    shiftMap[s._id] = {
      shiftId: s._id,
      shiftName: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      isActive: s.isActive
    };
  }

  return shiftMap;
}

exports.getSubRoomSchedule = async ({ subRoomId, startDate, endDate }) => {
  if (!subRoomId) throw new Error("Thiếu subRoomId");
  if (!startDate || !endDate) throw new Error("Thiếu startDate hoặc endDate");

  const schedules = await scheduleRepo.findBySubRoomId(subRoomId, startDate, endDate);
  const slots = await slotRepo.findBySubRoomId(subRoomId, startDate, endDate);

  const daysMap = {};

  for (const sch of schedules) {
    const schDate = new Date(sch.startDate).toISOString().split("T")[0];

    if (!daysMap[schDate]) {
      daysMap[schDate] = { date: schDate, shifts: [] };
    }

    const shiftObj = {
      shiftIds: sch.shiftIds,
      slotDuration: sch.slotDuration,
      assigned: true, // mặc định đã phân công, sẽ kiểm tra lại
      slots: []
    };

    const schSlots = slots.filter(slot => String(slot.scheduleId) === String(sch._id));

    for (const slot of schSlots) {
      const dentistAssigned = slot.dentistId && slot.dentistId.length > 0;
      const nurseAssigned = slot.nurseId && slot.nurseId.length > 0;

      // Nếu có slot nào chưa phân công đủ thì shift này coi như chưa phân công
      if (!dentistAssigned || !nurseAssigned) {
        shiftObj.assigned = false;
      }

      shiftObj.slots.push({
        slotId: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        dentistAssigned,
        nurseAssigned,
        status: slot.status
      });
    }

    daysMap[schDate].shifts.push(shiftObj);
  }

  return {
    subRoomId,
    startDate: new Date(startDate).toISOString().split("T")[0],
    endDate: new Date(endDate).toISOString().split("T")[0],
    days: Object.values(daysMap)
  };
};

// ✅ Tạo lịch theo quý
exports.createQuarterlySchedule = async (data) => {
  const { roomId, quarter, year } = data;
  
  // Kiểm tra config và quyền tạo quý
  const config = await cfgService.getConfig();
  if (!config.canGenerateQuarter(quarter, year)) {
    const currentQuarter = config.getCurrentQuarter();
    const currentYear = config.getCurrentYear();
    throw new Error(
      `Không thể tạo lịch quý ${quarter}/${year}. ` +
      `Hiện tại là quý ${currentQuarter}/${currentYear}. ` +
      `Chỉ có thể tạo lịch quý hiện tại hoặc quý tiếp theo.`
    );
  }

  // Lấy thông tin phòng từ cache
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Không tìm thấy bộ nhớ đệm phòng');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id.toString() === roomId.toString());
  if (!room) throw new Error('Không tìm thấy phòng');
  if (!room.isActive) throw new Error(`Phòng ${room._id} hiện không hoạt động`);

  // Tính khoảng thời gian quý
  const { startDate, endDate } = config.getQuarterDateRange(quarter, year);
  
  // Lấy workShifts từ config và tạo shiftIds
  const activeShifts = config.workShifts.filter(shift => shift.isActive);
  if (!activeShifts.length) throw new Error('Không có ca làm việc nào được kích hoạt trong cấu hình');
  
  const shiftIds = activeShifts.map(shift => shift._id.toString());
  const slotDuration = config.unitDuration;

  // Kiểm tra xung đột với lịch hiện có
  const conflict = await checkScheduleConflict(roomId, shiftIds, startDate, endDate);
  if (conflict) throw new Error(`Lịch bị trùng với schedule ${conflict._id} đã tồn tại`);

  // Kiểm tra và validate theo config constraints
  await validateDates(startDate, endDate);

  // Tạo schedule
  const schedule = await scheduleRepo.createSchedule({
    roomId: room._id,
    startDate,
    endDate,
    shiftIds,
    slotDuration,
    quarter,
    year,
    generationType: 'quarterly'
  });

  // Sinh slot dựa trên loại phòng
  let allSlotIds = [];
  
  if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    // Phòng có subrooms: tạo slot cho từng subroom
    for (const subRoom of room.subRooms) {
      if (!subRoom.isActive) continue; // Skip inactive subrooms
      
      const slotIds = await generateSlotsAndSave(
        schedule._id,
        subRoom._id,
        shiftIds,
        slotDuration,
        startDate,
        endDate
      );
      allSlotIds = allSlotIds.concat(slotIds);
    }
  } else {
    // Phòng không có subrooms: tạo slot trực tiếp cho phòng
    // Tạo một "virtual subroom" để xử lý thống nhất
    const slotIds = await generateSlotsAndSave(
      schedule._id,
      room._id, // Dùng roomId làm subRoomId
      shiftIds,
      slotDuration,
      startDate,
      endDate
    );
    allSlotIds = allSlotIds.concat(slotIds);
  }

  // Do not persist slot ID list on schedule document; slots live in Slot collection

  // Đánh dấu quý đã được tạo
  await cfgService.markQuarterGenerated(quarter, year);

  // Đánh dấu phòng đã được sử dụng (bao gồm cả subrooms nếu có)
  try {
    // Always mark the main room as used
    await markMainRoomAsUsed(room._id);
    
    // If room has subrooms, mark them as used too
    if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
      const activeSubRoomIds = room.subRooms
        .filter(subRoom => subRoom.isActive)
        .map(subRoom => subRoom._id);
      
      if (activeSubRoomIds.length > 0) {
        await markSubRoomsAsUsed(room._id, activeSubRoomIds);
      }
    }
    
    console.log('✅ Successfully initiated room usage marking for room:', room._id.toString());
  } catch (markError) {
    console.error('⚠️ Failed to mark rooms as used, but continuing with schedule generation:', markError);
    // Don't fail the entire schedule generation due to room marking error
  }

  return {
    schedule,
    quarter,
    year,
    slotCount: allSlotIds.length,
    message: `Đá tạo thành công lịch quý ${quarter}/${year} cho phòng ${room.name}`
  };
};

// ✅ Lấy thông tin quý hiện tại và có thể tạo
exports.getQuarterInfo = async () => {
  const config = await cfgService.getConfig();
  const currentQuarter = config.getCurrentQuarter();
  const currentYear = config.getCurrentYear();
  const { quarter: nextQuarter, year: nextYear } = config.getNextQuarter(currentQuarter, currentYear);
  
  return {
    current: { quarter: currentQuarter, year: currentYear },
    next: { quarter: nextQuarter, year: nextYear },
    lastGenerated: config.lastQuarterGenerated,
    canGenerateCurrent: config.canGenerateQuarter(currentQuarter, currentYear),
    canGenerateNext: config.canGenerateQuarter(nextQuarter, nextYear)
  };
};

/**
 * Mark main room as used by sending RabbitMQ events to room service
 * @param {string} roomId - Room ID to mark as used
 */
const markMainRoomAsUsed = async (roomId) => {
  try {
    if (!roomId) {
      console.log('⚠️ No roomId provided to markMainRoomAsUsed');
      return;
    }

    const roomIdString = roomId.toString();
    await publishToQueue('room_queue', {
      action: 'markRoomAsUsed',
      payload: {
        roomId: roomIdString
      }
    });
  } catch (error) {
    console.error('❌ Error marking main room as used:', error);
  }
};

/**
 * Mark subrooms as used by sending RabbitMQ events to room service
 * @param {string} mainRoomId - Main room ID
 * @param {Array} subRoomIds - Array of subroom IDs to mark as used
 */
const markSubRoomsAsUsed = async (mainRoomId, subRoomIds) => {
  try {
    if (!subRoomIds || subRoomIds.length === 0) {
      console.log('⚠️ No subRoomIds provided to markSubRoomsAsUsed');
      return;
    }

    const mainRoomIdString = mainRoomId.toString();
    const uniqueSubRoomIds = [...new Set(subRoomIds.map(id => id.toString()))];

    // Send event for each subroom to mark as used
    for (const subRoomId of uniqueSubRoomIds) {
      await publishToQueue('room_queue', {
        action: 'markSubRoomAsUsed',
        payload: {
          roomId: mainRoomIdString,
          subRoomId: subRoomId
        }
      });
    }
  } catch (error) {
    console.error('❌ Error marking subrooms as used:', error);
  }
};

// Check if a room has schedules for a specific period
async function hasScheduleForPeriod(roomId, startDate, endDate) {
  try {
    const schedules = await scheduleRepo.findByRoomAndDateRange(roomId, startDate, endDate);
    return schedules && schedules.length > 0;
  } catch (error) {
    console.error('Error checking schedule for period:', error);
    return false; // Return false on error to be safe
  }
}

// Get detailed quarter analysis for a room (only check from current date forward)
async function getQuarterAnalysisForRoom(roomId, quarter, year, fromDate = new Date()) {
  try {
    const { startDate: quarterStart, endDate: quarterEnd } = getQuarterDateRange(quarter, year);
    const quarterSchedules = await scheduleRepo.findByRoomAndDateRange(roomId, quarterStart, quarterEnd);
    const totalQuarterSchedules = Array.isArray(quarterSchedules) ? quarterSchedules.length : 0;

    // Get all months in this quarter
    const startMonth = (quarter - 1) * 3 + 1; // 1, 4, 7, 10
    const months = [startMonth, startMonth + 1, startMonth + 2];
    
    // Filter months to only check from current date forward
    const currentDate = new Date(fromDate);
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth() + 1; // 1-based
    
    const relevantMonths = months.filter(month => {
      if (year > currentYear) return true; // Future year - check all months
      if (year < currentYear) return false; // Past year - skip all months
      
      // Same year logic
      if (month > currentMonth) return true; // Future months
      if (month < currentMonth) return false; // Past months
      
      // Current month - skip if last day of month (considered "too late")
      return !isLastDayOfMonth(currentDate);
    });
    
    console.log(`📅 Checking Q${quarter}/${year} from ${currentMonth}/${currentYear} - Relevant months:`, relevantMonths);
    
    const monthStatus = {};
    const scheduleDetails = [];
    let totalSchedules = totalQuarterSchedules;

    for (const month of months) {
      if (!relevantMonths.includes(month)) {
        // Skip past months - mark as "past"
        monthStatus[month] = 'past';
        continue;
      }
      
      // Check schedules for this specific month
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
      
      const monthSchedules = await scheduleRepo.findByRoomAndDateRange(roomId, monthStart, monthEnd);

      const hasSchedules = monthSchedules && monthSchedules.length > 0;
      monthStatus[month] = hasSchedules;

      if (hasSchedules) {
        scheduleDetails.push({
          month,
          scheduleCount: monthSchedules.length,
          dateRange: {
            start: monthSchedules[0]?.startDate,
            end: monthSchedules[monthSchedules.length - 1]?.endDate
          }
        });
      }
    }

    // Determine quarter status based only on relevant (future) months
    const completedRelevantMonths = relevantMonths.filter(month => monthStatus[month] === true).length;
    const totalRelevantMonths = relevantMonths.length;
    
    const isComplete = totalRelevantMonths > 0 && completedRelevantMonths === totalRelevantMonths;
    const isPartial = completedRelevantMonths > 0 && completedRelevantMonths < totalRelevantMonths;
    const isEmpty = completedRelevantMonths === 0 && totalRelevantMonths > 0;

    // Special case: if no relevant months (all past), consider complete
    const allPastMonths = totalRelevantMonths === 0;

    // Check if quarter has ANY schedule (including past months) - for subRoom creation logic
    const hasAnySchedule = totalQuarterSchedules > 0 || Object.values(monthStatus).some(status => status === true);

    return {
      quarter: `Q${quarter}/${year}`,
      months: monthStatus,
      relevantMonths,
      completedRelevantMonths,
      totalRelevantMonths,
      allPastMonths,
      isComplete: isComplete || allPastMonths,
      isPartial,
      isEmpty,
      hasAnySchedule,
      totalSchedules,
      quarterScheduleCount: totalQuarterSchedules,
      scheduleDetails,
      status: allPastMonths ? 'past' : isComplete ? 'complete' : isPartial ? 'partial' : 'empty',
      message: allPastMonths
        ? `Q${quarter}/${year} đã qua - không cần kiểm tra`
        : isComplete 
        ? `Đã có đủ lịch cho ${totalRelevantMonths} tháng còn lại trong Q${quarter}/${year}`
        : isPartial 
        ? `Đã có lịch cho ${completedRelevantMonths}/${totalRelevantMonths} tháng còn lại trong Q${quarter}/${year}`
        : `Chưa có lịch nào cho ${totalRelevantMonths} tháng còn lại trong Q${quarter}/${year}`
    };
  } catch (error) {
    console.error('Error getting quarter analysis:', error);
    return {
      quarter: `Q${quarter}/${year}`,
      status: 'error',
      message: `Lỗi kiểm tra lịch cho Q${quarter}/${year}: ${error.message}`,
      isComplete: false,
      isPartial: false,
      isEmpty: true
    };
  }
}

// 🆕 GENERATE SCHEDULE FOR SPECIFIC ROOM with shift selection
// 🆕 GENERATE SCHEDULE FOR SPECIFIC ROOM - THEO THÁNG (UPDATED)
exports.generateRoomSchedule = async ({
  roomId,
  subRoomId,
  selectedSubRoomIds, // 🆕 Array subRoomIds được chọn (nếu null = all active subrooms)
  fromMonth, // 1-12 (tháng bắt đầu)
  toMonth,   // 1-12 (tháng kết thúc)
  fromYear,  // Năm bắt đầu
  toYear,    // Năm kết thúc
  year,      // Deprecated - giữ để backward compatible
  startDate,
  partialStartDate, // 🆕 Ngày bắt đầu tạo lịch (cho tạo thiếu)
  shifts, // ['morning', 'afternoon', 'evening'] - ca nào được chọn để tạo
  createdBy
}) => {
  try {
    // Backward compatibility: Nếu không có fromYear/toYear, dùng year
    const effectiveFromYear = fromYear || year;
    const effectiveToYear = toYear || year;
    
    // 1. Validate input
    if (!fromMonth || !toMonth || fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12) {
      throw new Error('Tháng không hợp lệ. Vui lòng chọn tháng từ 1-12.');
    }
    
    if (!effectiveFromYear || !effectiveToYear) {
      throw new Error('Năm không hợp lệ. Vui lòng chọn năm bắt đầu và năm kết thúc.');
    }
    
    // Validate: toYear >= fromYear
    if (effectiveToYear < effectiveFromYear) {
      throw new Error('Năm kết thúc phải >= Năm bắt đầu');
    }
    
    // Validate: Nếu cùng năm thì toMonth >= fromMonth
    if (effectiveToYear === effectiveFromYear && toMonth < fromMonth) {
      throw new Error('Tháng kết thúc phải >= Tháng bắt đầu');
    }
    
    // 🆕 Validate partialStartDate nếu có
    if (partialStartDate) {
      const partialDate = new Date(partialStartDate);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      if (partialDate < tomorrow) {
        throw new Error('Ngày bắt đầu tạo lịch phải sau ngày hiện tại ít nhất 1 ngày');
      }
    }
    
    // 2. Fetch current schedule config
    const config = await cfgService.getConfig();
    if (!config) {
      throw new Error('Không tìm thấy cấu hình lịch làm việc. Vui lòng tạo cấu hình trước.');
    }

    const roomInfo = await getRoomByIdFromCache(roomId);
    if (!roomInfo) {
      throw new Error(`Không tìm thấy thông tin phòng ${roomId} trong cache`);
    }

    const roomHasSubRooms = roomInfo.hasSubRooms === true && Array.isArray(roomInfo.subRooms) && roomInfo.subRooms.length > 0;
    const configuredUnitDuration = Number.isFinite(config.unitDuration) && config.unitDuration > 0
      ? config.unitDuration
      : 15;

    const resolveSlotDuration = (shiftKey, shiftConfigSource) => {
      if (roomHasSubRooms) {
        return configuredUnitDuration;
      }

      const duration = calculateShiftDurationMinutes(shiftConfigSource.startTime, shiftConfigSource.endTime);
      if (duration <= 0) {
        const shiftLabel = shiftConfigSource?.name || shiftKey;
        throw new Error(`Thời gian cấu hình cho ${shiftLabel} không hợp lệ (start: ${shiftConfigSource.startTime}, end: ${shiftConfigSource.endTime})`);
      }
      return duration;
    };
    
    // 🆕 Determine which subrooms to process
    let allSubRoomIds = []; // Tất cả subrooms (để tạo schedule)
    let selectedSubRoomIdsSet = new Set(); // Subrooms được chọn (để sinh slots)
    
    if (roomHasSubRooms) {
      // Lấy TẤT CẢ subrooms của room
      allSubRoomIds = roomInfo.subRooms.map(sr => sr._id.toString());
      
      if (selectedSubRoomIds && Array.isArray(selectedSubRoomIds) && selectedSubRoomIds.length > 0) {
        // User selected specific subrooms - chỉ sinh slots cho những cái này
        selectedSubRoomIdsSet = new Set(selectedSubRoomIds.map(id => id.toString()));
        console.log(`📍 Tạo schedule cho ${allSubRoomIds.length} subrooms, sinh slots cho ${selectedSubRoomIds.length} subrooms được chọn`);
      } else if (subRoomId) {
        // Legacy: single subRoomId provided
        selectedSubRoomIdsSet = new Set([subRoomId.toString()]);
        console.log(`📍 Tạo schedule cho ${allSubRoomIds.length} subrooms, sinh slots cho 1 subroom`);
      } else {
        // No selection - sinh slots cho tất cả active subrooms
        selectedSubRoomIdsSet = new Set(
          roomInfo.subRooms
            .filter(sr => sr.isActive)
            .map(sr => sr._id.toString())
        );
        console.log(`📍 Tạo schedule cho ${allSubRoomIds.length} subrooms, sinh slots cho ${selectedSubRoomIdsSet.size} active subrooms`);
      }
    }
    
    // 3. 🆕 Create schedules for all months from fromMonth/fromYear to toMonth/toYear
    const results = [];
    let totalSlots = 0;
    
    // Tạo danh sách tất cả các tháng cần tạo lịch
    const monthsToGenerate = [];
    
    // Nếu cùng năm
    if (effectiveFromYear === effectiveToYear) {
      for (let month = fromMonth; month <= toMonth; month++) {
        monthsToGenerate.push({ month, year: effectiveFromYear });
      }
    } else {
      // Khác năm: Tạo từ fromMonth đến 12 của fromYear
      for (let month = fromMonth; month <= 12; month++) {
        monthsToGenerate.push({ month, year: effectiveFromYear });
      }
      
      // Các năm ở giữa (nếu có): Tạo tất cả 12 tháng
      for (let y = effectiveFromYear + 1; y < effectiveToYear; y++) {
        for (let month = 1; month <= 12; month++) {
          monthsToGenerate.push({ month, year: y });
        }
      }
      
      // Năm cuối: Tạo từ tháng 1 đến toMonth
      for (let month = 1; month <= toMonth; month++) {
        monthsToGenerate.push({ month, year: effectiveToYear });
      }
    }
    
    console.log(`📅 Sẽ tạo lịch cho ${monthsToGenerate.length} tháng:`, 
      monthsToGenerate.map(m => `${m.month}/${m.year}`).join(', '));
    
    // 🆕 Process ALL subrooms (or null for rooms without subrooms)
    const subRoomsToProcess = roomHasSubRooms && allSubRoomIds.length > 0 
      ? allSubRoomIds 
      : [null]; // null for rooms without subrooms
    
    console.log(`📍 Processing ${subRoomsToProcess.length} subroom(s), sinh slots cho ${selectedSubRoomIdsSet.size} subrooms`);
    
    // Duyệt qua tất cả các tháng cần tạo
    for (const { month, year: currentYear } of monthsToGenerate) {
      try {
        // Calculate month date range
        const monthStart = new Date(Date.UTC(currentYear, month - 1, 1, -7, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(currentYear, month, 0, 16, 59, 59, 999));
        
        // For first month, use provided startDate if later than month start
        const isFirstMonth = currentYear === effectiveFromYear && month === fromMonth;
        let scheduleStartDate = monthStart;
        if (isFirstMonth && startDate) {
          const providedStart = new Date(startDate);
          if (providedStart > monthStart) {
            scheduleStartDate = providedStart;
          }
        }
        
        // 🆕 Process each subroom (or once for rooms without subrooms)
        for (const currentSubRoomId of subRoomsToProcess) {
          try {
            console.log(`\n🔧 Processing month ${month}/${currentYear}, subRoom: ${currentSubRoomId || 'main room'}`);
            
            // Check if schedule already exists for this month + subroom
            const existingSchedule = await scheduleRepo.findOne({
              roomId,
              subRoomId: currentSubRoomId,
              month,
          year: currentYear
        });
        
        if (existingSchedule) {
          // Kiểm tra xem có ca nào chưa được tạo không
          const missingShifts = shifts.filter(shiftName => {
            const shiftKey = shiftName;
            return !existingSchedule.shiftConfig[shiftKey]?.isGenerated;
          });
          
          if (missingShifts.length > 0) {
            // Có ca chưa được tạo -> Generate thêm ca mới
            console.log(`📝 Adding missing shifts to existing schedule: ${missingShifts.join(', ')}`);
            
            // 🆕 Validate partialStartDate nếu có
            let effectiveStartDate = existingSchedule.startDate;
            if (partialStartDate) {
              const partialDate = new Date(partialStartDate);
              const scheduleEnd = new Date(existingSchedule.endDate);
              
              if (partialDate > scheduleEnd) {
                throw new Error('Ngày bắt đầu tạo lịch không thể sau ngày kết thúc của lịch');
              }
              
              effectiveStartDate = partialDate;
              console.log(`🗓️  Tạo ca thiếu từ ngày: ${partialDate.toLocaleDateString('vi-VN')}`);
            }
            
            try {
              let addedSlots = 0;
              const slotsByShift = {};
              
              for (const shiftName of missingShifts) {
                const shiftKey = shiftName;
                const shiftInfo = existingSchedule.shiftConfig[shiftKey];
                
                // 🆕 QUAN TRỌNG: Bỏ qua check isActive - vẫn cho tạo ca dù isActive=false
                // Frontend đã filter theo isActive rồi

                const desiredSlotDuration = roomHasSubRooms
                  ? configuredUnitDuration
                  : calculateShiftDurationMinutes(shiftInfo.startTime, shiftInfo.endTime);

                if (!desiredSlotDuration || desiredSlotDuration <= 0) {
                  const shiftLabel = shiftInfo?.name || shiftKey;
                  throw new Error(`Thời gian cấu hình cho ${shiftLabel} không hợp lệ (start: ${shiftInfo.startTime}, end: ${shiftInfo.endTime})`);
                }

                shiftInfo.slotDuration = desiredSlotDuration;
                
                // 🆕 Sử dụng partialStartDate nếu có, nếu không dùng startDate gốc
                const newSlots = await generateSlotsForShift({
                  scheduleId: existingSchedule._id,
                  roomId,
                  subRoomId: currentSubRoomId,
                  shiftName: shiftInfo.name,
                  shiftStart: shiftInfo.startTime,
                  shiftEnd: shiftInfo.endTime,
                  slotDuration: shiftInfo.slotDuration,
                  scheduleStartDate: effectiveStartDate, // 🆕 Dùng partialStartDate nếu có
                  scheduleEndDate: existingSchedule.endDate,
                  holidaySnapshot: existingSchedule.holidaySnapshot
                });
                
                addedSlots += newSlots.length;
                slotsByShift[shiftName] = newSlots.length;
                
                // Cập nhật shiftConfig để đánh dấu ca đã được tạo
                existingSchedule.shiftConfig[shiftKey].isGenerated = true;
              }
              
              await existingSchedule.save();
              
              results.push({
                month,
                year,
                status: 'updated',
                message: `Đã thêm ${missingShifts.join(', ')} vào lịch hiện có${partialStartDate ? ` từ ngày ${new Date(partialStartDate).toLocaleDateString('vi-VN')}` : ''}`,
                scheduleId: existingSchedule._id,
                addedSlots,
                slotsByShift
              });
              
              totalSlots += addedSlots;
              
            } catch (error) {
              console.error(`❌ Error adding shifts to existing schedule:`, error);
              results.push({
                month,
                status: 'error',
                error: `Không thể thêm ca mới: ${error.message}`
              });
            }
            
            continue;
          }
          
          // Tất cả các ca đã được tạo -> Skip
          const generatedShifts = [];
          if (existingSchedule.shiftConfig.morning?.isGenerated) generatedShifts.push('Ca Sáng');
          if (existingSchedule.shiftConfig.afternoon?.isGenerated) generatedShifts.push('Ca Chiều');
          if (existingSchedule.shiftConfig.evening?.isGenerated) generatedShifts.push('Ca Tối');
          
          const startDateFormatted = new Date(existingSchedule.startDate).toLocaleDateString('vi-VN');
          const endDateFormatted = new Date(existingSchedule.endDate).toLocaleDateString('vi-VN');
          
          console.warn(`⚠️ Schedule already exists for month ${month}/${currentYear}, all requested shifts already generated`);
          results.push({
            month,
            year: currentYear,
            status: 'skipped',
            reason: 'Schedule already exists with all requested shifts',
            existingScheduleInfo: {
              scheduleId: existingSchedule._id,
              startDate: startDateFormatted,
              endDate: endDateFormatted,
              generatedShifts: generatedShifts.join(', '),
              message: `Đã có lịch từ ${startDateFormatted} đến ${endDateFormatted} (${generatedShifts.join(', ')})`
            }
          });
          continue;
        }
        
        // 🆕 Kiểm tra xem subroom này có được chọn để sinh slots không
        const isSubRoomSelected = !currentSubRoomId || selectedSubRoomIdsSet.has(currentSubRoomId.toString());
        
        // ✅ Lưu isActiveSubRoom nếu có currentSubRoomId
        let isActiveSubRoom = true;
        if (currentSubRoomId && roomHasSubRooms && roomInfo.subRooms) {
          const currentSubRoom = roomInfo.subRooms.find(sr => sr._id.toString() === currentSubRoomId.toString());
          if (currentSubRoom) {
            isActiveSubRoom = currentSubRoom.isActive;
            console.log(`📸 SubRoom ${currentSubRoom.name} - isActive: ${isActiveSubRoom}, isSelected: ${isSubRoomSelected}`);
          }
        }
        
        // Create shift config snapshot - LƯU CẢ 3 CA
        // ✅ Chỉ set isGenerated=true nếu: subroom được chọn + shift được chọn
        const shiftConfig = {
          morning: {
            name: config.morningShift.name,
            startTime: config.morningShift.startTime,
            endTime: config.morningShift.endTime,
            slotDuration: resolveSlotDuration('morning', config.morningShift),
            isActive: config.morningShift.isActive, // ✅ Lưu đúng trạng thái từ config
            isGenerated: isSubRoomSelected && shifts.includes('morning') // ✅ Chỉ true nếu subroom được chọn + shift được chọn
          },
          afternoon: {
            name: config.afternoonShift.name,
            startTime: config.afternoonShift.startTime,
            endTime: config.afternoonShift.endTime,
            slotDuration: resolveSlotDuration('afternoon', config.afternoonShift),
            isActive: config.afternoonShift.isActive, // ✅ Lưu đúng trạng thái từ config
            isGenerated: isSubRoomSelected && shifts.includes('afternoon')
          },
          evening: {
            name: config.eveningShift.name,
            startTime: config.eveningShift.startTime,
            endTime: config.eveningShift.endTime,
            slotDuration: resolveSlotDuration('evening', config.eveningShift),
            isActive: config.eveningShift.isActive, // ✅ Lưu đúng trạng thái từ config
            isGenerated: isSubRoomSelected && shifts.includes('evening')
          }
        };
        
        // 🆕 Lấy holiday snapshot cho khoảng thời gian tạo lịch
        const holidaySnapshot = await getHolidaySnapshot(scheduleStartDate, monthEnd);
        
        // Create Schedule document
        const scheduleData = {
          roomId,
          subRoomId: currentSubRoomId,
          isActiveSubRoom, // ✅ Lưu trạng thái active của subroom lúc tạo lịch
          month,
          year: currentYear,
          startDate: scheduleStartDate,
          endDate: monthEnd,
          shiftConfig,
          holidaySnapshot, // Lưu snapshot holiday
          staffAssignment: {
            morning: { assigned: 0, total: 0 },
            afternoon: { assigned: 0, total: 0 },
            evening: { assigned: 0, total: 0 }
          },
          isActive: true,
          generationType: 'monthly',
          createdBy
        };
        
        const schedule = await scheduleRepo.create(scheduleData);
        
        // ✅ CHỈ SINH SLOTS nếu subroom được chọn
        let monthSlots = 0;
        const slotsByShift = {};
        
        if (!isSubRoomSelected) {
          console.log(`⏭️ Skipping slot generation for unselected subroom ${currentSubRoomId}`);
          // Không sinh slots, nhưng vẫn tạo schedule với isGenerated=false
        } else {
          // Generate slots CHỈ cho các ca được chọn
          // 🆕 Nếu room có subrooms, check xem subroom + shift nào đã có (để tránh duplicate)
          let existingSubRoomShifts = new Set();
          if (roomHasSubRooms && currentSubRoomId) {
            // Query tất cả schedules của room này trong khoảng thời gian overlap
            // ✅ QUAN TRỌNG: Exclude schedule vừa tạo
            const overlappingSchedules = await Schedule.find({
              _id: { $ne: schedule._id }, // ✅ Loại trừ schedule vừa tạo
              roomId,
              subRoomId: currentSubRoomId, // Chỉ check subroom hiện tại
              $or: [
                { startDate: { $lte: monthEnd }, endDate: { $gte: scheduleStartDate } },
              ]
            });
            
            for (const existingSched of overlappingSchedules) {
              if (existingSched.shiftConfig.morning?.isGenerated) {
                existingSubRoomShifts.add('morning');
              }
              if (existingSched.shiftConfig.afternoon?.isGenerated) {
              existingSubRoomShifts.add('afternoon');
            }
            if (existingSched.shiftConfig.evening?.isGenerated) {
              existingSubRoomShifts.add('evening');
            }
          }
          
          if (existingSubRoomShifts.size > 0) {
            console.log(`⚠️ SubRoom ${currentSubRoomId} already has shifts in OTHER schedules: ${Array.from(existingSubRoomShifts).join(', ')}`);
          }
          } // End of if (roomHasSubRooms && currentSubRoomId)
        
          for (const shiftName of shifts) {
            const shiftKey = shiftName;
            const shiftInfo = shiftConfig[shiftKey];
          
          console.log(`🔍 Processing shift: ${shiftKey}, isActive: ${shiftInfo.isActive}, startTime: ${shiftInfo.startTime}, endTime: ${shiftInfo.endTime}, slotDuration: ${shiftInfo.slotDuration}`);
          
          // 🆕 KHÔNG check isActive - frontend đã filter rồi, backend chỉ tạo theo yêu cầu
          // if (!shiftInfo.isActive) {
          //   console.warn(`⚠️ Shift ${shiftName} is not active, skipping`);
          //   continue;
          // }
          
          // 🆕 Bỏ qua nếu (subroom + shift) đã tồn tại
          if (existingSubRoomShifts.has(shiftKey)) {
            console.log(`⏭️ Skipping ${shiftKey} for subroom ${currentSubRoomId} - already exists`);
            slotsByShift[shiftKey] = 0;
            continue;
          }
          
          console.log(`🔧 Generating slots for ${shiftKey} from ${scheduleStartDate.toISOString()} to ${monthEnd.toISOString()}`);
          
          // 🆕 Generate slots với holiday snapshot
          const generatedSlots = await generateSlotsForShift({
            scheduleId: schedule._id,
            roomId,
            subRoomId: currentSubRoomId,
            shiftName: shiftInfo.name,
            shiftStart: shiftInfo.startTime,
            shiftEnd: shiftInfo.endTime,
            slotDuration: shiftInfo.slotDuration,
            scheduleStartDate,
            scheduleEndDate: monthEnd,
            holidaySnapshot: schedule.holidaySnapshot // Truyền holiday snapshot
          });
          
          console.log(`✅ Generated ${generatedSlots.length} slots for ${shiftKey}`);
          
          slotsByShift[shiftKey] = generatedSlots.length;
          monthSlots += generatedSlots.length;
          
          // Update staffAssignment total
          schedule.staffAssignment[shiftKey].total = generatedSlots.length;
        }
        } // End of if (isSubRoomSelected)
        
        await schedule.save();
        totalSlots += monthSlots;
        
        // 🆕 Emit RabbitMQ event to update hasBeenUsed for subrooms
        if (currentSubRoomId && isSubRoomSelected) {
          try {
            await publishToQueue('subroom.schedule.created', {
              type: 'SUBROOM_USED',
              roomId: roomId.toString(),
              subRoomIds: [currentSubRoomId.toString()],
              hasBeenUsed: true,
              timestamp: new Date()
            });
            console.log(`📤 Emitted subroom.schedule.created event for subRoom ${currentSubRoomId}`);
          } catch (eventError) {
            console.error(`❌ Failed to emit subroom event:`, eventError.message);
            // Don't fail schedule creation if event emission fails
          }
        }
        
        // 🆕 Mark non-recurring holidays as used
        if (holidaySnapshot.nonRecurringHolidayIds && holidaySnapshot.nonRecurringHolidayIds.length > 0) {
          console.log(`📝 Marking ${holidaySnapshot.nonRecurringHolidayIds.length} non-recurring holidays as used`);
          for (const holidayId of holidaySnapshot.nonRecurringHolidayIds) {
            await cfgService.markHolidayAsUsed(holidayId);
          }
        }
        
        results.push({
          month,
          year: currentYear,
          subRoomId: currentSubRoomId,
          status: 'success',
          scheduleId: schedule._id,
          slots: monthSlots,
          slotsByShift
        });
        
        // Clear cache
        await redisClient.del(`schedule:${schedule._id}`);
        
          } catch (subRoomError) {
            // Error for specific subroom
            console.error(`❌ Error generating schedule for month ${month}/${currentYear}, subRoom ${currentSubRoomId}:`, subRoomError);
            results.push({
              month,
              year: currentYear,
              subRoomId: currentSubRoomId,
              status: 'error',
              error: subRoomError.message
            });
          }
        } // End of subroom loop
        
      } catch (monthError) {
        console.error(`❌ Error generating schedule for month ${month}/${currentYear}:`, monthError);
        results.push({
          month,
          year: currentYear,
          status: 'error',
          error: monthError.message
        });
      }
    } // End of month loop
    
    // Update room schedule info + hasBeenUsed = true (sau khi tạo hết)
    try {
      const firstResult = results.find(r => r.status === 'success');
      const lastResult = results.reverse().find(r => r.status === 'success');
      results.reverse(); // Restore order
      
      if (firstResult && lastResult) {
        await publishToQueue('room.schedule.updated', {
          roomId,
          hasBeenUsed: true,
          lastScheduleGenerated: new Date()
        });
      } else {
        // Nếu không có schedule mới được tạo, update hasBeenUsed
        await publishToQueue('room.schedule.updated', {
          roomId,
          hasBeenUsed: true,
          lastScheduleGenerated: new Date()
        });
      }
    } catch (error) {
      console.error('❌ Failed to update room schedule info:', error.message);
    }
    
    // Clear room cache
    await redisClient.del(`room:${roomId}:schedules`);
    
    return {
      success: true,
      message: `Đã tạo lịch cho ${results.filter(r => r.status === 'success').length}/${results.length} tháng`,
      results,
      stats: {
        totalSlots,
        monthRange: `${fromMonth}/${year} - ${toMonth}/${year}`,
        shiftsGenerated: shifts,
        shiftsNotGenerated: ['morning', 'afternoon', 'evening'].filter(s => !shifts.includes(s))
      }
    };
    
  } catch (error) {
    console.error('❌ Error generating room schedule:', error);
    throw error;
  }
};

// Ensure generateRoomSchedule is exported on module.exports after its definition
module.exports.generateRoomSchedule = exports.generateRoomSchedule;

// 🆕 Get room schedules with shift information
exports.getRoomSchedulesWithShifts = async (roomId, subRoomId = null, month = null, year = null) => {
  try {
    let schedules = await scheduleRepo.findByRoomId(roomId);
    
    // 🆕 Filter by month/year if provided
    if (month && year) {
      schedules = schedules.filter(s => s.month === month && s.year === year);
      console.log(`📅 Filtered to ${schedules.length} schedules for ${month}/${year}`);
    }
    
    // Filter by subRoomId if provided
    if (subRoomId) {
      schedules = schedules.filter(s => 
        s.subRoomId && s.subRoomId.toString() === subRoomId.toString()
      );
    }
    
    // Sort by startDate
    schedules.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // 🆕 Get room info to check for subrooms
    const roomInfo = await getRoomByIdFromCache(roomId);
    const roomHasSubRooms = roomInfo?.hasSubRooms === true && Array.isArray(roomInfo.subRooms) && roomInfo.subRooms.length > 0;
    
    // 🆕 Get current date for expiration check
    const nowVN = getVietnamDate();
    nowVN.setHours(0, 0, 0, 0);
    
    // Transform to include shift info
    const schedulesWithShifts = schedules.map(schedule => {
      const generatedShifts = [];
      const missingShifts = [];
      const disabledShifts = []; // 🆕 Ca đã tắt (isActive: false)
      const shiftConfigSnapshot = {
        morning: schedule.shiftConfig?.morning ? { ...schedule.shiftConfig.morning } : null,
        afternoon: schedule.shiftConfig?.afternoon ? { ...schedule.shiftConfig.afternoon } : null,
        evening: schedule.shiftConfig?.evening ? { ...schedule.shiftConfig.evening } : null
      };
      
      // ✅ Tính ca đã tạo, ca thiếu, và ca đã tắt
      // Ca đã tạo: isGenerated = true
      // Ca thiếu: isGenerated = false VÀ isActive = true
      // Ca đã tắt: isActive = false (không phân biệt isGenerated)
      
      if (schedule.shiftConfig.morning?.isGenerated) {
        generatedShifts.push({ key: 'morning', name: 'Ca Sáng', color: 'gold' });
      } else if (schedule.shiftConfig.morning?.isActive) {
        // Ca đang bật nhưng chưa tạo
        missingShifts.push({ 
          key: 'morning', 
          name: 'Ca Sáng', 
          color: 'gold',
          isActive: true
        });
      } else if (schedule.shiftConfig.morning?.isActive === false) {
        // 🆕 Ca đã tắt
        disabledShifts.push({ 
          key: 'morning', 
          name: 'Ca Sáng', 
          color: 'gold',
          isActive: false
        });
      }
      
      if (schedule.shiftConfig.afternoon?.isGenerated) {
        generatedShifts.push({ key: 'afternoon', name: 'Ca Chiều', color: 'blue' });
      } else if (schedule.shiftConfig.afternoon?.isActive) {
        missingShifts.push({ 
          key: 'afternoon', 
          name: 'Ca Chiều', 
          color: 'blue',
          isActive: true
        });
      } else if (schedule.shiftConfig.afternoon?.isActive === false) {
        disabledShifts.push({ 
          key: 'afternoon', 
          name: 'Ca Chiều', 
          color: 'blue',
          isActive: false
        });
      }
      
      if (schedule.shiftConfig.evening?.isGenerated) {
        generatedShifts.push({ key: 'evening', name: 'Ca Tối', color: 'purple' });
      } else if (schedule.shiftConfig.evening?.isActive) {
        missingShifts.push({ 
          key: 'evening', 
          name: 'Ca Tối', 
          color: 'purple',
          isActive: true
        });
      } else if (schedule.shiftConfig.evening?.isActive === false) {
        disabledShifts.push({ 
          key: 'evening', 
          name: 'Ca Tối', 
          color: 'purple',
          isActive: false
        });
      }
      
      // ✅ Nếu schedule có subRoomId, thêm thông tin subRoom
      let subRoom = null;
      if (schedule.subRoomId && roomHasSubRooms) {
        const currentSubRoom = roomInfo.subRooms.find(
          sr => sr._id.toString() === schedule.subRoomId.toString()
        );
        if (currentSubRoom) {
          subRoom = {
            _id: currentSubRoom._id,
            name: currentSubRoom.name,
            isActive: currentSubRoom.isActive, // Trạng thái hiện tại
            isActiveSubRoom: schedule.isActiveSubRoom !== undefined ? schedule.isActiveSubRoom : true // Trạng thái lúc tạo lịch
          };
        }
      }
      
      // 🆕 Check if schedule is expired (currentDate > endDate)
      const scheduleEndDate = new Date(schedule.endDate);
      scheduleEndDate.setHours(23, 59, 59, 999);
      const isExpired = nowVN > scheduleEndDate;
      
      // 🆕 Can create = NOT expired AND has at least 1 active missing shift
      const hasAtLeastOneActiveMissing = missingShifts.some(shift => shift.isActive === true);
      const canCreate = !isExpired && hasAtLeastOneActiveMissing;
      
      return {
        scheduleId: schedule._id,
        month: schedule.month,
        year: schedule.year,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        shiftConfig: shiftConfigSnapshot,
        holidaySnapshot: schedule.holidaySnapshot || { recurringHolidays: [], nonRecurringHolidays: [] },
        subRoom, // ✅ Thông tin subroom nếu có
        generatedShifts,
        missingShifts,
        disabledShifts, // 🆕 Ca đã tắt
        hasMissingShifts: missingShifts.length > 0,
        isComplete: missingShifts.length === 0,
        isExpired, // 🆕 Đánh dấu lịch đã hết hạn
        canCreate, // 🆕 Có thể tạo ca thiếu không (false nếu expired hoặc tất cả missing đều inactive)
        createdAt: schedule.createdAt,
        updatedAt: schedule.updatedAt
      };
    });
    
    // Calculate gap info and summary
    let lastCreatedDate = null;
    let earliestGapStart = null;
    let hasGap = false;
    
    if (schedulesWithShifts.length > 0) {
      // Get last updated date
      const sortedByUpdate = [...schedulesWithShifts].sort((a, b) => 
        new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      lastCreatedDate = sortedByUpdate[0].updatedAt;
      
      // Check for gaps in schedule coverage (nowVN đã được khai báo ở trên)
      
      // Find earliest gap (missing dates between schedules or before latest schedule)
      for (let i = 0; i < schedulesWithShifts.length - 1; i++) {
        const current = schedulesWithShifts[i];
        const next = schedulesWithShifts[i + 1];
        
        const currentEnd = new Date(current.endDate);
        const nextStart = new Date(next.startDate);
        
        // Calculate days between (should be 1 for continuous schedules)
        const daysDiff = Math.floor((nextStart - currentEnd) / (1000 * 60 * 60 * 24));
        
        if (daysDiff > 1) {
          hasGap = true;
          const gapStart = new Date(currentEnd);
          gapStart.setDate(gapStart.getDate() + 1);
          
          if (!earliestGapStart || gapStart < earliestGapStart) {
            earliestGapStart = gapStart;
          }
        }
      }
      
      // Check if there's a gap from last schedule to future
      const lastSchedule = schedulesWithShifts[schedulesWithShifts.length - 1];
      const lastEnd = new Date(lastSchedule.endDate);
      
      // If last schedule ended in the past and we have gaps, use earliest gap
      // Otherwise, suggest continuing from day after last schedule
      if (!earliestGapStart) {
        earliestGapStart = new Date(lastEnd);
        earliestGapStart.setDate(earliestGapStart.getDate() + 1);
        
        // If that date is in the past, use tomorrow
        if (earliestGapStart < nowVN) {
          earliestGapStart = new Date(nowVN);
          earliestGapStart.setDate(earliestGapStart.getDate() + 1);
        }
      }
    }
    
    // 🆕 Build subRoomShiftStatus: Matrix showing which shifts each subroom has
    const subRoomShiftStatus = [];
    const missingSubRooms = [];
    
    if (roomHasSubRooms && roomInfo.subRooms && roomInfo.subRooms.length > 0) {
      // ✅ Group schedules by subRoomId (LẤY TRỰC TIẾP TỪ SCHEDULE DB)
      const schedulesBySubRoom = new Map();
      
      schedules.forEach(schedule => {
        if (schedule.subRoomId) {
          const subRoomId = schedule.subRoomId.toString();
          if (!schedulesBySubRoom.has(subRoomId)) {
            schedulesBySubRoom.set(subRoomId, []);
          }
          schedulesBySubRoom.get(subRoomId).push(schedule);
        }
      });
      
      console.log(`📋 Found ${schedulesBySubRoom.size} unique subrooms in ${schedules.length} schedules`);
      
      // ✅ Build status cho TẤT CẢ subrooms từ room cache
      roomInfo.subRooms.forEach(subRoomInfo => {
        const subRoomIdString = subRoomInfo._id.toString();
        const subRoomSchedules = schedulesBySubRoom.get(subRoomIdString) || [];
        
        if (subRoomSchedules.length === 0) {
          // ⚠️ SubRoom chưa có lịch cho tháng này
          console.log(`⚠️ SubRoom ${subRoomInfo.name} chưa có lịch cho tháng ${month}/${year}`);
          
          subRoomShiftStatus.push({
            subRoomId: subRoomInfo._id,
            subRoomName: subRoomInfo.name,
            isActive: subRoomInfo.isActive, // Trạng thái hiện tại
            isActiveSubRoom: subRoomInfo.isActive, // Không có snapshot, dùng current
            shifts: { morning: false, afternoon: false, evening: false },
            generatedShifts: { morning: false, afternoon: false, evening: false },
            hasAnyShift: false,
            hasSchedule: false
          });
          
          return;
        }
        
        // Lấy schedule đầu tiên (vì cùng tháng/năm nên config giống nhau)
        const firstSchedule = subRoomSchedules[0];
        
        // ✅ Lấy danh sách ca có trong shiftConfig (dựa vào isActive)
        const availableShifts = {
          morning: firstSchedule.shiftConfig?.morning?.isActive || false,
          afternoon: firstSchedule.shiftConfig?.afternoon?.isActive || false,
          evening: firstSchedule.shiftConfig?.evening?.isActive || false
        };
        
        // ✅ Kiểm tra ca nào đã được generate (để hiển thị ca thiếu)
        const generatedShifts = {
          morning: firstSchedule.shiftConfig?.morning?.isGenerated || false,
          afternoon: firstSchedule.shiftConfig?.afternoon?.isGenerated || false,
          evening: firstSchedule.shiftConfig?.evening?.isGenerated || false
        };
        
        subRoomShiftStatus.push({
          subRoomId: firstSchedule.subRoomId, // ✅ Lấy từ schedule.subRoomId
          subRoomName: subRoomInfo.name, // ✅ Lấy từ room cache
          isActive: subRoomInfo.isActive, // ✅ Trạng thái hiện tại (từ room cache)
          isActiveSubRoom: firstSchedule.isActiveSubRoom !== undefined 
            ? firstSchedule.isActiveSubRoom 
            : true, // ✅ Trạng thái lúc tạo lịch (từ schedule.isActiveSubRoom)
          shifts: availableShifts, // ✅ Ca nào có trong lịch (based on isActive)
          generatedShifts, // ✅ Ca nào đã tạo slots (based on isGenerated)
          hasAnyShift: availableShifts.morning || availableShifts.afternoon || availableShifts.evening,
          hasSchedule: true
        });
      });
      
      console.log(`✅ Built subRoomShiftStatus for ${subRoomShiftStatus.length} subrooms (${roomInfo.subRooms.length} total in room)`);
    }
    
    return {
      schedules: schedulesWithShifts,
      subRoomShiftStatus, // ✅ Buồng có lịch: hiển thị ca nào đã tạo
      missingSubRooms, // ✅ Buồng chưa có lịch: vẫn cho chọn để tạo lịch mới
      summary: {
        totalSchedules: schedulesWithShifts.length,
        lastCreatedDate,
        hasGap,
        suggestedStartDate: earliestGapStart,
        earliestEndDate: schedulesWithShifts.length > 0 ? schedulesWithShifts[0].endDate : null,
        latestEndDate: schedulesWithShifts.length > 0 ? 
          schedulesWithShifts[schedulesWithShifts.length - 1].endDate : null
      }
    };
  } catch (error) {
    console.error('❌ Error getting room schedules with shifts:', error);
    throw error;
  }
};

module.exports.getRoomSchedulesWithShifts = exports.getRoomSchedulesWithShifts;

// 🆕 Update schedule (reactive scheduling)
exports.updateSchedule = async ({ scheduleId, isActive, reactivateShifts, reactivateSubRooms, updatedBy }) => {
  try {
    const schedule = await scheduleRepo.findById(scheduleId);
    
    if (!schedule) {
      throw new Error('Không tìm thấy lịch');
    }

    let updated = false;
    const changes = [];

    // 1. Toggle schedule.isActive (nếu có)
    if (typeof isActive === 'boolean' && schedule.isActive !== isActive) {
      schedule.isActive = isActive;
      updated = true;
      changes.push(`Toggle isActive: ${isActive ? 'Bật' : 'Tắt'} lịch`);
      
      console.log(`🔄 Toggled schedule.isActive to ${isActive}`);
    }

    // 2. Reactivate shifts (false → true only)
    if (reactivateShifts && Array.isArray(reactivateShifts) && reactivateShifts.length > 0) {
      for (const shiftKey of reactivateShifts) {
        if (!schedule.shiftConfig[shiftKey]) {
          throw new Error(`Ca ${shiftKey} không tồn tại trong lịch`);
        }

        const currentActive = schedule.shiftConfig[shiftKey].isActive;
        
        // QUAN TRỌNG: Chỉ cho phép false → true
        if (currentActive === true) {
          throw new Error(`Ca ${shiftKey} đang hoạt động, không thể thay đổi (chỉ cho phép kích hoạt lại ca đã tắt)`);
        }

        // Chỉ cho phép reactivate nếu chưa generate
        if (schedule.shiftConfig[shiftKey].isGenerated === true) {
          throw new Error(`Ca ${shiftKey} đã được tạo slots, không thể kích hoạt lại`);
        }

        schedule.shiftConfig[shiftKey].isActive = true;
        updated = true;
        changes.push(`Kích hoạt lại ca: ${schedule.shiftConfig[shiftKey].name}`);
        
        console.log(`✅ Reactivated shift: ${shiftKey}`);
      }
    }

    // 3. ✅ Reactivate subrooms (false → true only)
    if (reactivateSubRooms && Array.isArray(reactivateSubRooms) && reactivateSubRooms.length > 0) {
      console.log(`🔄 Processing ${reactivateSubRooms.length} subrooms to reactivate`);
      
      for (const subRoomId of reactivateSubRooms) {
        // Tìm schedule của subroom này
        const subRoomSchedule = await scheduleRepo.findOne({
          roomId: schedule.roomId,
          subRoomId: subRoomId,
          month: schedule.month,
          year: schedule.year
        });

        if (!subRoomSchedule) {
          console.log(`⚠️ No schedule found for subRoom ${subRoomId}`);
          continue;
        }

        // Kiểm tra trạng thái hiện tại
        if (subRoomSchedule.isActiveSubRoom === true) {
          console.log(`ℹ️ SubRoom ${subRoomId} already active, skipping`);
          continue;
        }

        // Kích hoạt lại
        subRoomSchedule.isActiveSubRoom = true;
        subRoomSchedule.updatedAt = new Date();
        await subRoomSchedule.save();

        // Clear cache
        await redisClient.del(`schedule:${subRoomSchedule._id}`);

        updated = true;
        changes.push(`Kích hoạt lại buồng: ${subRoomId}`);
        console.log(`✅ Reactivated subRoom: ${subRoomId}`);
      }
    }

    if (!updated) {
      return {
        message: 'Không có thay đổi nào',
        scheduleId: schedule._id
      };
    }

    // Save changes (if schedule itself was modified)
    schedule.updatedAt = new Date();
    await schedule.save();

    // Clear cache
    await redisClient.del(`schedule:${scheduleId}`);

    return {
      message: 'Cập nhật lịch thành công',
      scheduleId: schedule._id,
      changes
    };

  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    throw error;
  }
};

module.exports.updateSchedule = exports.updateSchedule;

// 🆕 Add missing shifts to existing schedule
exports.addMissingShifts = async ({ 
  roomId,
  month,
  year,
  subRoomIds = [], 
  selectedShifts = [],
  partialStartDate = null,
  updatedBy 
}) => {
  try {
    console.log(`\n🔧 [addMissingShifts] Starting...`);
    console.log(`   roomId: ${roomId}`);
    console.log(`   month: ${month}, year: ${year}`);
    console.log(`   subRoomIds: ${JSON.stringify(subRoomIds)}`);
    console.log(`   selectedShifts: ${JSON.stringify(selectedShifts)}`);
    console.log(`   partialStartDate: ${partialStartDate}`);

    // 1. Get room info from cache
    const roomCache = await redisClient.get('rooms_cache');
    if (!roomCache) {
      throw new Error('Không tìm thấy thông tin phòng trong cache');
    }
    const rooms = JSON.parse(roomCache);
    const room = rooms.find(r => r._id.toString() === roomId.toString());
    if (!room) {
      throw new Error('Không tìm thấy phòng');
    }

    // 2. Get config for slot duration
    const config = await cfgService.getConfig();
    const slotDuration = config?.slotDuration || 30;

    const results = [];
    let totalAddedSlots = 0;
    const today = dayjs().startOf('day');
    const tomorrow = today.add(1, 'day');

    // 3. Determine which subrooms to process
    let targetSubRoomIds = [];
    
    if (room.hasSubRooms && room.subRooms?.length > 0) {
      console.log(`   🏠 Room has ${room.subRooms.length} subrooms`);
      console.log(`   🏠 Room.subRooms:`, room.subRooms.map(sr => ({ id: sr._id, name: sr.name })));
      
      if (subRoomIds.length === 0) {
        // No specific subrooms selected → Use ALL subrooms
        targetSubRoomIds = room.subRooms.map(sr => sr._id.toString());
        console.log(`   📦 No subrooms specified, processing ALL ${targetSubRoomIds.length} subrooms: ${targetSubRoomIds.join(', ')}`);
      } else {
        targetSubRoomIds = subRoomIds.map(id => id.toString());
        console.log(`   📦 Processing ${targetSubRoomIds.length} selected subrooms: ${targetSubRoomIds.join(', ')}`);
      }
    } else {
      // Room has NO subrooms → Find schedule without subRoomId filter
      // We'll handle this separately below
      targetSubRoomIds = null;
      console.log(`   🏠 Room has NO subrooms, will find schedule by roomId only`);
    }

    // 4. Process each subroom (or room without subrooms)
    if (targetSubRoomIds === null) {
      // 🔧 SPECIAL CASE: Room without subrooms
      console.log(`\n   🔄 Processing room WITHOUT subrooms`);
      
      // Find schedule for this room + month + year (without subRoomId filter)
      const schedule = await scheduleRepo.findOne({
        roomId: roomId,
        month: month,
        year: year
      });

      if (!schedule) {
        console.log(`   ⚠️ No schedule found for room ${roomId} in ${month}/${year}`);
        results.push({
          roomId,
          status: 'error',
          message: `Không tìm thấy lịch cho tháng ${month}/${year}`
        });
      } else {
        console.log(`   ✅ Found schedule: ${schedule._id}`);
        
        // Determine start and end dates
        const scheduleStartDate = dayjs(schedule.startDate);
        const scheduleEndDate = dayjs(schedule.endDate);
        
        let effectiveStartDate = scheduleStartDate;
        
        if (partialStartDate) {
          const partial = dayjs(partialStartDate);
          
          if (partial.isSameOrAfter(scheduleStartDate, 'day') && partial.isSameOrBefore(scheduleEndDate, 'day')) {
            if (partial.isSameOrBefore(today, 'day')) {
              effectiveStartDate = tomorrow;
              console.log(`      ⚠️ Partial date <= today, using tomorrow: ${effectiveStartDate.format('YYYY-MM-DD')}`);
            } else {
              effectiveStartDate = partial;
              console.log(`      📅 Using partial start date: ${effectiveStartDate.format('YYYY-MM-DD')}`);
            }
          } else {
            effectiveStartDate = tomorrow;
          }
        } else {
          if (scheduleStartDate.isSameOrBefore(today, 'day')) {
            effectiveStartDate = tomorrow;
            console.log(`      ⚠️ Schedule start <= today, using tomorrow: ${effectiveStartDate.format('YYYY-MM-DD')}`);
          } else {
            effectiveStartDate = scheduleStartDate;
            console.log(`      📅 Using schedule start date: ${effectiveStartDate.format('YYYY-MM-DD')}`);
          }
        }

        if (effectiveStartDate.isAfter(scheduleEndDate, 'day')) {
          console.log(`      ⚠️ Effective start > schedule end, skipping...`);
          results.push({
            roomId,
            status: 'no_changes',
            message: 'Lịch đã kết thúc'
          });
        } else {
          // Check which shifts are missing
          const shiftsToGenerate = [];
          for (const shiftKey of selectedShifts) {
            const shiftConfig = schedule.shiftConfig[shiftKey];
            if (!shiftConfig) {
              console.log(`      ⚠️ Shift ${shiftKey} not found in config`);
              continue;
            }

            if (shiftConfig.isActive === false) {
              console.log(`      ⚠️ Shift ${shiftKey} is disabled`);
              continue;
            }

            if (shiftConfig.isGenerated === true) {
              console.log(`      ℹ️ Shift ${shiftKey} already generated`);
              continue;
            }

            shiftsToGenerate.push({
              key: shiftKey,
              ...shiftConfig
            });
          }

          if (shiftsToGenerate.length === 0) {
            console.log(`      ℹ️ No shifts to generate`);
            results.push({
              roomId,
              status: 'no_changes',
              message: 'Không có ca thiếu cần tạo'
            });
          } else {
            console.log(`      ✅ Will generate ${shiftsToGenerate.length} shifts: ${shiftsToGenerate.map(s => s.key).join(', ')}`);

            // 🔧 Generate slots - Dùng generateSlotsForShift giống như generateRoomSchedule
            let totalSlotsForRoom = 0;
            
            for (const shift of shiftsToGenerate) {
              const shiftKey = shift.key;
              const shiftInfo = shift;
              
              // 🆕 Lấy slotDuration từ shiftConfig của schedule (không phải từ config chung)
              const shiftSlotDuration = shiftInfo.slotDuration || slotDuration;
              
              console.log(`      🔧 Generating slots for ${shiftKey}: ${shiftInfo.name}, slotDuration: ${shiftSlotDuration}min`);
              
              // Generate slots with holiday snapshot (same as generateRoomSchedule)
              const generatedSlots = await generateSlotsForShift({
                scheduleId: schedule._id,
                roomId: roomId,
                subRoomId: roomId, // Use roomId as subRoomId for rooms without subrooms
                shiftName: shiftInfo.name,
                shiftStart: shiftInfo.startTime,
                shiftEnd: shiftInfo.endTime,
                slotDuration: shiftSlotDuration, // 🆕 Dùng slotDuration riêng cho shift
                scheduleStartDate: effectiveStartDate.toDate(),
                scheduleEndDate: scheduleEndDate.toDate(),
                holidaySnapshot: schedule.holidaySnapshot // 🆕 Truyền holiday snapshot từ schedule
              });
              
              console.log(`      ✅ Generated ${generatedSlots.length} slots for ${shiftKey}`);
              totalSlotsForRoom += generatedSlots.length;
            }

            console.log(`      ✅ Total generated: ${totalSlotsForRoom} slots`);

            // Update shiftConfig
            for (const shift of shiftsToGenerate) {
              schedule.shiftConfig[shift.key].isGenerated = true;
            }
            schedule.updatedAt = new Date();
            await schedule.save();

            // Clear cache
            await redisClient.del(`schedule:${schedule._id}`);
            
            // 🆕 Emit event to update room hasBeenUsed (for rooms without subrooms)
            try {
              await publishToQueue('room.schedule.updated', {
                roomId: roomId.toString(),
                hasBeenUsed: true,
                lastScheduleGenerated: new Date()
              });
              console.log(`📤 Emitted room.schedule.updated event for room ${roomId}`);
            } catch (eventError) {
              console.error(`❌ Failed to emit room event:`, eventError.message);
            }

            totalAddedSlots += totalSlotsForRoom;
            results.push({
              roomId,
              status: 'success',
              addedSlots: totalSlotsForRoom,
              shifts: shiftsToGenerate.map(s => s.key)
            });
          }
        }
      }
    } else {
      // Normal case: Process each subroom
      for (const subRoomId of targetSubRoomIds) {
        console.log(`\n   🔄 Processing subRoomId: ${subRoomId}`);
        
        // Find schedule for this subroom + month + year
        const schedule = await scheduleRepo.findOne({
          roomId: roomId,
          subRoomId: subRoomId,
          month: month,
          year: year
        });

        if (!schedule) {
          console.log(`   ⚠️ No schedule found for subRoom ${subRoomId} in ${month}/${year}`);
          results.push({
            subRoomId,
            status: 'error',
            message: `Không tìm thấy lịch cho tháng ${month}/${year}`
          });
          continue;
        }

        console.log(`   ✅ Found schedule: ${schedule._id}`);

      // Determine start and end dates for THIS schedule
      const scheduleStartDate = dayjs(schedule.startDate);
      const scheduleEndDate = dayjs(schedule.endDate);
      
      let effectiveStartDate = scheduleStartDate;
      
      if (partialStartDate) {
        const partial = dayjs(partialStartDate);
        
        if (partial.isSameOrAfter(scheduleStartDate, 'day') && partial.isSameOrBefore(scheduleEndDate, 'day')) {
          if (partial.isSameOrBefore(today, 'day')) {
            effectiveStartDate = tomorrow;
            console.log(`      ⚠️ Partial date <= today, using tomorrow: ${effectiveStartDate.format('YYYY-MM-DD')}`);
          } else {
            effectiveStartDate = partial;
            console.log(`      📅 Using partial start date: ${effectiveStartDate.format('YYYY-MM-DD')}`);
          }
        } else {
          effectiveStartDate = tomorrow;
        }
      } else {
        if (scheduleStartDate.isSameOrBefore(today, 'day')) {
          effectiveStartDate = tomorrow;
          console.log(`      ⚠️ Schedule start <= today, using tomorrow: ${effectiveStartDate.format('YYYY-MM-DD')}`);
        } else {
          effectiveStartDate = scheduleStartDate;
          console.log(`      📅 Using schedule start date: ${effectiveStartDate.format('YYYY-MM-DD')}`);
        }
      }

      if (effectiveStartDate.isAfter(scheduleEndDate, 'day')) {
        console.log(`      ⚠️ Effective start > schedule end, skipping...`);
        results.push({
          subRoomId,
          status: 'no_changes',
          message: 'Lịch đã kết thúc'
        });
        continue;
      }

      // Check which shifts are missing
      const shiftsToGenerate = [];
      for (const shiftKey of selectedShifts) {
        const shiftConfig = schedule.shiftConfig[shiftKey];
        if (!shiftConfig) {
          console.log(`      ⚠️ Shift ${shiftKey} not found in config`);
          continue;
        }

        if (shiftConfig.isActive === false) {
          console.log(`      ⚠️ Shift ${shiftKey} is disabled`);
          continue;
        }

        if (shiftConfig.isGenerated === true) {
          console.log(`      ℹ️ Shift ${shiftKey} already generated`);
          continue;
        }

        shiftsToGenerate.push({
          key: shiftKey,
          ...shiftConfig
        });
      }

      if (shiftsToGenerate.length === 0) {
        console.log(`      ℹ️ No shifts to generate`);
        results.push({
          subRoomId,
          status: 'no_changes',
          message: 'Không có ca thiếu cần tạo'
        });
        continue;
      }

      console.log(`      ✅ Will generate ${shiftsToGenerate.length} shifts: ${shiftsToGenerate.map(s => s.key).join(', ')}`);

      // 🔧 Generate slots - Dùng generateSlotsForShift giống như generateRoomSchedule
      let totalSlotsForSubRoom = 0;
      
      for (const shift of shiftsToGenerate) {
        const shiftKey = shift.key;
        const shiftInfo = shift;
        
        // 🆕 Lấy slotDuration từ shiftConfig của schedule (không phải từ config chung)
        const shiftSlotDuration = shiftInfo.slotDuration || slotDuration;
        
        console.log(`      🔧 Generating slots for ${shiftKey}: ${shiftInfo.name}, slotDuration: ${shiftSlotDuration}min`);
        
        // Generate slots with holiday snapshot (same as generateRoomSchedule)
        const generatedSlots = await generateSlotsForShift({
          scheduleId: schedule._id,
          roomId: roomId,
          subRoomId: subRoomId,
          shiftName: shiftInfo.name,
          shiftStart: shiftInfo.startTime,
          shiftEnd: shiftInfo.endTime,
          slotDuration: shiftSlotDuration, // 🆕 Dùng slotDuration riêng cho shift
          scheduleStartDate: effectiveStartDate.toDate(),
          scheduleEndDate: scheduleEndDate.toDate(),
          holidaySnapshot: schedule.holidaySnapshot // 🆕 Truyền holiday snapshot từ schedule
        });
        
        console.log(`      ✅ Generated ${generatedSlots.length} slots for ${shiftKey}`);
        totalSlotsForSubRoom += generatedSlots.length;
      }

      console.log(`      ✅ Total generated: ${totalSlotsForSubRoom} slots`);

      // Update shiftConfig
      for (const shift of shiftsToGenerate) {
        schedule.shiftConfig[shift.key].isGenerated = true;
      }
      schedule.updatedAt = new Date();
      await schedule.save();

      // Clear cache
      await redisClient.del(`schedule:${schedule._id}`);
      
      // 🆕 Emit event to update subroom hasBeenUsed
      try {
        await publishToQueue('subroom.schedule.created', {
          type: 'SUBROOM_USED',
          roomId: roomId.toString(),
          subRoomIds: [subRoomId.toString()],
          hasBeenUsed: true,
          timestamp: new Date()
        });
        console.log(`📤 Emitted subroom.schedule.created event for subRoom ${subRoomId}`);
      } catch (eventError) {
        console.error(`❌ Failed to emit subroom event:`, eventError.message);
      }

      totalAddedSlots += totalSlotsForSubRoom;
      results.push({
        subRoomId,
        status: 'success',
        addedSlots: totalSlotsForSubRoom,
        shifts: shiftsToGenerate.map(s => s.key)
      });
      } // End of for loop
    } // End of else block (processing subrooms)

    console.log(`\n✅ [addMissingShifts] Completed: ${totalAddedSlots} total slots added`);

    return {
      success: true,
      message: `Đã thêm ${totalAddedSlots} slots cho ${selectedShifts.length} ca`,
      results,
      totalAddedSlots
    };

  } catch (error) {
    console.error('❌ [addMissingShifts] Error:', error);
    throw error;
  }
};

module.exports.addMissingShifts = exports.addMissingShifts;

// 🆕 Get holiday preview for schedule creation (trả về danh sách ngày nghỉ sẽ áp dụng)
exports.getHolidayPreview = async (startDate, endDate) => {
  try {
    const snapshot = await getHolidaySnapshot(startDate, endDate);
    
    // Format recurring holidays
    const dayOfWeekNames = {
      1: 'Chủ nhật',
      2: 'Thứ 2',
      3: 'Thứ 3',
      4: 'Thứ 4',
      5: 'Thứ 5',
      6: 'Thứ 6',
      7: 'Thứ 7'
    };
    
    const recurringHolidays = snapshot.recurringHolidays.map(h => ({
      ...h,
      dayOfWeekName: dayOfWeekNames[h.dayOfWeek] || 'Không xác định'
    }));
    
    return {
      recurringHolidays,
      nonRecurringHolidays: snapshot.nonRecurringHolidays,
      hasRecurringHolidays: recurringHolidays.length > 0,
      hasNonRecurringHolidays: snapshot.nonRecurringHolidays.length > 0
    };
  } catch (error) {
    console.error('❌ Error getting holiday preview:', error);
    throw error;
  }
};

module.exports.getHolidayPreview = exports.getHolidayPreview;

// 🆕 Helper: Generate additional shifts for existing schedule (use OLD config)
async function generateAdditionalShifts({
  existingSchedule,
  shiftsToGenerate,
  scheduleStartDate,
  scheduleEndDate
}) {
  let totalSlots = 0;
  const slotsByShift = {};
  
  for (const shiftKey of shiftsToGenerate) {
    const shiftInfo = existingSchedule.shiftConfig[shiftKey];
    
    if (!shiftInfo.isActive) {
      console.warn(`⚠️ Shift ${shiftKey} is not active, skipping`);
      continue;
    }
    
    // Generate slots using OLD config
    const generatedSlots = await generateSlotsForShift({
      scheduleId: existingSchedule._id,
      roomId: existingSchedule.roomId,
      subRoomId: existingSchedule.subRoomId,
      shiftName: shiftInfo.name,
      shiftStart: shiftInfo.startTime,
      shiftEnd: shiftInfo.endTime,
      slotDuration: shiftInfo.slotDuration,
      scheduleStartDate,
      scheduleEndDate
    });
    
    slotsByShift[shiftKey] = generatedSlots.length;
    totalSlots += generatedSlots.length;
    
    // Update schedule
    existingSchedule.shiftConfig[shiftKey].isGenerated = true;
    existingSchedule.staffAssignment[shiftKey].total += generatedSlots.length;
  }
  
  await existingSchedule.save();
  
  return {
    schedule: existingSchedule,
    stats: {
      totalSlots,
      slotsByShift,
      shiftsGenerated: shiftsToGenerate,
      isAdditional: true
    }
  };
}

// Helper: Generate slots for a specific shift
async function generateSlotsForShift({
  scheduleId,
  roomId,
  subRoomId,
  shiftName,
  shiftStart,
  shiftEnd,
  slotDuration,
  scheduleStartDate,
  scheduleEndDate,
  holidaySnapshot // 🆕 Nhận holiday snapshot
}) {
  if (!shiftStart || !shiftEnd) {
    throw new Error(`generateSlotsForShift requires shiftStart and shiftEnd (shift: ${shiftName || 'unknown'})`);
  }

  if (!scheduleStartDate || !scheduleEndDate) {
    throw new Error(`generateSlotsForShift requires scheduleStartDate and scheduleEndDate (shift: ${shiftName || 'unknown'})`);
  }

  console.log(`📅 generateSlotsForShift - Shift: ${shiftName}, Start: ${shiftStart}, End: ${shiftEnd}, Duration: ${slotDuration}min`);
  console.log(`📅 Date range: ${scheduleStartDate.toISOString()} to ${scheduleEndDate.toISOString()}`);
  console.log(`📅 Holiday snapshot:`, holidaySnapshot);

  const slots = [];
  const currentDate = new Date(scheduleStartDate);
  const endDate = new Date(scheduleEndDate);
  
  let skippedDays = 0;
  let processedDays = 0;
  
  while (currentDate <= endDate) {
    processedDays++;
    
    // 🆕 Kiểm tra holiday - bỏ qua ngày nghỉ
    const isHolidayDay = holidaySnapshot 
      ? isHolidayFromSnapshot(currentDate, holidaySnapshot)
      : false;
    
    if (isHolidayDay) {
      skippedDays++;
      console.log(`⏭️  Skipping holiday: ${currentDate.toISOString().split('T')[0]}`);
      currentDate.setDate(currentDate.getDate() + 1);
      continue; // Bỏ qua ngày nghỉ, không tạo slot
    }
    
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;
    const day = currentDate.getDate();
    
    // Parse shift times (format: "HH:mm")
    const [startHour, startMin] = shiftStart.split(':').map(Number);
    const [endHour, endMin] = shiftEnd.split(':').map(Number);
    
    let slotStartTime = new Date(Date.UTC(year, month - 1, day, startHour - 7, startMin, 0, 0));
    const shiftEndTime = new Date(Date.UTC(year, month - 1, day, endHour - 7, endMin, 0, 0));
    
    let slotCount = 0;
    
    // Generate slots within the shift
    while (slotStartTime < shiftEndTime) {
      const slotEndTime = new Date(slotStartTime.getTime() + slotDuration * 60 * 1000);
      
      if (slotEndTime > shiftEndTime) break; // Don't exceed shift end time
      
      slots.push({
        scheduleId,
        roomId,
        subRoomId: subRoomId || null,
        shiftName,
        startTime: new Date(slotStartTime),
        endTime: new Date(slotEndTime),
        date: new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0)), // Midnight VN time
        duration: slotDuration,
        isAvailable: true,
        isBooked: false
      });
      
      slotCount++;
      slotStartTime = slotEndTime;
    }
    
    if (processedDays === 1) {
      console.log(`📊 First day (${currentDate.toISOString().split('T')[0]}): Generated ${slotCount} slots`);
    }
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Log thông tin skip
  console.log(`📊 Summary - Processed: ${processedDays} days, Skipped holidays: ${skippedDays}, Total slots: ${slots.length}`);
  
  if (skippedDays > 0) {
    console.log(`⏭️  Skipped ${skippedDays} holiday(s) for shift ${shiftName}`);
  }
  
  // Bulk insert slots
  if (slots.length > 0) {
    await slotRepo.insertMany(slots);
    console.log(`✅ Inserted ${slots.length} slots for shift ${shiftName}`);
  } else {
    console.warn(`⚠️  No slots generated for shift ${shiftName}`);
  }
  
  return slots;
}

// 🆕 GET SCHEDULE SUMMARY BY ROOM (for staff assignment page)
exports.getScheduleSummaryByRoom = async (roomId, quarter, year) => {
  try {
    const filter = { roomId, isActive: true };
    
    if (quarter && year) {
      filter.quarter = parseInt(quarter);
      filter.year = parseInt(year);
    }
    
    const schedules = await scheduleRepo.find(filter).sort({ quarter: -1, year: -1 });
    
    // Group by quarter/year
    const summary = schedules.reduce((acc, schedule) => {
      const key = `Q${schedule.quarter}/${schedule.year}`;
      
      if (!acc[key]) {
        acc[key] = {
          quarter: schedule.quarter,
          year: schedule.year,
          dateRange: {
            start: schedule.startDate,
            end: schedule.endDate
          },
          shifts: [],
          totalSlots: 0,
          totalAssigned: 0
        };
      }
      
      // Add shift info
      ['morning', 'afternoon', 'evening'].forEach(shiftKey => {
        if (schedule.shiftConfig[shiftKey].isGenerated) {
          acc[key].shifts.push({
            name: schedule.shiftConfig[shiftKey].name,
            assigned: schedule.staffAssignment[shiftKey].assigned,
            total: schedule.staffAssignment[shiftKey].total,
            percentage: schedule.staffAssignment[shiftKey].total > 0 
              ? Math.round((schedule.staffAssignment[shiftKey].assigned / schedule.staffAssignment[shiftKey].total) * 100)
              : 0
          });
          
          acc[key].totalSlots += schedule.staffAssignment[shiftKey].total;
          acc[key].totalAssigned += schedule.staffAssignment[shiftKey].assigned;
        }
      });
      
      return acc;
    }, {});
    
    return Object.values(summary);
  } catch (error) {
    console.error('❌ Error getting schedule summary:', error);
    throw error;
  }
};

// 🆕 GET ROOMS WITH SCHEDULE SUMMARY (for staff assignment room list)
exports.getRoomsWithScheduleSummary = async ({ quarter, year, isActive }) => {
  try {
    // This would typically make an HTTP call to room-service to get rooms
    // For now, we'll aggregate from schedules
    
    const filter = {};
    if (quarter) filter.quarter = parseInt(quarter);
    if (year) filter.year = parseInt(year);
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    const schedules = await scheduleRepo.find(filter)
      .populate('roomId', 'name roomNumber isActive')
      .sort({ roomId: 1, quarter: -1, year: -1 });
    
    // Group by roomId
    const roomMap = {};
    
    schedules.forEach(schedule => {
      const roomId = schedule.roomId._id.toString();
      
      if (!roomMap[roomId]) {
        roomMap[roomId] = {
          roomId: schedule.roomId._id,
          roomName: schedule.roomId.name,
          roomNumber: schedule.roomId.roomNumber,
          isActive: schedule.roomId.isActive,
          quarters: []
        };
      }
      
      const quarterKey = `Q${schedule.quarter}/${schedule.year}`;
      const existingQuarter = roomMap[roomId].quarters.find(q => q.quarter === quarterKey);
      
      if (!existingQuarter) {
        let totalSlots = 0;
        let totalAssigned = 0;
        
        ['morning', 'afternoon', 'evening'].forEach(shiftKey => {
          if (schedule.shiftConfig[shiftKey].isGenerated) {
            totalSlots += schedule.staffAssignment[shiftKey].total;
            totalAssigned += schedule.staffAssignment[shiftKey].assigned;
          }
        });
        
        roomMap[roomId].quarters.push({
          quarter: quarterKey,
          quarterNum: schedule.quarter,
          year: schedule.year,
          totalSlots,
          totalAssigned,
          percentage: totalSlots > 0 ? Math.round((totalAssigned / totalSlots) * 100) : 0,
          dateRange: {
            start: schedule.startDate,
            end: schedule.endDate
          }
        });
      }
    });
    
    return Object.values(roomMap);
  } catch (error) {
    console.error('❌ Error getting rooms with schedule summary:', error);
    throw error;
  }
};

// 🆕 GET SLOTS BY SHIFT FOR CALENDAR VIEW (monthly)
exports.getSlotsByShiftCalendar = async ({ roomId, subRoomId, shiftName, month, year }) => {
  try {
    // Calculate month date range
    const monthStart = new Date(Date.UTC(year, month - 1, 1, -7, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 16, 59, 59, 999)); // Last day 23:59 VN
    
    // Find schedule for this quarter
    const quarter = Math.ceil(month / 3);
    const schedule = await scheduleRepo.findOne({
      roomId,
      subRoomId: subRoomId || null,
      quarter,
      year
    });
    
    if (!schedule) {
      return {
        month,
        year,
        shiftName,
        days: [],
        message: `Chưa có lịch cho Q${quarter}/${year}`
      };
    }
    
    // Get all slots for this shift in the month
    const slots = await slotRepo.find({
      scheduleId: schedule._id,
      shiftName,
      date: { $gte: monthStart, $lte: monthEnd }
    }).sort({ date: 1, startTime: 1 });
    
    // Group slots by date
    const dayMap = {};
    
    slots.forEach(slot => {
      const dateKey = toVNDateOnlyString(slot.date);
      
      if (!dayMap[dateKey]) {
        dayMap[dateKey] = {
          date: slot.date,
          dateStr: dateKey,
          slots: [],
          totalSlots: 0,
          bookedSlots: 0,
          assignedSlots: 0
        };
      }
      
      dayMap[dateKey].slots.push({
        _id: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        duration: slot.duration,
        isAvailable: slot.isAvailable,
        isBooked: slot.isBooked,
        assignedTo: slot.assignedTo || null
      });
      
      dayMap[dateKey].totalSlots++;
      if (slot.isBooked) dayMap[dateKey].bookedSlots++;
      if (slot.assignedTo) dayMap[dateKey].assignedSlots++;
    });
    
    return {
      month,
      year,
      quarter,
      shiftName,
      schedule: {
        _id: schedule._id,
        startDate: schedule.startDate,
        endDate: schedule.endDate
      },
      days: Object.values(dayMap).sort((a, b) => new Date(a.date) - new Date(b.date))
    };
    
    
  } catch (error) {
    console.error('❌ Error getting slots by shift calendar:', error);
    throw error;
  }
};

// 🆕 GET ROOMS WITH SHIFT SUMMARY (for staff assignment main page)
exports.getRoomsForStaffAssignment = async ({ fromMonth, toMonth, year, isActive }) => {
  try {
    // Build filter for month range
    const filter = { 
      year,
      month: { $gte: fromMonth, $lte: toMonth }
    };
    if (isActive !== undefined) filter.isActive = isActive;
    
    const schedules = await scheduleRepo.find(filter)
      .populate('roomId', 'name roomNumber isActive')
      .sort({ roomId: 1, month: 1 });
    
    // Group by room (aggregate across all months)
    const roomMap = {};
    
    schedules.forEach(schedule => {
      const roomKey = schedule.roomId._id.toString() + (schedule.subRoomId ? `-${schedule.subRoomId}` : '');
      
      if (!roomMap[roomKey]) {
        roomMap[roomKey] = {
          roomId: schedule.roomId._id,
          roomName: schedule.roomId.name,
          roomNumber: schedule.roomId.roomNumber,
          subRoomId: schedule.subRoomId,
          subRoomName: schedule.subRoomId ? `Buồng ${schedule.subRoomId}` : null,
          isActive: schedule.roomId.isActive,
          fromMonth,
          toMonth,
          year,
          shifts: {
            morning: { assigned: 0, total: 0, isGenerated: false },
            afternoon: { assigned: 0, total: 0, isGenerated: false },
            evening: { assigned: 0, total: 0, isGenerated: false }
          }
        };
      }
      
      // Aggregate shift data across months
      ['morning', 'afternoon', 'evening'].forEach(shiftKey => {
        if (schedule.shiftConfig[shiftKey].isGenerated) {
          roomMap[roomKey].shifts[shiftKey].isGenerated = true;
          roomMap[roomKey].shifts[shiftKey].assigned += schedule.staffAssignment[shiftKey].assigned;
          roomMap[roomKey].shifts[shiftKey].total += schedule.staffAssignment[shiftKey].total;
          
          // Store shift config (from first schedule)
          if (!roomMap[roomKey].shifts[shiftKey].name) {
            roomMap[roomKey].shifts[shiftKey].name = schedule.shiftConfig[shiftKey].name;
            roomMap[roomKey].shifts[shiftKey].startTime = schedule.shiftConfig[shiftKey].startTime;
            roomMap[roomKey].shifts[shiftKey].endTime = schedule.shiftConfig[shiftKey].endTime;
          }
        }
      });
    });
    
    // Format response
    const result = Object.values(roomMap).map(room => ({
      roomId: room.roomId,
      roomName: room.roomName,
      roomNumber: room.roomNumber,
      subRoomId: room.subRoomId,
      subRoomName: room.subRoomName,
      isActive: room.isActive,
      fromMonth: room.fromMonth,
      toMonth: room.toMonth,
      year: room.year,
      shifts: Object.entries(room.shifts)
        .filter(([key, data]) => data.isGenerated)
        .map(([shiftKey, data]) => ({
          shiftKey,
          shiftName: data.name,
          timeRange: `${data.startTime} - ${data.endTime}`,
          assigned: data.assigned,
          total: data.total,
          percentage: data.total > 0 ? Math.round((data.assigned / data.total) * 100) : 0,
          isFullyAssigned: data.assigned === data.total && data.total > 0
        }))
    }));
    
    return result;
  } catch (error) {
    console.error('❌ Error getting rooms for staff assignment:', error);
    throw error;
  }
};

// 🆕 GET SHIFT CALENDAR FOR ASSIGNMENT (monthly view with assignment status)
exports.getShiftCalendarForAssignment = async ({ roomId, subRoomId, shiftName, month, year }) => {
  try {
    // Find schedule
    const schedule = await scheduleRepo.findOne({
      roomId,
      subRoomId: subRoomId || null,
      month,
      year
    });
    
    if (!schedule) {
      throw new Error(`Không tìm thấy lịch cho tháng ${month}/${year}`);
    }
    
    // Get shift config
    const shiftKey = shiftName === 'Ca Sáng' ? 'morning' : shiftName === 'Ca Chiều' ? 'afternoon' : 'evening';
    const shiftConfig = schedule.shiftConfig[shiftKey];
    
    if (!shiftConfig.isGenerated) {
      throw new Error(`Ca ${shiftName} chưa được tạo lịch`);
    }
    
    // Calculate month date range
    const monthStart = new Date(Date.UTC(year, month - 1, 1, -7, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 16, 59, 59, 999));
    
    // Get all slots for this shift
    const slots = await slotRepo.find({
      scheduleId: schedule._id,
      shiftName,
      date: { $gte: monthStart, $lte: monthEnd }
    })
    .populate('dentist', 'firstName lastName email role')
    .populate('nurse', 'firstName lastName email role')
    .sort({ date: 1, startTime: 1 });
    
    // Group by date
    const dayMap = {};
    
    slots.forEach(slot => {
      const dateKey = toVNDateOnlyString(slot.date);
      
      if (!dayMap[dateKey]) {
        dayMap[dateKey] = {
          date: slot.date,
          dateStr: dateKey,
          dayOfWeek: new Date(slot.date).getDay(),
          slots: [],
          totalSlots: 0,
          assignedSlots: 0,
          unassignedSlots: 0
        };
      }
      
      const isAssigned = slot.dentist || slot.nurse;
      
      dayMap[dateKey].slots.push({
        _id: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        duration: slot.duration,
        isAvailable: slot.isAvailable,
        isBooked: slot.isBooked,
        dentist: slot.dentist ? {
          _id: slot.dentist._id,
          name: `${slot.dentist.firstName} ${slot.dentist.lastName}`,
          email: slot.dentist.email
        } : null,
        nurse: slot.nurse ? {
          _id: slot.nurse._id,
          name: `${slot.nurse.firstName} ${slot.nurse.lastName}`,
          email: slot.nurse.email
        } : null,
        isAssigned
      });
      
      dayMap[dateKey].totalSlots++;
      if (isAssigned) {
        dayMap[dateKey].assignedSlots++;
      } else {
        dayMap[dateKey].unassignedSlots++;
      }
    });
    
    return {
      roomId,
      subRoomId,
      month,
      year,
      shiftName,
      shiftConfig,
      schedule: {
        _id: schedule._id,
        startDate: schedule.startDate,
        endDate: schedule.endDate
      },
      days: Object.values(dayMap).sort((a, b) => new Date(a.date) - new Date(b.date)),
      summary: {
        totalSlots: slots.length,
        assignedSlots: slots.filter(s => s.dentist || s.nurse).length,
        unassignedSlots: slots.filter(s => !s.dentist && !s.nurse).length,
        percentage: slots.length > 0 
          ? Math.round((slots.filter(s => s.dentist || s.nurse).length / slots.length) * 100)
          : 0
      }
    };
    
  } catch (error) {
    console.error('❌ Error getting shift calendar for assignment:', error);
    throw error;
  }
};

// 🆕 GET SLOTS FOR A SPECIFIC DAY AND SHIFT
exports.getSlotsByDayAndShift = async ({ roomId, subRoomId, shiftName, date }) => {
  try {
    const targetDate = new Date(date);
    const dayStart = new Date(Date.UTC(
      targetDate.getFullYear(), 
      targetDate.getMonth(), 
      targetDate.getDate(), 
      -7, 0, 0, 0
    ));
    const dayEnd = new Date(Date.UTC(
      targetDate.getFullYear(), 
      targetDate.getMonth(), 
      targetDate.getDate(), 
      16, 59, 59, 999
    ));
    
    const slots = await slotRepo.find({
      roomId,
      subRoomId: subRoomId || null,
      shiftName,
      date: { $gte: dayStart, $lte: dayEnd }
    })
    .populate('dentist', 'firstName lastName email role')
    .populate('nurse', 'firstName lastName email role')
    .sort({ startTime: 1 });
    
    return slots.map(slot => ({
      _id: slot._id,
      startTime: slot.startTime,
      endTime: slot.endTime,
      duration: slot.duration,
      isAvailable: slot.isAvailable,
      isBooked: slot.isBooked,
      dentist: slot.dentist ? {
        _id: slot.dentist._id,
        name: `${slot.dentist.firstName} ${slot.dentist.lastName}`,
        email: slot.dentist.email
      } : null,
      nurse: slot.nurse ? {
        _id: slot.nurse._id,
        name: `${slot.nurse.firstName} ${slot.nurse.lastName}`,
        email: slot.nurse.email
      } : null,
      isAssigned: !!(slot.dentist || slot.nurse)
    }));
    
  } catch (error) {
    console.error('❌ Error getting slots by day and shift:', error);
    throw error;
  }
};

// 🆕 ASSIGN STAFF TO SLOT
exports.assignStaffToSlot = async ({ slotId, dentistId, nurseId, updatedBy }) => {
  try {
    const slot = await slotRepo.findById(slotId);
    if (!slot) {
      throw new Error('Không tìm thấy slot');
    }
    
    // Check if slot is in the past
    const now = new Date();
    if (slot.startTime < now) {
      throw new Error('Không thể phân công cho slot trong quá khứ');
    }
    
    // Check if slot is already booked
    if (slot.isBooked) {
      throw new Error('Slot đã được đặt, không thể thay đổi phân công');
    }
    
    // Update slot
    const oldDentist = slot.dentist;
    const oldNurse = slot.nurse;
    
    if (dentistId !== undefined) {
      slot.dentist = dentistId || null;
    }
    if (nurseId !== undefined) {
      slot.nurse = nurseId || null;
    }
    
    await slot.save();
    
    // Update schedule staffAssignment count
    const schedule = await scheduleRepo.findById(slot.scheduleId);
    if (schedule) {
      const shiftKey = slot.shiftName === 'Ca Sáng' ? 'morning' 
                     : slot.shiftName === 'Ca Chiều' ? 'afternoon' 
                     : 'evening';
      
      // Recalculate assigned count
      const assignedCount = await slotRepo.countDocuments({
        scheduleId: schedule._id,
        shiftName: slot.shiftName,
        $or: [
          { dentist: { $ne: null } },
          { nurse: { $ne: null } }
        ]
      });
      
      schedule.staffAssignment[shiftKey].assigned = assignedCount;
      await schedule.save();
    }
    
    return {
      slot: await slotRepo.findById(slotId)
        .populate('dentist', 'firstName lastName email')
        .populate('nurse', 'firstName lastName email'),
      wasAssigned: !!(oldDentist || oldNurse),
      isNowAssigned: !!(slot.dentist || slot.nurse)
    };
    
  } catch (error) {
    console.error('❌ Error assigning staff to slot:', error);
    throw error;
  }
};

// 🆕 BULK ASSIGN STAFF TO MULTIPLE SLOTS
exports.bulkAssignStaff = async ({ slotIds, dentistId, nurseId, updatedBy }) => {
  try {
    const results = {
      success: [],
      failed: []
    };
    
    for (const slotId of slotIds) {
      try {
        const result = await exports.assignStaffToSlot({
          slotId,
          dentistId,
          nurseId,
          updatedBy
        });
        results.success.push({ slotId, ...result });
      } catch (error) {
        results.failed.push({ slotId, error: error.message });
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Error bulk assigning staff:', error);
    throw error;
  }
};

// 🆕 API 1: GET ROOM SCHEDULE SHIFTS (Lấy danh sách ca đã có lịch của phòng)
exports.getRoomScheduleShifts = async ({ roomId, subRoomId, month, year }) => {
  try {
    const schedule = await scheduleRepo.findOne({
      roomId,
      subRoomId: subRoomId || null,
      month,
      year
    });
    
    if (!schedule) {
      return { shifts: [] };
    }
    
    const shifts = [];
    
    // Duyệt qua 3 ca
    ['morning', 'afternoon', 'evening'].forEach(shiftKey => {
      const shiftConfig = schedule.shiftConfig[shiftKey];
      
      // Chỉ lấy ca đã được tạo lịch
      if (shiftConfig.isGenerated) {
        shifts.push({
          shiftKey,
          shiftName: shiftConfig.name,
          startTime: shiftConfig.startTime,
          endTime: shiftConfig.endTime,
          timeRange: `${shiftConfig.startTime} - ${shiftConfig.endTime}`,
          slotDuration: shiftConfig.slotDuration,
          assigned: schedule.staffAssignment[shiftKey].assigned,
          total: schedule.staffAssignment[shiftKey].total,
          percentage: schedule.staffAssignment[shiftKey].total > 0 
            ? Math.round((schedule.staffAssignment[shiftKey].assigned / schedule.staffAssignment[shiftKey].total) * 100)
            : 0
        });
      }
    });
    
    return { shifts };
    
  } catch (error) {
    console.error('❌ Error getting room schedule shifts:', error);
    throw error;
  }
};

// 🆕 API 2: GET STAFF AVAILABILITY WITH CONFLICTS (Lấy nhân sư + kiểm tra trùng lịch)
exports.getStaffAvailabilityForShift = async ({ roomId, subRoomId, shiftName, month, year }) => {
  try {
    // 1. Lấy schedule của phòng
    const schedule = await scheduleRepo.findOne({
      roomId,
      subRoomId: subRoomId || null,
      month,
      year
    });
    
    if (!schedule) {
      throw new Error(`Không tìm thấy lịch cho phòng trong tháng ${month}/${year}`);
    }
    
    // 2. Lấy tất cả staff (dentist + nurse) đang active
    const User = require('../models/user.model');
    const staff = await User.find({ 
      role: { $in: ['dentist', 'nurse'] }, 
      isActive: true 
    }).select('firstName lastName email role');
    
    // 3. Tính date range của tháng
    const monthStart = new Date(Date.UTC(year, month - 1, 1, -7, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 16, 59, 59, 999));
    
    // 4. Lấy tất cả slots của ca này trong tháng (populate scheduleId để compare)
    const targetSlots = await slotRepo.find({
      scheduleId: schedule._id,
      shiftName,
      date: { $gte: monthStart, $lte: monthEnd }
    }).populate('scheduleId').sort({ date: 1, startTime: 1 });
    
    // 5. Cho mỗi staff, check conflict với target slots
    const staffWithConflicts = await Promise.all(staff.map(async (s) => {
      const conflicts = [];
      
      // Duyệt qua từng target slot để check conflict
      for (const targetSlot of targetSlots) {
        // Tìm các slot mà staff này đã được assign và trùng thời gian
        const conflictSlots = await slotRepo.find({
          $or: [
            { dentist: s._id },
            { nurse: s._id }
          ],
          date: targetSlot.date,
          // Check overlap thời gian
          $or: [
            // Target slot bắt đầu trong khoảng existing slot
            { 
              startTime: { $lte: targetSlot.startTime },
              endTime: { $gt: targetSlot.startTime }
            },
            // Target slot kết thúc trong khoảng existing slot
            { 
              startTime: { $lt: targetSlot.endTime },
              endTime: { $gte: targetSlot.endTime }
            },
            // Existing slot nằm hoàn toàn trong target slot
            { 
              startTime: { $gte: targetSlot.startTime },
              endTime: { $lte: targetSlot.endTime }
            }
          ]
        }).populate({
          path: 'scheduleId',
          populate: { path: 'roomId', select: 'name' }
        });
        
        // ⭐ Thêm conflict vào list - NHƯNG loại trừ nếu cùng room/subroom/slot
        conflictSlots.forEach(cs => {
          // Bỏ qua nếu conflict slot chính là target slot (cùng _id)
          if (cs._id.toString() === targetSlot._id.toString()) {
            return;
          }
          
          // Bỏ qua nếu conflict slot cùng scheduleId (tức cùng room + subroom)
          // => Phân công lại trong cùng phòng không tính là conflict
          if (cs.scheduleId?._id?.toString() === targetSlot.scheduleId?.toString()) {
            return;
          }
          
          if (cs.scheduleId && cs.scheduleId.roomId) {
            conflicts.push({
              slotId: cs._id,
              date: toVNDateOnlyString(cs.date),
              shiftName: cs.shiftName,
              startTime: cs.startTime,
              endTime: cs.endTime,
              roomName: cs.scheduleId.roomId.name,
              assignedAs: cs.dentist?.toString() === s._id.toString() ? 'dentist' : 'nurse'
            });
          }
        });
      }
      
      // Remove duplicates
      const uniqueConflicts = conflicts.filter((conflict, index, self) =>
        index === self.findIndex((c) => c.slotId.toString() === conflict.slotId.toString())
      );
      
      return {
        _id: s._id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        role: s.role,
        conflicts: uniqueConflicts
      };
    }));
    
    return { staff: staffWithConflicts };
    
  } catch (error) {
    console.error('❌ Error getting staff availability:', error);
    throw error;
  }
};

// 🆕 API 4: GET AVAILABLE REPLACEMENT STAFF (Lấy nhân sự thay thế + conflict checking)
exports.getAvailableReplacementStaff = async ({ originalStaffId, role, slots, fromDate }) => {
  try {
    // 1. Lấy tất cả staff cùng role (trừ original staff)
    const User = require('../models/user.model');
    const staff = await User.find({ 
      role,
      isActive: true,
      _id: { $ne: originalStaffId }
    }).select('firstName lastName email role');
    
    let targetSlots = [];
    
    // 2. Xác định slots cần check conflict (populate scheduleId để compare)
    if (slots && slots.length > 0) {
      // Trường hợp: Thay thế các slot cụ thể
      targetSlots = await slotRepo.find({
        _id: { $in: slots }
      }).populate('scheduleId').sort({ date: 1, startTime: 1 });
    } else if (fromDate) {
      // Trường hợp: Thay thế tất cả từ ngày X
      const startDate = new Date(fromDate);
      targetSlots = await slotRepo.find({
        $or: [
          { dentist: originalStaffId },
          { nurse: originalStaffId }
        ],
        date: { $gte: startDate }
      }).populate('scheduleId').sort({ date: 1, startTime: 1 });
    }
    
    // 3. Cho mỗi replacement staff, check conflict
    const staffWithConflicts = await Promise.all(staff.map(async (s) => {
      const conflicts = [];
      
      // Check conflict với từng target slot
      for (const targetSlot of targetSlots) {
        const conflictSlots = await slotRepo.find({
          $or: [
            { dentist: s._id },
            { nurse: s._id }
          ],
          date: targetSlot.date,
          // Check overlap thời gian
          $or: [
            { 
              startTime: { $lte: targetSlot.startTime },
              endTime: { $gt: targetSlot.startTime }
            },
            { 
              startTime: { $lt: targetSlot.endTime },
              endTime: { $gte: targetSlot.endTime }
            },
            { 
              startTime: { $gte: targetSlot.startTime },
              endTime: { $lte: targetSlot.endTime }
            }
          ]
        }).populate({
          path: 'scheduleId',
          populate: { path: 'roomId', select: 'name' }
        });
        
        // ⭐ Thêm conflict vào list - NHƯNG loại trừ nếu cùng room/subroom/slot
        conflictSlots.forEach(cs => {
          // Bỏ qua nếu conflict slot chính là target slot (cùng _id)
          if (cs._id.toString() === targetSlot._id.toString()) {
            return;
          }
          
          // Bỏ qua nếu conflict slot cùng scheduleId (tức cùng room + subroom)
          // => Phân công lại trong cùng phòng không tính là conflict
          if (cs.scheduleId?._id?.toString() === targetSlot.scheduleId?.toString()) {
            return;
          }
          
          if (cs.scheduleId && cs.scheduleId.roomId) {
            conflicts.push({
              slotId: cs._id,
              targetSlotId: targetSlot._id,
              date: toVNDateOnlyString(cs.date),
              shiftName: cs.shiftName,
              startTime: cs.startTime,
              endTime: cs.endTime,
              roomName: cs.scheduleId.roomId.name
            });
          }
        });
      }
      
      // Remove duplicates
      const uniqueConflicts = conflicts.filter((conflict, index, self) =>
        index === self.findIndex((c) => c.slotId.toString() === conflict.slotId.toString())
      );
      
      return {
        _id: s._id,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        role: s.role,
        conflictCount: uniqueConflicts.length,
        conflicts: uniqueConflicts
      };
    }));
    
    // Sắp xếp: Ưu tiên staff không có conflict
    staffWithConflicts.sort((a, b) => a.conflictCount - b.conflictCount);
    
    return { 
      staff: staffWithConflicts,
      targetSlotCount: targetSlots.length
    };
    
  } catch (error) {
    console.error('❌ Error getting replacement staff:', error);
    throw error;
  }
};

// 🆕 API 5: REPLACE STAFF (Thực hiện thay thế nhân sự)
exports.replaceStaff = async ({ originalStaffId, replacementStaffId, slots, fromDate, replaceAll }) => {
  try {
    let updatedCount = 0;
    const updatedSlots = [];
    
    if (replaceAll && fromDate) {
      // Trường hợp: Thay thế TẤT CẢ từ ngày X
      const startDate = new Date(fromDate);
      
      // Tìm tất cả slots của original staff từ ngày X
      const slotsToReplace = await slotRepo.find({
        $or: [
          { dentist: originalStaffId },
          { nurse: originalStaffId }
        ],
        date: { $gte: startDate }
      });
      
      // Update từng slot
      for (const slot of slotsToReplace) {
        const wasDentist = slot.dentist?.toString() === originalStaffId.toString();
        const wasNurse = slot.nurse?.toString() === originalStaffId.toString();
        
        if (wasDentist) {
          slot.dentist = replacementStaffId;
        }
        if (wasNurse) {
          slot.nurse = replacementStaffId;
        }
        
        await slot.save();
        updatedCount++;
        updatedSlots.push(slot._id);
      }
      
    } else if (slots && slots.length > 0) {
      // Trường hợp: Thay thế các slot cụ thể
      for (const slotId of slots) {
        const slot = await slotRepo.findById(slotId);
        
        if (!slot) continue;
        
        const wasDentist = slot.dentist?.toString() === originalStaffId.toString();
        const wasNurse = slot.nurse?.toString() === originalStaffId.toString();
        
        if (wasDentist) {
          slot.dentist = replacementStaffId;
        }
        if (wasNurse) {
          slot.nurse = replacementStaffId;
        }
        
        await slot.save();
        updatedCount++;
        updatedSlots.push(slot._id);
      }
    }
    
    // Update staffAssignment counts trong schedules liên quan
    const affectedSchedules = await Schedule.find({
      _id: { 
        $in: await slotRepo.distinct('scheduleId', { _id: { $in: updatedSlots } })
      }
    });
    
    for (const schedule of affectedSchedules) {
      // Recalculate assigned counts cho từng ca
      for (const shiftKey of ['morning', 'afternoon', 'evening']) {
        const shiftName = schedule.shiftConfig[shiftKey].name;
        
        const assignedCount = await slotRepo.countDocuments({
          scheduleId: schedule._id,
          shiftName,
          $or: [
            { dentist: { $ne: null } },
            { nurse: { $ne: null } }
          ]
        });
        
        schedule.staffAssignment[shiftKey].assigned = assignedCount;
      }
      
      await schedule.save();
    }
    
    // Clear cache
    for (const slotId of updatedSlots) {
      await redisClient.del(`slot:${slotId}`);
    }
    
    return {
      success: true,
      message: `Đã thay thế ${updatedCount} slot thành công`,
      updatedCount,
      updatedSlots,
      replaceMode: replaceAll ? 'replaceAll' : 'specific'
    };
    
  } catch (error) {
    console.error('❌ Error replacing staff:', error);
    throw error;
  }
};






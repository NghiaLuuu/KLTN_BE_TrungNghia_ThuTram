const scheduleRepo = require('../repositories/schedule.repository');
const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');
const cfgService = require('./scheduleConfig.service');
const { publishToQueue } = require('../utils/rabbitClient');
const Schedule = require('../models/schedule.model');

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

function toVNDateOnlyString(d) {
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vn.getFullYear();
  const m = String(vn.getMonth() + 1).padStart(2, '0');
  const day = String(vn.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

// Helper: Check if date is holiday (Vietnam calendar day)
async function isHoliday(date) {
  const holidayConfig = await cfgService.getHolidays();
  const holidays = holidayConfig?.holidays || [];

  const checkVN = toVNDateOnlyString(date);
  
  const result = holidays.some(holiday => {
    const startVN = toVNDateOnlyString(new Date(holiday.startDate));
    const endVN = toVNDateOnlyString(new Date(holiday.endDate));
    return checkVN >= startVN && checkVN <= endVN;
  });
  
  return result;
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

// Create daily schedule for a room
async function createDailySchedule(room, date, config) {
  // Get work shifts - chỉ lấy các shift đang hoạt động
  const allWorkShifts = config.getWorkShifts();
  const activeWorkShifts = allWorkShifts.filter(shift => shift.isActive === true);
  
  if (activeWorkShifts.length === 0) {
    console.log(`⚠️ No active work shifts found for room ${room.name} on ${toVNDateOnlyString(date)}`);
    return null; // Không tạo schedule nếu không có shift nào hoạt động
  }
  
  
  const schedule = {
    roomId: room._id,
    // Persist exact Vietnam calendar date string only
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
  
  // Generate slots for this schedule
  await generateSlotsForSchedule(savedSchedule, room, config);
  
  return savedSchedule;
}

// Generate slots for a schedule
async function generateSlotsForSchedule(schedule, room, config) {
  const slots = [];
  
  for (const shift of schedule.workShifts) {
    if (!shift.isActive) continue;
    
    const shiftSlots = generateSlotsForShift(schedule, room, shift, config);
    slots.push(...shiftSlots);
  }
  
  if (slots.length > 0) {
    await slotRepo.createMany(slots);
  }
  
  return slots;
}

// Generate slots for a specific shift
function generateSlotsForShift(schedule, room, shift, config) {
  const slots = [];
  
  // Parse start and end time
  const [startHour, startMin] = shift.startTime.split(':').map(Number);
  const [endHour, endMin] = shift.endTime.split(':').map(Number);
  
  const [y, mo, d] = (schedule.dateVNStr).split('-').map(Number);
  // Build UTC Date objects that represent the Vietnam-local wall-clock times.
  // We convert VN local (y,mo,d,h,m) -> UTC instant using fromVNToUTC helper so stored Date is canonical UTC but
  // when interpreted in VN timezone will show the intended wall-clock time.
  const startTime = fromVNToUTC(y, mo, d, startHour, startMin);
  const endTime = fromVNToUTC(y, mo, d, endHour, endMin);
  
  // Check if room has subrooms
  if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    // Room has subrooms - create slots based on unitDuration for each subroom
    const unitDuration = config.unitDuration || 15;
    let currentTime = startTime.getTime();
    const endMillis = endTime.getTime();
    const step = (unitDuration || 15) * 60 * 1000;

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
          } else {
            console.log(`⚠️ Skipped slot for inactive subroom: ${subRoom.name} (ID: ${subRoom._id}) in room ${room.name}`);
          }
        });
      }
      currentTime += step;
    }
  } else {
    // Room without subrooms - create one slot per shift (entire shift duration)
  slots.push(createSlotData(schedule, room, null, shift, startTime, endTime));
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
  getQuarterStatus,
  getQuarterInfo,
  getVietnamDate,
  getQuarterDateRange,
  hasScheduleForPeriod,
  getQuarterAnalysisForRoom,
  createSchedulesForNewRoom,
  isLastDayOfQuarter,
  getNextQuarterForScheduling,
  isLastDayOfMonth
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
  for (const r of rooms) {
    if (r.subRooms && r.subRooms.find(sr => sr._id.toString() === subRoomId.toString())) {
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

// 🆕 Tạo lịch thông minh cho subRooms mới - dùng API generateQuarterSchedule để đồng bộ
exports.createSchedulesForNewSubRooms = async (roomId, subRoomIds) => {
  try {
    // Quick check: Validate if these are truly new subRooms by checking existing slots
    const duplicateCheck = [];
    for (const subRoomId of subRoomIds) {
      const existingSlots = await slotRepo.findSlots({ subRoomId });
      if (existingSlots.length > 0) {
        duplicateCheck.push({ subRoomId, existingSlots: existingSlots.length });
      }
    }

    if (duplicateCheck.length > 0) {
      const duplicateSummary = duplicateCheck
        .map(item => `${item.subRoomId} (${item.existingSlots} slots)`)
        .join('; ');
      console.warn(`⚠️ Bỏ qua ${duplicateCheck.length} subRoom đã có slot: ${duplicateSummary}`);
      return { success: true, totalSlotsCreated: 0, subRoomIds, roomId, reason: 'duplicate_event' };
    }

    const availableQuarters = await getAvailableQuarters();
    const creatableQuarters = availableQuarters
      .filter(q => q.isCreatable && !q.hasSchedules)
      .map(({ quarter, year }) => ({ quarter, year }));

    const existingQuarters = availableQuarters
      .filter(q => q.hasSchedules)
      .map(({ quarter, year }) => ({ quarter, year }));

    const allTargetQuarters = [...creatableQuarters, ...existingQuarters];
    const quarterSlotBaseline = new Map();
    for (const { quarter, year } of allTargetQuarters) {
      const key = `${quarter}-${year}`;
      const total = await countSlotsForQuarter(subRoomIds, quarter, year);
      quarterSlotBaseline.set(key, total);
    }

    let totalSlotsCreated = 0;
    const quarterSummaries = [];

    // Tạo lịch cho các quý có thể tạo mới sử dụng API generateQuarterSchedule
    for (const { quarter, year } of creatableQuarters) {
      try {
        await generateQuarterSchedule(quarter, year);
      } catch (error) {
        console.error(`❌ Lỗi tạo lịch Q${quarter}/${year}:`, error.message);
        continue;
      }
    }

    // Tạo slots cho subRooms mới trong các quý đã có lịch
    for (const { quarter, year } of allTargetQuarters) {
      try {
        const { startDate, endDate } = getQuarterDateRange(quarter, year);
        const key = `${quarter}-${year}`;
        const beforeQuarter = quarterSlotBaseline.get(key) || 0;
        const quarterSchedules = await scheduleRepo.findByRoomAndDateRange(roomId, startDate, endDate);

        if (quarterSchedules.length === 0) {
          try {
            await generateQuarterScheduleForSingleRoom(roomId, quarter, year);
            const newSchedules = await scheduleRepo.findByRoomAndDateRange(roomId, startDate, endDate);
            quarterSchedules.push(...newSchedules);
          } catch (singleRoomError) {
            console.error(`❌ Không thể tạo lịch cho room ${roomId} trong Q${quarter}/${year}:`, singleRoomError.message);
          }
        }

        for (const schedule of quarterSchedules) {
          for (const subRoomId of subRoomIds) {
            const result = await exports.createSlotsForSubRoom(schedule._id, subRoomId);
          }
        }

        const afterQuarter = await countSlotsForQuarter(subRoomIds, quarter, year);
        const createdThisQuarter = Math.max(afterQuarter - beforeQuarter, 0);
        quarterSlotBaseline.set(key, afterQuarter);
        totalSlotsCreated += createdThisQuarter;
        quarterSummaries.push({ quarter, year, slots: createdThisQuarter });
        console.log(`🗓️ Q${quarter}/${year}: tạo thêm ${createdThisQuarter} slot cho ${subRoomIds.length} subRoom`);
      } catch (quarterError) {
        console.error(`❌ Lỗi xử lý Q${quarter}/${year}:`, quarterError.message);
      }
    }

    if (totalSlotsCreated === 0) {
      console.warn('⚠️ Không tạo thêm slot nào vì tất cả subRoom đã có dữ liệu trước đó.');
    }

    console.log(
      `📊 Tổng kết: tạo ${totalSlotsCreated} slot cho ${subRoomIds.length} subRoom mới across ${quarterSummaries.length} quý`
    );
    return { success: true, totalSlotsCreated, subRoomIds, roomId };

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
 * Lấy slot theo scheduleId kèm thông tin nha sỹ và y tá
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

// scheduleService.js
exports.getStaffSchedule = async ({ staffId, startDate, endDate }) => {
  if (!staffId) throw new Error("Thiếu staffId");
  if (!startDate || !endDate) throw new Error("Thiếu startDate hoặc endDate");

  // lấy tất cả slot có staffId (dentist hoặc nurse)
  const slots = await slotRepo.findByStaffId(staffId, startDate, endDate);

  // lấy schedule liên quan tới các slot này
  const scheduleIds = [...new Set(slots.map(s => String(s.scheduleId)))];
  const schedules = await scheduleRepo.findByIds(scheduleIds);

  const daysMap = {};

  for (const sch of schedules) {
    const schDate = new Date(sch.startDate).toISOString().split("T")[0];

    if (!daysMap[schDate]) {
      daysMap[schDate] = { date: schDate, shifts: [] };
    }

    const shiftObj = {
      shiftIds: sch.shiftIds,
      slotDuration: sch.slotDuration,
      assigned: true,
      slots: []
    };

    const schSlots = slots.filter(slot => String(slot.scheduleId) === String(sch._id));

    for (const slot of schSlots) {
      const dentistAssigned = slot.dentistId && slot.dentistId.length > 0;
      const nurseAssigned = slot.nurseId && slot.nurseId.length > 0;

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
    staffId,
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





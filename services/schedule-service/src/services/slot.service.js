const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitClient');

// Helper: Check if user already marked as used in cache
async function isUserAlreadyUsed(userId) {
  try {
    const cached = await redisClient.get('users_cache');
    if (!cached) return false;
    const users = JSON.parse(cached);
    const user = users.find(u => u._id === userId);
    return user && user.hasBeenUsed === true;
  } catch (error) {
    console.warn('Failed to check user cache:', error.message);
    return false; // If cache fails, proceed with marking
  }
}

// Helper: Get Vietnam timezone date
function getVietnamDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
}

// Helper: Get room information
async function getRoomInfo(roomId) {
  try {
    const cached = await redisClient.get('rooms_cache');
    if (!cached) throw new Error('rooms_cache không tồn tại');
    const rooms = JSON.parse(cached);
    const room = rooms.find(r => r._id.toString() === roomId.toString());
    if (!room) throw new Error('Không tìm thấy phòng trong cache');
    return room;
  } catch (error) {
    throw new Error(`Không thể lấy thông tin phòng: ${error.message}`);
  }
}

// Helper: Mark entities as used when assigned to slots
async function markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds }) {
  try {
    // Mark room as used via RabbitMQ
    if (roomId) {
      await publishToQueue('room_queue', {
        action: 'markRoomAsUsed',
        payload: { roomId }
      });
      console.log(`📤 Sent markRoomAsUsed message for room ${roomId}`);
    }
    
    // Mark subRoom as used via RabbitMQ
    if (subRoomId) {
      await publishToQueue('room_queue', {
        action: 'markSubRoomAsUsed',
        payload: { roomId, subRoomId }
      });
      console.log(`📤 Sent markSubRoomAsUsed message for subRoom ${subRoomId}`);
    }
    
    // Mark staff as used via RabbitMQ (check cache first)
    for (const dentistId of dentistIds) {
      if (dentistId) {
        // Check cache first to avoid unnecessary updates
        const alreadyUsed = await isUserAlreadyUsed(dentistId);
        if (alreadyUsed) {
          console.log(`⚡ Skipping dentist ${dentistId} - already marked as used in cache`);
          continue;
        }
        
        await publishToQueue('auth_queue', {
          action: 'markUserAsUsed',
          payload: { userId: dentistId }
        });
        console.log(`📤 Sent markUserAsUsed message for dentist ${dentistId}`);
      }
    }
    
    for (const nurseId of nurseIds) {
      if (nurseId) {
        // Check cache first to avoid unnecessary updates
        const alreadyUsed = await isUserAlreadyUsed(nurseId);
        if (alreadyUsed) {
          console.log(`⚡ Skipping nurse ${nurseId} - already marked as used in cache`);
          continue;
        }
        
        await publishToQueue('auth_queue', {
          action: 'markUserAsUsed',
          payload: { userId: nurseId }
        });
        console.log(`📤 Sent markUserAsUsed message for nurse ${nurseId}`);
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to mark entities as used:', error.message);
    // Don't throw error - this is non-critical for slot assignment
  }
}

// Helper: Validate staff IDs against Redis users cache
async function validateStaffIds(dentistIds, nurseIds) {
  try {
    const cached = await redisClient.get('users_cache');
    if (!cached) throw new Error('users_cache không tồn tại');
    const users = JSON.parse(cached);
    
    // Validate dentist IDs
    for (const dentistId of dentistIds) {
      if (!dentistId) continue;
      const dentist = users.find(u => u._id === dentistId && u.role === 'dentist' && u.isActive);
      if (!dentist) {
        throw new Error(`dentistId ${dentistId} không hợp lệ hoặc không phải nha sỹ`);
      }
    }
    
    // Validate nurse IDs
    for (const nurseId of nurseIds) {
      if (!nurseId) continue;
      const nurse = users.find(u => u._id === nurseId && u.role === 'nurse' && u.isActive);
      if (!nurse) {
        throw new Error(`nurseId ${nurseId} không hợp lệ hoặc không phải y tá`);
      }
    }
  } catch (error) {
    throw new Error(`Lỗi kiểm tra thông tin nhân sự: ${error.message}`);
  }
}

// Helper: Validate staff assignment based on room type
async function validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds) {
  const room = await getRoomInfo(roomId);
  // If subRoomId provided, validate it belongs to the given room
  if (subRoomId) {
    if (!room.subRooms || room.subRooms.length === 0) {
      throw new Error('Phòng không có subRoom nhưng bạn đã gửi subRoomId');
    }
    const found = room.subRooms.find(sr => sr._id && sr._id.toString() === subRoomId.toString());
    if (!found) {
      throw new Error('subRoomId không thuộc về roomId đã chỉ định');
    }

    // Room with subrooms - use 1-1 constraint
    if (dentistIds.length > 1 || nurseIds.length > 1) {
      throw new Error('Phòng có subroom chỉ được phân công 1 nha sỹ và 1 y tá cho mỗi slot');
    }
  } else {
    // Room without subrooms - use maxDoctor/maxNurse constraint  
    if (dentistIds.length > room.maxDoctor) {
      throw new Error(`Phòng này chỉ được phân công tối đa ${room.maxDoctor} nha sỹ`);
    }
    if (nurseIds.length > room.maxNurse) {
      throw new Error(`Phòng này chỉ được phân công tối đa ${room.maxNurse} y tá`);
    }
  }
}

// Assign staff to slots for a room/subroom and shifts
async function assignStaffToSlots({
  roomId,
  subRoomId = null,
  // legacy: date (single day). new: scheduleId (apply to entire schedule/quarter) + shifts
  date,
  // New: accept quarter/year instead of scheduleId; service will resolve scheduleIds for that quarter
  quarter = null,
  year = null,
  shifts = [], // Array of shift names: ['Ca Sáng', 'Ca Chiều', 'Ca Tối']
  dentistIds = [],
  nurseIds = []
}) {
  try {
    // Validate input: require quarter/year for quarter-level assignment
    if (!roomId || !quarter || !year) {
      throw new Error('Room ID, quarter và year là bắt buộc để phân công theo quý');
    }

    if (shifts.length === 0) {
      throw new Error('Phải chọn ít nhất 1 ca làm việc');
    }
    
    // Validate staff assignment based on room type
    await validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds);
    
    // Resolve all schedules for the given quarter/year for this room
    const { getQuarterDateRange } = require('./schedule.service');
    const { startDate, endDate } = getQuarterDateRange(quarter, year);
    const schedules = await require('../repositories/schedule.repository').findByRoomAndDateRange(roomId, startDate, endDate);
    const scheduleIds = schedules.map(s => s._id);
    if (!scheduleIds || scheduleIds.length === 0) {
      throw new Error('Không tìm thấy schedule nào cho phòng trong quý được chỉ định');
    }

    // Build query filter: all slots in those schedules
    const queryFilter = { roomId, scheduleId: { $in: scheduleIds }, isActive: true };
    if (shifts && shifts.length) queryFilter.shiftName = { $in: shifts };
    if (subRoomId) queryFilter.subRoomId = subRoomId; else queryFilter.subRoomId = null;

    const slots = await slotRepo.find(queryFilter);
    
    if (slots.length === 0) {
      throw new Error('Không tìm thấy slot nào phù hợp');
    }
    
    // Note: We allow updating slots even if some belong to an appointment, because this endpoint applies by quarter and shifts.
    // Atomicity across appointments is enforced in the single/group update API.

    // Build update object
    const updateData = {};
    if (dentistIds.length > 0) updateData.dentist = dentistIds[0];
    if (nurseIds.length > 0) updateData.nurse = nurseIds[0];

    let updatedSlots = [];
    if (Object.keys(updateData).length > 0) {
      // Before applying updates, check for conflicts per slot: ensure dentist/nurse are not
      // already assigned to other slots that overlap each target slot's time interval.
      const targetSlotIds = new Set(slots.map(s => s._id.toString()));
      const minStart = new Date(Math.min(...slots.map(s => new Date(s.startTime).getTime())));
      const maxEnd = new Date(Math.max(...slots.map(s => new Date(s.endTime).getTime())));

      let existingByDentist = [];
      let existingByNurse = [];
      if (dentistIds.length > 0 && dentistIds[0]) {
        existingByDentist = await slotRepo.findByStaffId(dentistIds[0], minStart, maxEnd);
      }
      if (nurseIds.length > 0 && nurseIds[0]) {
        existingByNurse = await slotRepo.findByStaffId(nurseIds[0], minStart, maxEnd);
      }

      for (const s of slots) {
        const sStart = new Date(s.startTime);
        const sEnd = new Date(s.endTime);
        if (existingByDentist.length) {
          const conflict = existingByDentist.find(es => es._id.toString() !== s._id.toString() && new Date(es.startTime) < sEnd && new Date(es.endTime) > sStart);
          if (conflict) throw new Error('Nha sỹ đã được phân công vào slot khác trong cùng khoảng thời gian');
        }
        if (existingByNurse.length) {
          const conflict = existingByNurse.find(es => es._id.toString() !== s._id.toString() && new Date(es.startTime) < sEnd && new Date(es.endTime) > sStart);
          if (conflict) throw new Error('Y tá đã được phân công vào slot khác trong cùng khoảng thời gian');
        }
      }

      await slotRepo.updateManySlots(queryFilter, updateData);
      updatedSlots = await slotRepo.find(queryFilter);
      
      // 🔄 Mark entities as used when successfully assigned
      await markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds });
    }
    
    // Clear cache - best effort
    try {
      const dayKey = date ? new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0] : 'all';
      await redisClient.del(`slots:room:${roomId}:${dayKey}`);
    } catch (e) { console.warn('Failed to clear slots cache', e); }
    
    return {
      message: `Phân công nhân sự thành công cho ${updatedSlots.length} slot`,
      slotsUpdated: updatedSlots.length,
      shifts,
      dentistAssigned: dentistIds[0] || null,
      nurseAssigned: nurseIds[0] || null
    };
    
  } catch (error) {
    throw new Error(`Lỗi phân công nhân sự: ${error.message}`);
  }
}

// Update staff for single or multiple slots
async function updateSlotStaff({ slotIds, dentistId, nurseId }) {
  try {
    if (!slotIds || slotIds.length === 0) {
      throw new Error('slotIds là bắt buộc và phải là mảng không rỗng');
    }

    // Load provided slots and validate they exist
    const targetSlots = await slotRepo.find({ _id: { $in: slotIds } });
    if (targetSlots.length !== slotIds.length) {
      throw new Error('Một số slot trong slotIds không tồn tại');
    }

    // Ensure all slots are updatable (not booked) 
    for (const s of targetSlots) {
      if (s.isBooked) {
        throw new Error(`Slot ${s._id} đã được đặt, không thể cập nhật`);
      }
    }

    // Validate staff assignment across first slot's room/subRoom (assume same room)
    const first = targetSlots[0];
    const dentistIds = dentistId ? [dentistId] : [];
    const nurseIds = nurseId ? [nurseId] : [];
    await validateStaffAssignment(first.roomId, first.subRoomId, dentistIds, nurseIds);

    // Conflict check per slot: ensure dentist/nurse not already assigned to overlapping slots
    const targetSlotIds = new Set(slotIds.map(id => id.toString()));
    const minStart = new Date(Math.min(...targetSlots.map(s => new Date(s.startTime).getTime())));
    const maxEnd = new Date(Math.max(...targetSlots.map(s => new Date(s.endTime).getTime())));

    let existingByDentist = [];
    let existingByNurse = [];
    if (dentistId) existingByDentist = await slotRepo.findByStaffId(dentistId, minStart, maxEnd);
    if (nurseId) existingByNurse = await slotRepo.findByStaffId(nurseId, minStart, maxEnd);

    for (const s of targetSlots) {
      const sStart = new Date(s.startTime);
      const sEnd = new Date(s.endTime);
      
      if (dentistId && existingByDentist.length) {
        const conflict = existingByDentist.find(es => 
          !targetSlotIds.has(es._id.toString()) && 
          new Date(es.startTime) < sEnd && 
          new Date(es.endTime) > sStart
        );
        if (conflict) {
          throw new Error(`Nha sỹ đã được phân công vào slot khác trong cùng khoảng thời gian: ${sStart.toLocaleString()} - ${sEnd.toLocaleString()}`);
        }
      }
      
      if (nurseId && existingByNurse.length) {
        const conflict = existingByNurse.find(es => 
          !targetSlotIds.has(es._id.toString()) && 
          new Date(es.startTime) < sEnd && 
          new Date(es.endTime) > sStart
        );
        if (conflict) {
          throw new Error(`Y tá đã được phân công vào slot khác trong cùng khoảng thời gian: ${sStart.toLocaleString()} - ${sEnd.toLocaleString()}`);
        }
      }
    }

    const updateData = {};
    if (dentistId !== undefined) updateData.dentist = dentistId;
    if (nurseId !== undefined) updateData.nurse = nurseId;

    await slotRepo.updateManySlots({ _id: { $in: slotIds } }, updateData);
    const updated = await slotRepo.find({ _id: { $in: slotIds } });

    // 🔄 Mark entities as used when successfully assigned
    const roomId = updated[0]?.roomId; // Get roomId from first slot
    const subRoomId = updated[0]?.subRoomId; // Get subRoomId from first slot
    const markDentistIds = dentistId ? [dentistId] : [];
    const markNurseIds = nurseId ? [nurseId] : [];
    await markEntitiesAsUsed({ roomId, subRoomId, dentistIds: markDentistIds, nurseIds: markNurseIds });

    // Clear cache for affected rooms/days (best effort)
    try {
      await Promise.all(updated.map(s => {
        const dateStr = new Date(s.startTime).toLocaleDateString('en-CA'); // YYYY-MM-DD format
        return redisClient.del(`slots:room:${s.roomId}:${dateStr}`).catch(() => {});
      }));
    } catch (e) {}

    return updated;
  } catch (error) {
    throw new Error(`Lỗi cập nhật nhân sự slot: ${error.message}`);
  }
}

// Get slots by shift and date for easy slot selection
async function getSlotsByShiftAndDate({ roomId, subRoomId = null, date, shiftName }) {
  try {
    // Build date range for the day in Vietnam timezone
    const inputDate = new Date(date);
    const startOfDayVN = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate(), 0, 0, 0, 0);
    const endOfDayVN = new Date(inputDate.getFullYear(), inputDate.getMonth(), inputDate.getDate(), 23, 59, 59, 999);
    
    // Convert VN timezone to UTC (VN is UTC+7)
    const startUTC = new Date(startOfDayVN.getTime() - 7 * 60 * 60 * 1000);
    const endUTC = new Date(endOfDayVN.getTime() - 7 * 60 * 60 * 1000);

    const queryFilter = {
      roomId,
      startTime: { $gte: startUTC, $lte: endUTC },
      shiftName,
      isActive: true
    };
    
    if (subRoomId) {
      queryFilter.subRoomId = subRoomId;
    } else {
      queryFilter.subRoomId = null;
    }

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for staff details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    
    const slotsWithStaffInfo = slots.map(slot => {
      const dentist = slot.dentist ? users.find(u => u._id === slot.dentist) : null;
      const nurse = slot.nurse ? users.find(u => u._id === slot.nurse) : null;
      
      return {
        slotId: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        dentist: dentist ? {
          id: dentist._id,
          name: dentist.name,
          role: dentist.role
        } : null,
        nurse: nurse ? {
          id: nurse._id,
          name: nurse.name,
          role: nurse.role
        } : null,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null,
        status: slot.isBooked ? 'booked' : (slot.dentist && slot.nurse ? 'available' : 'no_staff')
      };
    });
    
    return {
      roomId,
      subRoomId,
      date,
      shiftName,
      totalSlots: slotsWithStaffInfo.length,
      slots: slotsWithStaffInfo
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy slot theo ca và ngày: ${error.message}`);
  }
}

// Get room calendar with appointment counts (daily/weekly/monthly view) with pagination
async function getRoomCalendar({ roomId, subRoomId = null, viewType, startDate = null, page = 1, limit = 10 }) {
  try {
    // Get schedule config for shift information
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const scheduleConfig = await ScheduleConfig.getSingleton();
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination
    const periods = [];
    for (let i = 0; i < limit; i++) {
      const periodIndex = (page - 1) * limit + i;
      let periodStart, periodEnd;
      
      switch (viewType) {
        case 'day':
          // Each period is one day
          periodStart = new Date(baseDate);
          periodStart.setDate(baseDate.getDate() + periodIndex);
          periodEnd = new Date(periodStart);
          break;
          
        case 'week':
          // Each period is one week (Monday to Sunday)
          const weekStart = new Date(baseDate);
          const dayOfWeek = weekStart.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          weekStart.setDate(baseDate.getDate() + mondayOffset + (periodIndex * 7));
          
          periodStart = new Date(weekStart);
          periodEnd = new Date(weekStart);
          periodEnd.setDate(weekStart.getDate() + 6);
          break;
          
        case 'month':
          // Each period is one month
          const targetYear = baseDate.getFullYear();
          const targetMonth = baseDate.getMonth() + periodIndex;
          
          // Use local dates to avoid timezone issues
          periodStart = new Date(targetYear, targetMonth, 1);
          periodEnd = new Date(targetYear, targetMonth + 1, 0); // Last day of target month
          
          // Adjust for correct local date representation
          periodStart.setHours(0, 0, 0, 0);
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        default:
          throw new Error('viewType phải là: day, week hoặc month');
      }
      
      periods.push({ start: periodStart, end: periodEnd });
    }
    
    // Get overall date range for database query
    const overallStart = periods[0].start;
    const overallEnd = periods[periods.length - 1].end;

    // Build UTC range for query
    const startUTC = new Date(Date.UTC(
      overallStart.getFullYear(),
      overallStart.getMonth(),
      overallStart.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      overallEnd.getFullYear(),
      overallEnd.getMonth(),
      overallEnd.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      roomId,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };
    
    if (subRoomId) {
      queryFilter.subRoomId = subRoomId;
    } else {
      queryFilter.subRoomId = null;
    }

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for staff details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    
    // Group slots by date and shift
    const calendar = {};
    const appointmentCounts = {}; // Track unique appointments
    const staffStats = {}; // Track staff frequency by date and shift
    
    for (const slot of slots) {
      // Convert to Vietnam date
      const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      
      if (!calendar[slotDateVN]) {
        calendar[slotDateVN] = {
          date: slotDateVN,
          shifts: {
            'Ca Sáng': { slots: [], appointmentCount: 0, totalSlots: 0 },
            'Ca Chiều': { slots: [], appointmentCount: 0, totalSlots: 0 },
            'Ca Tối': { slots: [], appointmentCount: 0, totalSlots: 0 }
          },
          totalAppointments: 0,
          totalSlots: 0
        };
        appointmentCounts[slotDateVN] = new Set();
        staffStats[slotDateVN] = {
          'Ca Sáng': { dentists: {}, nurses: {} },
          'Ca Chiều': { dentists: {}, nurses: {} },
          'Ca Tối': { dentists: {}, nurses: {} }
        };
      }
      
      const shift = calendar[slotDateVN].shifts[slot.shiftName];
      const shiftStats = staffStats[slotDateVN][slot.shiftName];
      
      if (shift && shiftStats) {
        shift.totalSlots++;
        calendar[slotDateVN].totalSlots++;
        
        // Count unique appointments
        if (slot.appointmentId && slot.isBooked) {
          appointmentCounts[slotDateVN].add(slot.appointmentId.toString());
        }
        
        // Get staff info from cache
        const dentist = slot.dentist ? users.find(u => u._id === slot.dentist) : null;
        const nurse = slot.nurse ? users.find(u => u._id === slot.nurse) : null;
        
        // Track staff frequency for statistics
        if (slot.dentist) {
          const dentistId = slot.dentist.toString();
          shiftStats.dentists[dentistId] = (shiftStats.dentists[dentistId] || 0) + 1;
        }
        if (slot.nurse) {
          const nurseId = slot.nurse.toString();
          shiftStats.nurses[nurseId] = (shiftStats.nurses[nurseId] || 0) + 1;
        }
        
        // Add slot info with staff details
        shift.slots.push({
          slotId: slot._id,
          startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
            timeZone: 'Asia/Ho_Chi_Minh', 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          }),
          endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
            timeZone: 'Asia/Ho_Chi_Minh', 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          }),
          dentistId: slot.dentist || null,
          dentistName: dentist ? dentist.name : null,
          nurseId: slot.nurse || null,
          nurseName: nurse ? nurse.name : null,
          hasStaff: !!(slot.dentist && slot.nurse),
          isBooked: slot.isBooked || false,
          appointmentId: slot.appointmentId || null
        });
      }
    }
    
    // Update appointment counts and add staff statistics
    for (const [dateStr, appointmentIds] of Object.entries(appointmentCounts)) {
      const dayData = calendar[dateStr];
      const dayStats = staffStats[dateStr];
      
      if (dayData && dayStats) {
        dayData.totalAppointments = appointmentIds.size;
        
        // Process each shift and add staff statistics
        for (const shiftName of ['Ca Sáng', 'Ca Chiều', 'Ca Tối']) {
          const shift = dayData.shifts[shiftName];
          const shiftStat = dayStats[shiftName];
          
          if (shift && shiftStat) {
            // Count appointments for this shift
            const shiftAppointments = shift.slots.filter(s => s.isBooked && s.appointmentId);
            const uniqueShiftAppointments = new Set(
              shiftAppointments.map(s => s.appointmentId.toString())
            );
            shift.appointmentCount = uniqueShiftAppointments.size;
            
            // Find most frequent dentist and nurse
            let mostFrequentDentist = null;
            let mostFrequentNurse = null;
            
            if (Object.keys(shiftStat.dentists).length > 0) {
              const topDentistId = Object.entries(shiftStat.dentists)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
              const topDentist = users.find(u => u._id === topDentistId);
              if (topDentist) {
                mostFrequentDentist = {
                  id: topDentistId,
                  name: topDentist.name,
                  slotCount: shiftStat.dentists[topDentistId]
                };
              }
            }
            
            if (Object.keys(shiftStat.nurses).length > 0) {
              const topNurseId = Object.entries(shiftStat.nurses)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
              const topNurse = users.find(u => u._id === topNurseId);
              if (topNurse) {
                mostFrequentNurse = {
                  id: topNurseId,
                  name: topNurse.name,
                  slotCount: shiftStat.nurses[topNurseId]
                };
              }
            }
            
            // Add staff statistics to shift
            shift.staffStats = {
              mostFrequentDentist,
              mostFrequentNurse
            };
          }
        }
      }
    }
    
    // Prepare shift overview from schedule config
    const shiftOverview = {
      'Ca Sáng': {
        name: scheduleConfig.morningShift.name,
        startTime: scheduleConfig.morningShift.startTime,
        endTime: scheduleConfig.morningShift.endTime,
        isActive: scheduleConfig.morningShift.isActive
      },
      'Ca Chiều': {
        name: scheduleConfig.afternoonShift.name,
        startTime: scheduleConfig.afternoonShift.startTime,
        endTime: scheduleConfig.afternoonShift.endTime,
        isActive: scheduleConfig.afternoonShift.isActive
      },
      'Ca Tối': {
        name: scheduleConfig.eveningShift.name,
        startTime: scheduleConfig.eveningShift.startTime,
        endTime: scheduleConfig.eveningShift.endTime,
        isActive: scheduleConfig.eveningShift.isActive
      }
    };
    
    // Get room and subroom names from cache
    const roomFromCache = rooms.find(r => r._id === roomId);
    let subRoomInfo = null;
    let roomInfo = {
      id: roomId,
      name: 'Unknown Room'
    };
    
    if (roomFromCache) {
      roomInfo = {
        id: roomFromCache._id,
        name: roomFromCache.name,
        hasSubRooms: roomFromCache.hasSubRooms,
        maxDoctors: roomFromCache.maxDoctors,
        maxNurses: roomFromCache.maxNurses,
        isActive: roomFromCache.isActive
      };
      
      // Find subroom info if requested
      if (subRoomId && roomFromCache.subRooms && roomFromCache.subRooms.length > 0) {
        subRoomInfo = roomFromCache.subRooms.find(sr => sr._id === subRoomId);
        if (subRoomInfo) {
          roomInfo.subRoom = {
            id: subRoomInfo._id,
            name: subRoomInfo.name,
            isActive: subRoomInfo.isActive
          };
        }
      }
    } else {
      // Fallback to database data if cache not available
      const room = await getRoomInfo(roomId);
      roomInfo = {
        id: room._id,
        name: room.name
      };
      
      if (subRoomId && room.subRooms) {
        const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
        if (subRoom) {
          roomInfo.subRoom = {
            id: subRoom._id,
            name: subRoom.name
          };
        }
      }
    }
    
    // Group calendar data by periods
    const calendarPeriods = periods.map((period, index) => {
      const periodCalendar = {};
      
      // Format dates properly for local timezone
      const periodStartStr = period.start.getFullYear() + '-' + 
        String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.start.getDate()).padStart(2, '0');
      const periodEndStr = period.end.getFullYear() + '-' + 
        String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.end.getDate()).padStart(2, '0');
      
      Object.entries(calendar).forEach(([dateStr, dayData]) => {
        if (dateStr >= periodStartStr && dateStr <= periodEndStr) {
          periodCalendar[dateStr] = dayData;
        }
      });
      
      return {
        periodIndex: (page - 1) * limit + index + 1,
        startDate: periodStartStr,
        endDate: periodEndStr,
        viewType,
        totalDays: Object.keys(periodCalendar).length,
        days: Object.values(periodCalendar).sort((a, b) => a.date.localeCompare(b.date))
      };
    });
    
    // Calculate pagination info
    const currentDate = getVietnamDate().toISOString().split('T')[0];
    
    return {
      roomInfo,
      shiftOverview,
      pagination: {
        currentPage: page,
        limit,
        viewType,
        currentDate,
        hasNext: true, // Always true for calendar pagination
        hasPrev: page > 1,
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch phòng: ${error.message}`);
  }
}

module.exports = {
  assignStaffToSlots,
  updateSlotStaff,
  getSlotsByShiftAndDate,
  getRoomCalendar,
  getVietnamDate,
  validateStaffIds
};
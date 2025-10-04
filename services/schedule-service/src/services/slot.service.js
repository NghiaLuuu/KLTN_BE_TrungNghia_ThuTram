const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitClient');
const { getVietnamDate, toVietnamTime } = require('../utils/vietnamTime.util');

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

// Helper: Get current quarter and year information in Vietnam timezone
function getCurrentQuarterInfo() {
  const vnNow = getVietnamDate();
  const quarter = Math.ceil((vnNow.getMonth() + 1) / 3);
  const year = vnNow.getFullYear();
  return { quarter, year, currentDate: vnNow };
}

// Helper: Validate quarter and year against current time
function validateQuarterYear(quarter, year) {
  const { quarter: currentQuarter, year: currentYear } = getCurrentQuarterInfo();
  
  // Check if quarter is in the past
  if (year < currentYear || (year === currentYear && quarter < currentQuarter)) {
    throw new Error(`Không thể cập nhật quý ${quarter}/${year} vì đã thuộc quá khứ. Quý hiện tại là ${currentQuarter}/${currentYear}`);
  }
  
  return true;
}

// Helper: Get available quarters and years for staff assignment (chỉ những quý đã có lịch)
async function getAvailableQuartersYears() {
  try {
    // Sử dụng logic từ schedule service để lấy danh sách quý
    const scheduleService = require('./schedule.service');
    const allQuarters = await scheduleService.getAvailableQuarters();
    
    // Lọc chỉ những quý đã có lịch (hasSchedules: true hoặc isCreated: true)
    const quartersWithSchedules = allQuarters.filter(q => q.hasSchedules === true || q.isCreated === true);
    
    const { quarter: currentQuarter, year: currentYear } = getCurrentQuarterInfo();
    
    // Map sang format cần thiết cho slot assignment
    const availableOptions = quartersWithSchedules.map(q => ({
      quarter: q.quarter,
      year: q.year,
      label: (q.quarter === currentQuarter && q.year === currentYear) ? 
        `Quý ${q.quarter}/${q.year} (Hiện tại)` : 
        `Quý ${q.quarter}/${q.year}`,
      isCurrent: q.quarter === currentQuarter && q.year === currentYear,
      hasSchedules: q.hasSchedules,
      isCreated: q.isCreated
    }));
    
    return {
      currentQuarter: { quarter: currentQuarter, year: currentYear, currentDate: getVietnamDate() },
      availableOptions
    };
  } catch (error) {
    throw new Error(`Không thể lấy danh sách quý có lịch: ${error.message}`);
  }
}

// Helper: Get available work shifts from ScheduleConfig
async function getAvailableShifts() {
  try {
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const config = await ScheduleConfig.getSingleton();
    
    if (!config) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo');
    }
    
    const shifts = config.getWorkShifts();
    
    return shifts.map(shift => ({
      value: shift.name,
      label: shift.name,
      timeRange: `${shift.startTime} - ${shift.endTime}`
    }));
  } catch (error) {
    throw new Error(`Không thể lấy danh sách ca làm việc: ${error.message}`);
  }
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

    // Validate quarter/year is not in the past
    validateQuarterYear(quarter, year);
    
    // Validate staff assignment based on room type
    await validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds);
    
    // Resolve all schedules for the given quarter/year for this room
    const { getQuarterDateRange } = require('./schedule.service');
    const { startDate, endDate } = getQuarterDateRange(quarter, year);
    const schedules = await require('../repositories/schedule.repository').findByRoomAndDateRange(roomId, startDate, endDate);
    const scheduleIds = schedules.map(s => s._id);
    if (!scheduleIds || scheduleIds.length === 0) {
      throw new Error(`Không tìm thấy lịch làm việc nào cho phòng trong quý ${quarter}/${year}. Vui lòng tạo lịch làm việc trước khi phân công nhân sự.`);
    }

    // Get current time in Vietnam timezone for filtering future slots only
    const vietnamNow = getVietnamDate();

    // Build query filter: all slots in those schedules that DON'T have FULL staff assigned yet
    // and are in the future (startTime > current Vietnam time)
    const queryFilter = { 
      roomId, 
      scheduleId: { $in: scheduleIds }, 
      isActive: true,
      startTime: { $gt: vietnamNow }, // Only future slots
      // ⭐ KEY: Find slots that are missing dentist OR nurse (not fully staffed)
      $or: [
        { $or: [{ dentist: { $exists: false } }, { dentist: null }] },
        { $or: [{ nurse: { $exists: false } }, { nurse: null }] }
      ]
    };
    if (shifts && shifts.length) queryFilter.shiftName = { $in: shifts };
    if (subRoomId) queryFilter.subRoomId = subRoomId; else queryFilter.subRoomId = null;

    const slots = await slotRepo.find(queryFilter);
    
    if (slots.length === 0) {
      // Kiểm tra các nguyên nhân có thể xảy ra
      const room = await getRoomInfo(roomId);
      let foundSubRoom = null; // Khai báo biến để sử dụng trong error messages
      
      // 1. Kiểm tra logic subRoom
      if (subRoomId) {
        // User truyền subRoomId nhưng phòng không có subRoom
        if (!room.subRooms || room.subRooms.length === 0) {
          throw new Error(`Phòng "${room.name}" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác.`);
        }
        
        // subRoomId không thuộc phòng này
        foundSubRoom = room.subRooms.find(sr => sr._id && sr._id.toString() === subRoomId.toString());
        if (!foundSubRoom) {
          throw new Error(`SubRoom không thuộc về phòng "${room.name}". Vui lòng kiểm tra lại subRoomId.`);
        }
      } else {
        // User không truyền subRoomId nhưng phòng có subRoom
        if (room.subRooms && room.subRooms.length > 0) {
          const activeSubRooms = room.subRooms.filter(sr => sr.isActive !== false);
          throw new Error(`Phòng "${room.name}" có ${activeSubRooms.length} subroom. Vui lòng chỉ định subRoomId cụ thể: ${activeSubRooms.map(sr => `${sr._id} (${sr.name})`).join(', ')}`);
        }
      }
      
      // 2. Kiểm tra slot chưa có nhân sự  
      const unassignedQuery = {
        roomId,
        scheduleId: { $in: scheduleIds },
        isActive: true,
        startTime: { $gt: vietnamNow },
        $and: [
          { $or: [{ dentist: { $exists: false } }, { dentist: null }] },
          { $or: [{ nurse: { $exists: false } }, { nurse: null }] }
        ]
      };
      if (shifts && shifts.length) unassignedQuery.shiftName = { $in: shifts };
      if (subRoomId) unassignedQuery.subRoomId = subRoomId; else unassignedQuery.subRoomId = null;
      
      const unassignedSlots = await slotRepo.find(unassignedQuery);
      
      if (unassignedSlots.length === 0) {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        throw new Error(`Tất cả slot trong quý ${quarter}/${year} cho ${roomDisplay} đã được phân công nhân sự. Sử dụng API reassign-staff để thay đổi nhân sự.`);
      } else {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        const shiftDisplay = shifts.length > 0 ? ` ca "${shifts.join(', ')}"` : '';
        throw new Error(`Không tìm thấy slot phù hợp trong quý ${quarter}/${year} cho ${roomDisplay}${shiftDisplay}. Có ${unassignedSlots.length} slot chưa có nhân sự nhưng không match yêu cầu.`);
      }
    }
    
    // Note: We allow updating slots even if some belong to an appointment, because this endpoint applies by quarter and shifts.
    // Atomicity across appointments is enforced in the single/group update API.

    // Process each slot individually to only fill missing fields
    let updatedSlotIds = [];
    const dentistId = dentistIds.length > 0 ? dentistIds[0] : null;
    const nurseId = nurseIds.length > 0 ? nurseIds[0] : null;

    if (dentistId || nurseId) {
      // Check conflicts for dentist and nurse across the time range
      const minStart = new Date(Math.min(...slots.map(s => new Date(s.startTime).getTime())));
      const maxEnd = new Date(Math.max(...slots.map(s => new Date(s.endTime).getTime())));

      let existingByDentist = [];
      let existingByNurse = [];
      if (dentistId) {
        existingByDentist = await slotRepo.findByStaffId(dentistId, minStart, maxEnd);
      }
      if (nurseId) {
        existingByNurse = await slotRepo.findByStaffId(nurseId, minStart, maxEnd);
      }

      // Process each slot individually to only fill missing fields
      for (const slot of slots) {
        const slotUpdateData = {};
        
        // Check if we should assign dentist (only if slot doesn't have dentist yet)
        if (dentistId && (!slot.dentist || slot.dentist === null)) {
          // Check for time conflicts
          const sStart = new Date(slot.startTime);
          const sEnd = new Date(slot.endTime);
          const conflict = existingByDentist.find(es => 
            es._id.toString() !== slot._id.toString() && 
            new Date(es.startTime) < sEnd && 
            new Date(es.endTime) > sStart
          );
          if (conflict) throw new Error(`Nha sỹ đã được phân công vào slot khác trong cùng khoảng thời gian (${new Date(slot.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })})`);
          
          slotUpdateData.dentist = dentistId;
        }
        
        // Check if we should assign nurse (only if slot doesn't have nurse yet)
        if (nurseId && (!slot.nurse || slot.nurse === null)) {
          // Check for time conflicts
          const sStart = new Date(slot.startTime);
          const sEnd = new Date(slot.endTime);
          const conflict = existingByNurse.find(es => 
            es._id.toString() !== slot._id.toString() && 
            new Date(es.startTime) < sEnd && 
            new Date(es.endTime) > sStart
          );
          if (conflict) throw new Error(`Y tá đã được phân công vào slot khác trong cùng khoảng thời gian (${new Date(slot.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })})`);
          
          slotUpdateData.nurse = nurseId;
        }
        
        // Update the slot if there's something to update
        if (Object.keys(slotUpdateData).length > 0) {
          await slotRepo.updateSlot(slot._id, slotUpdateData);
          updatedSlotIds.push(slot._id);
        }
      }

      // Reload updated slots for return data
      updatedSlots = updatedSlotIds.length > 0 ? await slotRepo.find({ _id: { $in: updatedSlotIds } }) : [];
      
      // 🔄 Mark entities as used when successfully assigned
      if (updatedSlotIds.length > 0) {
        await markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds });
      }
    }
    
    // Clear cache - best effort
    try {
      const dayKey = date ? new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0] : 'all';
      await redisClient.del(`slots:room:${roomId}:${dayKey}`);
    } catch (e) { console.warn('Failed to clear slots cache', e); }
    
    const totalSlotsFound = slots.length;
    const slotsUpdated = updatedSlots.length;
    
    return {
      message: slotsUpdated > 0 
        ? `Phân công nhân sự thành công cho ${slotsUpdated}/${totalSlotsFound} slot (chỉ gán vào các field còn thiếu)`
        : `Tìm thấy ${totalSlotsFound} slot nhưng tất cả đã có đầy đủ nhân sự được yêu cầu`,
      slotsUpdated,
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

    // Get current time in Vietnam timezone
    const vietnamNow = getVietnamDate();

    // Ensure all slots are updatable (not in the past) 
    for (const s of targetSlots) {
      // Check if slot is in the past (Vietnam timezone)
      if (new Date(s.startTime) <= vietnamNow) {
        throw new Error(`Slot ${s._id} đã qua thời điểm hiện tại (${new Date(s.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}), không thể cập nhật`);
      }
      
      // ⭐ Only allow updating slots that already have staff assigned
      if (!s.dentist && !s.nurse) {
        throw new Error(`Slot ${s._id} chưa được phân công nhân sự, không thể cập nhật. Vui lòng sử dụng API phân công thay thế.`);
      }
    }

    // Validate all slots belong to the same room/subroom
    const first = targetSlots[0];
    const firstRoomId = first.roomId?.toString();
    const firstSubRoomId = first.subRoomId?.toString() || null;
    
    for (const slot of targetSlots) {
      const slotRoomId = slot.roomId?.toString();
      const slotSubRoomId = slot.subRoomId?.toString() || null;
      
      if (slotRoomId !== firstRoomId) {
        throw new Error(`Tất cả slot phải thuộc cùng một phòng. Slot ${slot._id} thuộc phòng khác.`);
      }
      
      if (slotSubRoomId !== firstSubRoomId) {
        const subRoomDisplay = firstSubRoomId ? `subroom ${firstSubRoomId}` : 'không có subroom';
        const slotSubRoomDisplay = slotSubRoomId ? `subroom ${slotSubRoomId}` : 'không có subroom';
        throw new Error(`Tất cả slot phải thuộc cùng subroom. Slot đầu tiên có ${subRoomDisplay}, nhưng slot ${slot._id} có ${slotSubRoomDisplay}.`);
      }
    }

    // Validate staff assignment for the room/subroom
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
    if (!scheduleConfig) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo. Vui lòng liên hệ admin để thiết lập.');
    }
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination - support negative pages for historical data
    const periods = [];
    for (let i = 0; i < limit; i++) {
      // For page 1: periodIndex = 0, 1, 2... (current and future)
      // For page -1: periodIndex = -limit, -limit+1, ... -1 (past periods)
      // For page 2: periodIndex = limit, limit+1, ... (further future)
      let periodIndex;
      if (page >= 1) {
        periodIndex = (page - 1) * limit + i;
      } else {
        // Negative pages: page -1 means indices -limit to -1, page -2 means -2*limit to -limit-1
        periodIndex = page * limit + i;
      }
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
            'Ca Sáng': { appointmentCount: 0, totalSlots: 0 },
            'Ca Chiều': { appointmentCount: 0, totalSlots: 0 },
            'Ca Tối': { appointmentCount: 0, totalSlots: 0 }
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
        
        // ⭐ NO LONGER adding individual slot details - only counting
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
            const shiftAppointmentIds = new Set();
            for (const slot of slots) {
              const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
                timeZone: 'Asia/Ho_Chi_Minh'
              });
              if (slotDateVN === dateStr && slot.shiftName === shiftName && slot.isBooked && slot.appointmentId) {
                shiftAppointmentIds.add(slot.appointmentId.toString());
              }
            }
            shift.appointmentCount = shiftAppointmentIds.size;
            
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
        hasNext: true, // Always allow going to future
        hasPrev: true, // Always allow going to past (support negative pages)
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch phòng: ${error.message}`);
  }
}

// Get dentist calendar with appointment counts (daily/weekly/monthly view) with historical support  
async function getDentistCalendar({ dentistId, viewType, startDate = null, page = 1, limit = 10 }) {
  try {
    // Get schedule config for shift information
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const scheduleConfig = await ScheduleConfig.getSingleton();
    if (!scheduleConfig) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo. Vui lòng liên hệ admin để thiết lập.');
    }
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination - support negative pages for historical data
    const periods = [];
    for (let i = 0; i < limit; i++) {
      // For page 1: periodIndex = 0, 1, 2... (current and future)
      // For page -1: periodIndex = -limit, -limit+1, ... -1 (past periods)  
      // For page 2: periodIndex = limit, limit+1, ... (further future)
      let periodIndex;
      if (page >= 1) {
        periodIndex = (page - 1) * limit + i;
      } else {
        // Negative pages: page -1 means indices -limit to -1, page -2 means -2*limit to -limit-1
        periodIndex = page * limit + i;
      }
      
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

    // Query slots where this dentist is assigned
    const queryFilter = {
      dentist: dentistId,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for dentist details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const dentist = users.find(u => u._id === dentistId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    
    // Group slots by date and shift
    const calendar = {};
    const appointmentCounts = {}; // Track unique appointments
    const roomStats = {}; // Track room frequency by date and shift
    
    for (const slot of slots) {
      // Convert to Vietnam date
      const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      
      if (!calendar[slotDateVN]) {
        calendar[slotDateVN] = {
          date: slotDateVN,
          shifts: {
            'Ca Sáng': { appointmentCount: 0, totalSlots: 0 },
            'Ca Chiều': { appointmentCount: 0, totalSlots: 0 },
            'Ca Tối': { appointmentCount: 0, totalSlots: 0 }
          },
          totalAppointments: 0,
          totalSlots: 0
        };
        appointmentCounts[slotDateVN] = new Set();
        roomStats[slotDateVN] = {
          'Ca Sáng': { rooms: {} },
          'Ca Chiều': { rooms: {} },
          'Ca Tối': { rooms: {} }
        };
      }
      
      const shift = calendar[slotDateVN].shifts[slot.shiftName];
      const shiftRoomStats = roomStats[slotDateVN][slot.shiftName];
      
      if (shift && shiftRoomStats) {
        shift.totalSlots++;
        calendar[slotDateVN].totalSlots++;
        
        // Count unique appointments
        if (slot.appointmentId) {
          appointmentCounts[slotDateVN].add(slot.appointmentId);
          shift.appointmentCount++;
        }
        
        // Track room frequency
        const roomKey = slot.roomId + (slot.subRoomId ? `_${slot.subRoomId}` : '');
        if (!shiftRoomStats.rooms[roomKey]) {
          shiftRoomStats.rooms[roomKey] = 0;
        }
        shiftRoomStats.rooms[roomKey]++;
        
        // ⭐ NO LONGER adding individual slot details - only counting
      }
    }
    
    // Update total appointment counts
    for (const date in appointmentCounts) {
      calendar[date].totalAppointments = appointmentCounts[date].size;
    }
    
    // Convert calendar object to array and sort by date
    const calendarArray = Object.values(calendar);
    calendarArray.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Group calendar data by periods (similar to room calendar)
    const calendarPeriods = periods.map((period, index) => {
      const periodCalendar = {};
      
      // Format dates properly for local timezone
      const periodStartStr = period.start.getFullYear() + '-' + 
        String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.start.getDate()).padStart(2, '0');
      const periodEndStr = period.end.getFullYear() + '-' + 
        String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.end.getDate()).padStart(2, '0');
      
      // Filter days within this period
      calendarArray.forEach(day => {
        if (day.date >= periodStartStr && day.date <= periodEndStr) {
          periodCalendar[day.date] = day;
        }
      });
      
      // Add room statistics for each day in this period
      const daysInPeriod = Object.values(periodCalendar).map(day => {
        const dayStats = roomStats[day.date];
        
        // Add most frequent room for each shift
        for (const shiftName of ['Ca Sáng', 'Ca Chiều', 'Ca Tối']) {
          const shiftStat = dayStats[shiftName];
          let mostFrequentRoom = null;
          
          if (Object.keys(shiftStat.rooms).length > 0) {
            const topRoomKey = Object.entries(shiftStat.rooms)
              .reduce((a, b) => a[1] > b[1] ? a : b)[0];
            
            const [roomId, subRoomId] = topRoomKey.split('_');
            const room = rooms.find(r => r._id === roomId);
            
            if (room) {
              mostFrequentRoom = {
                id: roomId,
                name: room.name,
                slotCount: shiftStat.rooms[topRoomKey]
              };
              
              if (subRoomId && room.subRooms) {
                const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
                if (subRoom) {
                  mostFrequentRoom.subRoom = {
                    id: subRoom._id,
                    name: subRoom.name
                  };
                }
              }
            }
          }
          
          day.shifts[shiftName].mostFrequentRoom = mostFrequentRoom;
        }
        
        return day;
      }).sort((a, b) => a.date.localeCompare(b.date));
      
      return {
        periodIndex: (page - 1) * limit + index + 1,
        startDate: periodStartStr,
        endDate: periodEndStr,
        viewType,
        totalDays: daysInPeriod.length,
        days: daysInPeriod
      };
    });
    
    return {
      dentist: dentist ? { id: dentist._id, name: dentist.name } : { id: dentistId, name: 'Nha sỹ không xác định' },
      viewType,
      pagination: {
        page,
        limit,
        hasNext: true, // Always allow going to future
        hasPrev: true, // Always allow going to past for dentist calendar
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch nha sỹ: ${error.message}`);
  }
}

// Reassign staff to slots that already have staff assigned (based on assignStaffToSlots logic)
async function reassignStaffToSlots({
  roomId,
  subRoomId = null,
  quarter = null,
  year = null,
  shifts = [], // Array of shift names: ['Ca Sáng', 'Ca Chiều', 'Ca Tối']
  dentistIds = [],
  nurseIds = []
}) {
  try {
    // Validate input: require quarter/year for quarter-level assignment
    if (!roomId || !quarter || !year) {
      throw new Error('Room ID, quarter và year là bắt buộc để phân công lại theo quý');
    }

    if (shifts.length === 0) {
      throw new Error('Phải chọn ít nhất 1 ca làm việc');
    }

    // Validate quarter/year is not in the past
    validateQuarterYear(quarter, year);
    
    // Validate staff assignment based on room type
    await validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds);
    
    // Resolve all schedules for the given quarter/year for this room
    const { getQuarterDateRange } = require('./schedule.service');
    const { startDate, endDate } = getQuarterDateRange(quarter, year);
    const schedules = await require('../repositories/schedule.repository').findByRoomAndDateRange(roomId, startDate, endDate);
    const scheduleIds = schedules.map(s => s._id);
    if (!scheduleIds || scheduleIds.length === 0) {
      throw new Error(`Không tìm thấy lịch làm việc nào cho phòng trong quý ${quarter}/${year}. Vui lòng tạo lịch làm việc trước khi phân công lại nhân sự.`);
    }

    // Get current time in Vietnam timezone for filtering future slots only
    const vietnamNow = getVietnamDate();

    // Build query filter: all slots in those schedules THAT ALREADY HAVE STAFF
    // and are in the future (startTime > current Vietnam time)
    const queryFilter = { 
      roomId, 
      scheduleId: { $in: scheduleIds }, 
      isActive: true,
      startTime: { $gt: vietnamNow }, // Only future slots
      // ⭐ KEY DIFFERENCE: Only slots that already have dentist OR nurse assigned
      $or: [
        { dentist: { $exists: true, $ne: null } },
        { nurse: { $exists: true, $ne: null } }
      ]
    };
    if (shifts && shifts.length) queryFilter.shiftName = { $in: shifts };
    if (subRoomId) queryFilter.subRoomId = subRoomId; else queryFilter.subRoomId = null;

    const slots = await slotRepo.find(queryFilter);
    
    if (slots.length === 0) {
      // Kiểm tra các nguyên nhân có thể xảy ra
      const room = await getRoomInfo(roomId);
      let foundSubRoom = null; // Khai báo biến để sử dụng trong error messages
      
      // 1. Kiểm tra logic subRoom
      if (subRoomId) {
        // User truyền subRoomId nhưng phòng không có subRoom
        if (!room.subRooms || room.subRooms.length === 0) {
          throw new Error(`Phòng "${room.name}" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác.`);
        }
        
        // subRoomId không thuộc phòng này
        foundSubRoom = room.subRooms.find(sr => sr._id && sr._id.toString() === subRoomId.toString());
        if (!foundSubRoom) {
          throw new Error(`SubRoom không thuộc về phòng "${room.name}". Vui lòng kiểm tra lại subRoomId.`);
        }
      } else {
        // User không truyền subRoomId nhưng phòng có subRoom
        if (room.subRooms && room.subRooms.length > 0) {
          const activeSubRooms = room.subRooms.filter(sr => sr.isActive !== false);
          throw new Error(`Phòng "${room.name}" có ${activeSubRooms.length} subroom. Vui lòng chỉ định subRoomId cụ thể: ${activeSubRooms.map(sr => `${sr._id} (${sr.name})`).join(', ')}`);
        }
      }
      
      // 2. Kiểm tra slot đã có nhân sự
      const assignedQuery = {
        roomId,
        scheduleId: { $in: scheduleIds },
        isActive: true,
        startTime: { $gt: vietnamNow },
        $or: [
          { dentist: { $exists: true, $ne: null } },
          { nurse: { $exists: true, $ne: null } }
        ]
      };
      if (shifts && shifts.length) assignedQuery.shiftName = { $in: shifts };
      if (subRoomId) assignedQuery.subRoomId = subRoomId; else assignedQuery.subRoomId = null;
      
      const assignedSlots = await slotRepo.find(assignedQuery);
      
      if (assignedSlots.length === 0) {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        throw new Error(`Không có slot nào đã được phân công nhân sự trong quý ${quarter}/${year} cho ${roomDisplay}. Sử dụng API assign-staff để phân công mới.`);
      } else {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        const shiftDisplay = shifts.length > 0 ? ` ca "${shifts.join(', ')}"` : '';
        throw new Error(`Không tìm thấy slot phù hợp để phân công lại trong quý ${quarter}/${year} cho ${roomDisplay}${shiftDisplay}. Có ${assignedSlots.length} slot đã có nhân sự nhưng không match yêu cầu.`);
      }
    }
    
    // Build update object
    const updateData = {};
    if (dentistIds.length > 0) updateData.dentist = dentistIds[0];
    if (nurseIds.length > 0) updateData.nurse = nurseIds[0];

    let updatedSlots = [];
    if (Object.keys(updateData).length > 0) {
      // Before applying updates, check for conflicts per slot
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
      
      // 🔄 Mark entities as used when successfully reassigned
      await markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds });
    }
    
    // Clear cache - best effort
    try {
      await redisClient.del('slots:*');
    } catch (cacheError) {
      console.warn('Could not clear slot cache:', cacheError);
    }
    
    return {
      message: `Đã phân công lại thành công ${updatedSlots.length} slot`,
      updatedCount: updatedSlots.length,
      quarter,
      year,
      shifts: shifts.join(', '),
      dentistAssigned: dentistIds[0] || null,
      nurseAssigned: nurseIds[0] || null
    };
    
  } catch (error) {
    throw error;
  }
}

// Get nurse calendar with appointment counts (daily/weekly/monthly view) with historical support  
async function getNurseCalendar({ nurseId, viewType, startDate = null, page = 1, limit = 10 }) {
  try {
    // Get schedule config for shift information
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const scheduleConfig = await ScheduleConfig.getSingleton();
    if (!scheduleConfig) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo. Vui lòng liên hệ admin để thiết lập.');
    }
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination - support negative pages for historical data
    const periods = [];
    for (let i = 0; i < limit; i++) {
      // For page 1: periodIndex = 0, 1, 2... (current and future)
      // For page -1: periodIndex = -limit, -limit+1, ... -1 (past periods)  
      // For page 2: periodIndex = limit, limit+1, ... (further future)
      let periodIndex;
      if (page >= 1) {
        periodIndex = (page - 1) * limit + i;
      } else {
        // Negative pages: page -1 means indices -limit to -1, page -2 means -2*limit to -limit-1
        periodIndex = page * limit + i;
      }
      
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

    // Query slots where this nurse is assigned
    const queryFilter = {
      nurse: nurseId,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for nurse details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const nurse = users.find(u => u._id === nurseId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    
    // Group slots by date and shift
    const calendar = {};
    const appointmentCounts = {}; // Track unique appointments
    const roomStats = {}; // Track room frequency by date and shift
    
    for (const slot of slots) {
      // Convert to Vietnam date
      const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      
      if (!calendar[slotDateVN]) {
        calendar[slotDateVN] = {
          date: slotDateVN,
          shifts: {
            'Ca Sáng': { appointmentCount: 0, totalSlots: 0 },
            'Ca Chiều': { appointmentCount: 0, totalSlots: 0 },
            'Ca Tối': { appointmentCount: 0, totalSlots: 0 }
          },
          totalAppointments: 0,
          totalSlots: 0
        };
        appointmentCounts[slotDateVN] = new Set();
        roomStats[slotDateVN] = {
          'Ca Sáng': { rooms: {} },
          'Ca Chiều': { rooms: {} },
          'Ca Tối': { rooms: {} }
        };
      }
      
      const shift = calendar[slotDateVN].shifts[slot.shiftName];
      const shiftRoomStats = roomStats[slotDateVN][slot.shiftName];
      
      if (shift && shiftRoomStats) {
        shift.totalSlots++;
        calendar[slotDateVN].totalSlots++;
        
        // Count unique appointments
        if (slot.appointmentId) {
          appointmentCounts[slotDateVN].add(slot.appointmentId);
          shift.appointmentCount++;
        }
        
        // Track room frequency
        const roomKey = slot.roomId + (slot.subRoomId ? `_${slot.subRoomId}` : '');
        if (!shiftRoomStats.rooms[roomKey]) {
          shiftRoomStats.rooms[roomKey] = 0;
        }
        shiftRoomStats.rooms[roomKey]++;
        
        // ⭐ NO LONGER adding individual slot details - only counting
      }
    }
    
    // Update total appointment counts
    for (const date in appointmentCounts) {
      calendar[date].totalAppointments = appointmentCounts[date].size;
    }
    
    // Convert calendar object to array and sort by date
    const calendarArray = Object.values(calendar);
    calendarArray.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Group calendar data by periods (similar to room calendar)
    const calendarPeriods = periods.map((period, index) => {
      const periodCalendar = {};
      
      // Format dates properly for local timezone
      const periodStartStr = period.start.getFullYear() + '-' + 
        String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.start.getDate()).padStart(2, '0');
      const periodEndStr = period.end.getFullYear() + '-' + 
        String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.end.getDate()).padStart(2, '0');
      
      // Filter days within this period
      calendarArray.forEach(day => {
        if (day.date >= periodStartStr && day.date <= periodEndStr) {
          periodCalendar[day.date] = day;
        }
      });
      
      // Add room statistics for each day in this period
      const daysInPeriod = Object.values(periodCalendar).map(day => {
        const dayStats = roomStats[day.date];
        
        // Add most frequent room for each shift
        for (const shiftName of ['Ca Sáng', 'Ca Chiều', 'Ca Tối']) {
          const shiftStat = dayStats[shiftName];
          let mostFrequentRoom = null;
          
          if (Object.keys(shiftStat.rooms).length > 0) {
            const topRoomKey = Object.entries(shiftStat.rooms)
              .reduce((a, b) => a[1] > b[1] ? a : b)[0];
            
            const [roomId, subRoomId] = topRoomKey.split('_');
            const room = rooms.find(r => r._id === roomId);
            
            if (room) {
              mostFrequentRoom = {
                id: roomId,
                name: room.name,
                slotCount: shiftStat.rooms[topRoomKey]
              };
              
              if (subRoomId && room.subRooms) {
                const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
                if (subRoom) {
                  mostFrequentRoom.subRoom = {
                    id: subRoom._id,
                    name: subRoom.name
                  };
                }
              }
            }
          }
          
          day.shifts[shiftName].mostFrequentRoom = mostFrequentRoom;
        }
        
        return day;
      }).sort((a, b) => a.date.localeCompare(b.date));
      
      return {
        periodIndex: (page - 1) * limit + index + 1,
        startDate: periodStartStr,
        endDate: periodEndStr,
        viewType,
        totalDays: daysInPeriod.length,
        days: daysInPeriod
      };
    });
    
    return {
      nurse: nurse ? { id: nurse._id, name: nurse.name } : { id: nurseId, name: 'Y tá không xác định' },
      viewType,
      pagination: {
        page,
        limit,
        hasNext: true, // Always allow going to future
        hasPrev: true, // Always allow going to past for nurse calendar
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch y tá: ${error.message}`);
  }
}

// ⭐ NEW: Get slot details for a specific room/day/shift
async function getRoomSlotDetails({ roomId, subRoomId = null, date, shiftName }) {
  try {
    // Validate shift name
    const validShifts = ['Ca Sáng', 'Ca Chiều', 'Ca Tối'];
    if (!validShifts.includes(shiftName)) {
      throw new Error('shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối');
    }

    // ⭐ Get rooms cache to check if room has subrooms
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    const room = rooms.find(r => r._id === roomId);
    
    if (!room) {
      throw new Error('Không tìm thấy phòng');
    }

    // ⭐ Validate subRoomId based on hasSubRooms
    if (room.hasSubRooms) {
      // Phòng có subrooms: bắt buộc phải có subRoomId
      if (!subRoomId) {
        throw new Error('Phòng có buồng con phải cung cấp subRoomId');
      }
      // Kiểm tra subRoomId có tồn tại không
      const subRoom = room.subRooms?.find(sr => sr._id === subRoomId);
      if (!subRoom) {
        throw new Error('Không tìm thấy buồng con trong phòng này');
      }
    } else {
      // Phòng không có subrooms: không được có subRoomId
      if (subRoomId) {
        throw new Error('Phòng không có buồng con không được cung cấp subRoomId');
      }
    }

    // Parse date and create UTC range for the full day
    const targetDate = new Date(date);
    const startUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      roomId,
      shiftName,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };
    
    if (room.hasSubRooms) {
      queryFilter.subRoomId = subRoomId;
    } else {
      queryFilter.subRoomId = null;
    }

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for staff details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    
    // Build room info
    let roomInfo = {
      id: room._id,
      name: room.name,
      hasSubRooms: room.hasSubRooms
    };
    
    if (room.hasSubRooms && subRoomId) {
      const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
      if (subRoom) {
        roomInfo.subRoom = {
          id: subRoom._id,
          name: subRoom.name
        };
      }
    }

    // Format slot details
    const slotDetails = slots.map(slot => {
      const dentist = slot.dentist ? users.find(u => u._id === slot.dentist) : null;
      const nurse = slot.nurse ? users.find(u => u._id === slot.nurse) : null;
      
      return {
        slotId: slot._id,
        startTime: slot.startTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTime: slot.endTime,
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        dentist: dentist ? { id: dentist._id, name: dentist.name } : null,
        nurse: nurse ? { id: nurse._id, name: nurse.name } : null,
        hasStaff: !!(slot.dentist && slot.nurse),
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null
      };
    });

    return {
      roomInfo,
      date,
      shiftName,
      totalSlots: slotDetails.length,
      bookedSlots: slotDetails.filter(s => s.isBooked).length,
      availableSlots: slotDetails.filter(s => !s.isBooked && s.hasStaff).length,
      slots: slotDetails
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy chi tiết slot phòng: ${error.message}`);
  }
}

// ⭐ NEW: Get slot details for a specific dentist/day/shift
async function getDentistSlotDetails({ dentistId, date, shiftName }) {
  try {
    // Validate shift name
    const validShifts = ['Ca Sáng', 'Ca Chiều', 'Ca Tối'];
    if (!validShifts.includes(shiftName)) {
      throw new Error('shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối');
    }

    // Parse date and create UTC range for the full day
    const targetDate = new Date(date);
    const startUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      dentist: dentistId,
      shiftName,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const dentist = users.find(u => u._id === dentistId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];

    // Format slot details
    const slotDetails = slots.map(slot => {
      const nurse = slot.nurse ? users.find(u => u._id === slot.nurse) : null;
      const room = rooms.find(r => r._id === slot.roomId);
      let roomInfo = room ? { id: room._id, name: room.name } : { id: slot.roomId, name: 'Phòng không xác định' };
      
      if (slot.subRoomId && room && room.subRooms) {
        const subRoom = room.subRooms.find(sr => sr._id === slot.subRoomId);
        if (subRoom) {
          roomInfo.subRoom = { id: subRoom._id, name: subRoom.name };
        }
      }
      
      return {
        slotId: slot._id,
        startTime: slot.startTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTime: slot.endTime,
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        room: roomInfo,
        nurse: nurse ? { id: nurse._id, name: nurse.name } : null,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null
      };
    });

    return {
      dentist: dentist ? { id: dentist._id, name: dentist.name } : { id: dentistId, name: 'Nha sỹ không xác định' },
      date,
      shiftName,
      totalSlots: slotDetails.length,
      bookedSlots: slotDetails.filter(s => s.isBooked).length,
      availableSlots: slotDetails.filter(s => !s.isBooked).length,
      slots: slotDetails
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy chi tiết slot nha sỹ: ${error.message}`);
  }
}

// ⭐ NEW: Get slot details for a specific nurse/day/shift
async function getNurseSlotDetails({ nurseId, date, shiftName }) {
  try {
    // Validate shift name
    const validShifts = ['Ca Sáng', 'Ca Chiều', 'Ca Tối'];
    if (!validShifts.includes(shiftName)) {
      throw new Error('shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối');
    }

    // Parse date and create UTC range for the full day
    const targetDate = new Date(date);
    const startUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      nurse: nurseId,
      shiftName,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const nurse = users.find(u => u._id === nurseId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];

    // Format slot details
    const slotDetails = slots.map(slot => {
      const dentist = slot.dentist ? users.find(u => u._id === slot.dentist) : null;
      const room = rooms.find(r => r._id === slot.roomId);
      let roomInfo = room ? { id: room._id, name: room.name } : { id: slot.roomId, name: 'Phòng không xác định' };
      
      if (slot.subRoomId && room && room.subRooms) {
        const subRoom = room.subRooms.find(sr => sr._id === slot.subRoomId);
        if (subRoom) {
          roomInfo.subRoom = { id: subRoom._id, name: subRoom.name };
        }
      }
      
      return {
        slotId: slot._id,
        startTime: slot.startTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTime: slot.endTime,
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        room: roomInfo,
        dentist: dentist ? { id: dentist._id, name: dentist.name } : null,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null
      };
    });

    return {
      nurse: nurse ? { id: nurse._id, name: nurse.name } : { id: nurseId, name: 'Y tá không xác định' },
      date,
      shiftName,
      totalSlots: slotDetails.length,
      bookedSlots: slotDetails.filter(s => s.isBooked).length,
      availableSlots: slotDetails.filter(s => !s.isBooked).length,
      slots: slotDetails
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy chi tiết slot y tá: ${error.message}`);
  }
}

module.exports = {
  assignStaffToSlots,
  reassignStaffToSlots,
  updateSlotStaff,
  getSlotsByShiftAndDate,
  getRoomCalendar,
  getDentistCalendar,
  getNurseCalendar,
  getRoomSlotDetails,
  getDentistSlotDetails,
  getNurseSlotDetails,
  getVietnamDate,
  validateStaffIds,
  getAvailableQuartersYears,
  getAvailableShifts,
  getCurrentQuarterInfo
};
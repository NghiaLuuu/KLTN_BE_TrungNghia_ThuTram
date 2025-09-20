const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');

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

// Update staff for specific slots
async function updateSlotStaff(slotId, { dentistId, nurseId, groupSlotIds = null }) {
  try {
    const slot = await slotRepo.findById(slotId);
    if (!slot) {
      throw new Error('Không tìm thấy slot');
    }
    
    // Check if slot is booked
    if (slot.isBooked) {
      throw new Error('Không thể thay đổi nhân sự cho slot đã được đặt');
    }
    
    // Validate staff assignment
    const dentistIds = dentistId ? [dentistId] : [];
    const nurseIds = nurseId ? [nurseId] : [];
    await validateStaffAssignment(slot.roomId, slot.subRoomId, dentistIds, nurseIds);
    
    const updateData = {};

    // If groupSlotIds provided -> perform atomic update for those slots (appointment or not)
    if (Array.isArray(groupSlotIds) && groupSlotIds.length > 0) {
      // Load provided slots and validate they belong to the same room/subRoom
      const provided = groupSlotIds.map(id => id.toString());
      const targetSlots = await slotRepo.find({ _id: { $in: provided } });
      if (targetSlots.length !== provided.length) {
        throw new Error('Một số slot trong groupSlotIds không tồn tại');
      }

      // Ensure all slots are updatable (not booked)
      for (const s of targetSlots) {
        if (s.isBooked) throw new Error('Không thể cập nhật nhóm vì có slot đã được đặt');
      }

      // Validate staff assignment across first slot's room/subRoom (assume same)
      const first = targetSlots[0];
      const dentistIds = dentistId ? [dentistId] : [];
      const nurseIds = nurseId ? [nurseId] : [];
      await validateStaffAssignment(first.roomId, first.subRoomId, dentistIds, nurseIds);

      // Conflict check per slot: ensure dentist/nurse not already assigned to overlapping slots in other rooms/subrooms
      const providedSet = new Set(provided);
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
          const conflict = existingByDentist.find(es => !providedSet.has(es._id.toString()) && new Date(es.startTime) < sEnd && new Date(es.endTime) > sStart);
          if (conflict) throw new Error('Nha sỹ đã được phân công vào slot khác trong cùng khoảng thời gian');
        }
        if (nurseId && existingByNurse.length) {
          const conflict = existingByNurse.find(es => !providedSet.has(es._id.toString()) && new Date(es.startTime) < sEnd && new Date(es.endTime) > sStart);
          if (conflict) throw new Error('Y tá đã được phân công vào slot khác trong cùng khoảng thời gian');
        }
      }

      if (dentistId !== undefined) updateData.dentist = dentistId;
      if (nurseId !== undefined) updateData.nurse = nurseId;

      await slotRepo.updateManySlots({ _id: { $in: provided } }, updateData);
      const updated = await slotRepo.find({ _id: { $in: provided } });

      // Clear cache for affected rooms/days (best effort)
      try {
        await Promise.all(updated.map(s => redisClient.del(`slots:room:${s.roomId}:${s.dateVN}`).catch(() => {})));
      } catch (e) {}

      return updated;
    }

    if (dentistId !== undefined) updateData.dentist = dentistId;
    if (nurseId !== undefined) updateData.nurse = nurseId;

    // Conflict check for single slot update: ensure staff not assigned to other overlapping slots
    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);
    if (dentistId) {
      const existing = await slotRepo.findByStaffId(dentistId, slotStart, slotEnd);
      const conflicts = existing.filter(es => es._id.toString() !== slotId.toString());
      if (conflicts.length > 0) throw new Error('Nha sỹ đã được phân công vào slot khác trong cùng khoảng thời gian');
    }
    if (nurseId) {
      const existing = await slotRepo.findByStaffId(nurseId, slotStart, slotEnd);
      const conflicts = existing.filter(es => es._id.toString() !== slotId.toString());
      if (conflicts.length > 0) throw new Error('Y tá đã được phân công vào slot khác trong cùng khoảng thời gian');
    }

    const updatedSlot = await slotRepo.updateById(slotId, updateData);

    // Clear cache
    try { await redisClient.del(`slots:room:${slot.roomId}:${slot.dateVN}`); } catch (e) {}

    return updatedSlot;
    
  } catch (error) {
    throw new Error(`Lỗi cập nhật nhân sự slot: ${error.message}`);
  }
}

// Get available slots for booking
async function getAvailableSlots({
  roomId,
  subRoomId = null,
  date,
  shiftName = null,
  serviceId = null
}) {
  try {
    const cacheKey = `available_slots:${roomId}:${subRoomId}:${date}:${shiftName}:${serviceId}`;
    
    // Try cache first
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const base = new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    const startOfDayVN = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
    const endOfDayVN = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59, 999);
    const startUTC = new Date(Date.UTC(startOfDayVN.getFullYear(), startOfDayVN.getMonth(), startOfDayVN.getDate(), -7, 0, 0, 0));
    const endUTC = new Date(Date.UTC(endOfDayVN.getFullYear(), endOfDayVN.getMonth(), endOfDayVN.getDate(), -7, 59, 59, 999));

    const queryFilter = {
      roomId,
      startTime: { $gte: startUTC, $lte: endUTC },
      isBooked: false,
      isActive: true
    };
    
    if (subRoomId) {
      queryFilter.subRoomId = subRoomId;
    }
    
    if (shiftName) {
      queryFilter.shiftName = shiftName;
    }
    
    // Must have both dentist and nurse assigned
    queryFilter.dentist = { $ne: null };
    queryFilter.nurse = { $ne: null };
    
    const slots = await slotRepo.find(queryFilter);
    
    // Cache for 5 minutes
    await redisClient.setex(cacheKey, 300, JSON.stringify(slots));
    
    return slots;
    
  } catch (error) {
    throw new Error(`Lỗi lấy slot khả dụng: ${error.message}`);
  }
}

// Get slots by room and date range
async function getSlotsByRoom(roomId, startDate, endDate) {
  const slots = await slotRepo.findByRoomAndDateRange(roomId, startDate, endDate);
  return slots;
}

// Get slots by staff and date range  
async function getSlotsByStaff(staffId, staffType, startDate, endDate) {
  const queryFilter = {
    startTime: { $gte: new Date(startDate), $lte: new Date(endDate) },
    isActive: true
  };
  
  if (staffType === 'dentist') {
    queryFilter.dentist = staffId;
  } else if (staffType === 'nurse') {
    queryFilter.nurse = staffId;
  } else {
    throw new Error('Staff type phải là "dentist" hoặc "nurse"');
  }
  
  const slots = await slotRepo.find(queryFilter);
  return slots;
}

module.exports = {
  assignStaffToSlots,
  updateSlotStaff,
  getAvailableSlots,
  getSlotsByRoom,
  getSlotsByStaff,
  getVietnamDate
};
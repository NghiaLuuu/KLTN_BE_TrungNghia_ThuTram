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
  
  if (subRoomId) {
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
  scheduleId = null,
  shifts = [], // Array of shift names: ['Ca Sáng', 'Ca Chiều', 'Ca Tối']
  dentistIds = [],
  nurseIds = []
}) {
  try {
    // Validate input: require scheduleId for quarter-level assignment
    if (!roomId || !scheduleId) {
      throw new Error('Room ID và scheduleId là bắt buộc để phân công theo quý');
    }

    if (shifts.length === 0) {
      throw new Error('Phải chọn ít nhất 1 ca làm việc');
    }
    
    // Validate staff assignment based on room type
    await validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds);
    
    // Build query filter: schedule-level only
    const queryFilter = { roomId, scheduleId, isActive: true };
    if (shifts && shifts.length) queryFilter.shiftName = { $in: shifts };
    if (subRoomId) queryFilter.subRoomId = subRoomId; else queryFilter.subRoomId = null;

    const slots = await slotRepo.find(queryFilter);
    
    if (slots.length === 0) {
      throw new Error('Không tìm thấy slot nào phù hợp');
    }
    
    // Appointment adjacency safety: if any slot belongs to an appointment (appointmentId), do not partially update that appointment's slots.
    const appointmentGroups = {};
    for (const s of slots) {
      if (s.appointmentId) {
        const key = s.appointmentId.toString();
        appointmentGroups[key] = appointmentGroups[key] || [];
        appointmentGroups[key].push(s);
      }
    }

    if (Object.keys(appointmentGroups).length > 0 && !scheduleId) {
      // If appointment-linked slots exist, require schedule-level assignment to change them.
      throw new Error('Một số slot đang thuộc appointment; để cập nhật các slot này vui lòng dùng thao tác theo scheduleId/shift để cập nhật toàn bộ nhóm liên quan.');
    }

    // Build update object
    const updateData = {};
    if (dentistIds.length > 0) updateData.dentist = dentistIds[0];
    if (nurseIds.length > 0) updateData.nurse = nurseIds[0];

    let updatedSlots = [];
    if (Object.keys(updateData).length > 0) {
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
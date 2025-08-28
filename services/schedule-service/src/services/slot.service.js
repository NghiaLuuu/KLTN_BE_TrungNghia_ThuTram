const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const redisClient = require('../utils/redis.client');

exports.assignStaffToSlots = async (data) => {
  const { scheduleId, subRoomId, dentistIds = [], nurseIds = [], startDate, endDate, shiftIds = [] } = data;

  // 1️⃣ Lấy schedule
  const schedule = await scheduleRepo.findById(scheduleId);
  if (!schedule) throw new Error('Schedule not found');

  // 2️⃣ Lấy room từ cache
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Room cache not found');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id === String(schedule.roomId));
  if (!room) throw new Error('Room not found in cache');

  // 3️⃣ Kiểm tra subRoomId
  const subRoom = room.subRooms.find(sr => sr._id === String(subRoomId));
  if (!subRoom) throw new Error(`SubRoom ${subRoomId} not found in Room ${room._id}`);


  // 4️⃣ Lấy shift từ Redis cache
  let shiftTimes = [];
  if (shiftIds.length > 0) {
    const shiftCache = await redisClient.get('shifts_cache');
    if (!shiftCache) throw new Error('Shift cache not found');
    const shifts = JSON.parse(shiftCache);

    // Lọc shift hợp lệ
    const validShifts = shifts.filter(s => shiftIds.includes(s._id));
    if (validShifts.length !== shiftIds.length) {
      const invalid = shiftIds.filter(id => !validShifts.some(s => s._id === id));
      throw new Error(`Invalid shiftIds: ${invalid.join(', ')}`);
    }

    // Lấy start/end time
    shiftTimes = validShifts.map(s => ({
      start: s.startTime,
      end: s.endTime
    }));
  }

  // 5️⃣ Kiểm tra số lượng bác sĩ / y tá không vượt quá subRoom
  if (dentistIds.length > subRoom.maxDoctors) {
    throw new Error(`Dentist limit exceeded in subRoom ${subRoom._id}: max ${subRoom.maxDoctors}`);
  }
  if (nurseIds.length > subRoom.maxNurses) {
    throw new Error(`Nurse limit exceeded in subRoom ${subRoom._id}: max ${subRoom.maxNurses}`);
  }

  // 6️⃣ Lấy tất cả slot theo scheduleId + subRoomId + date range
  const filter = {
    scheduleId,
    subRoomId,
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  };


  let slots = await slotRepo.findSlots(filter);
  if (!slots.length) throw new Error('No slots found for given conditions');

  // 7️⃣ Lọc slot dựa trên shiftTimes
  if (shiftTimes.length > 0) {
    slots = slots.filter(slot => {
      const slotStart = new Date(slot.startTime);
      const slotEnd = new Date(slot.endTime);
      return shiftTimes.some(shift => {
        const [shiftStartH, shiftStartM] = shift.start.split(':').map(Number);
        const [shiftEndH, shiftEndM] = shift.end.split(':').map(Number);

        const shiftStartTime = new Date(slotStart);
        shiftStartTime.setHours(shiftStartH, shiftStartM, 0, 0);

        const shiftEndTime = new Date(slotStart);
        shiftEndTime.setHours(shiftEndH, shiftEndM, 0, 0);

        return slotStart >= shiftStartTime && slotEnd <= shiftEndTime;
      });
    });
    if (!slots.length) throw new Error('No slots found within the given shift times');
  }

  // 8️⃣ Kiểm tra conflict với dentist/nurse trong cùng thời gian
  for (const slot of slots) {
    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);

    // Lấy tất cả slot khác của schedule (không phải slot đang gán)
    const otherSlots = await slotRepo.findSlots({
      scheduleId,
      _id: { $ne: slot._id }
    });

    // Kiểm tra xung đột nha sĩ
    const dentistConflict = dentistIds.filter(dId =>
      otherSlots.some(s =>
        s.dentistId.includes(dId) &&
        new Date(s.startTime) < slotEnd &&
        new Date(s.endTime) > slotStart
      )
    );
    if (dentistConflict.length) {
      throw new Error(`Dentist(s) ${dentistConflict.join(', ')} already assigned in overlapping slot`);
    }

    // Kiểm tra xung đột y tá
    const nurseConflict = nurseIds.filter(nId =>
      otherSlots.some(s =>
        s.nurseId.includes(nId) &&
        new Date(s.startTime) < slotEnd &&
        new Date(s.endTime) > slotStart
      )
    );
    if (nurseConflict.length) {
      throw new Error(`Nurse(s) ${nurseConflict.join(', ')} already assigned in overlapping slot`);
    }
  }

  // 9️⃣ Cập nhật slot
  const slotIds = slots.map(s => s._id);
  await slotRepo.updateManySlots({ _id: { $in: slotIds } }, {
    dentistId: dentistIds,
    nurseId: nurseIds
  });

  return { updatedCount: slots.length };
};


// Lấy danh sách slot theo filter
exports.getSlots = async (filter) => {
  return await slotRepo.findSlots(filter);
};

// Lấy chi tiết slot
exports.getSlotById = async (slotId) => {
  const slot = await slotRepo.findById(slotId);
  if (!slot) throw new Error('Slot not found');
  return slot;
};






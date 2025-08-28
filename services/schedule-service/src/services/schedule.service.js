const scheduleRepo = require('../repositories/schedule.repository');
const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');

// 🔧 Check conflict chung
async function checkScheduleConflict(roomId, shiftIds, startDate, endDate, excludeId = null) {
  const filter = {
    roomId,
    shiftIds: { $in: shiftIds },
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

// 🔧 Core: chỉ sinh danh sách slots (chưa save DB)
async function generateSlotsCore(scheduleId, subRoomId, shiftIds, slotDuration, startDate, endDate) {
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Shift cache not found');
  const shifts = JSON.parse(shiftCache);
  const selectedShifts = shifts.filter(s => shiftIds.includes(s._id.toString()));
  if (!selectedShifts.length) return [];

  const slots = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (const shift of selectedShifts) {
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      const shiftStart = new Date(d); shiftStart.setHours(startHour, startMinute, 0, 0);
      const shiftEnd = new Date(d); shiftEnd.setHours(endHour, endMinute, 0, 0);

      for (let cur = new Date(shiftStart); cur < shiftEnd;) {
        const next = new Date(cur.getTime() + slotDuration * 60000);
        if (next > shiftEnd) break;
        slots.push({
          date: new Date(d),
          startTime: new Date(cur),
          endTime: next,
          scheduleId,
          subRoomId
        });
        cur = next;
      }
    }
  }
  return slots;
}

// 🔧 Wrapper: sinh + lưu DB
async function generateSlotsAndSave(scheduleId, subRoomId, shiftIds, slotDuration, startDate, endDate) {
  const slots = await generateSlotsCore(scheduleId, subRoomId, shiftIds, slotDuration, startDate, endDate);
  if (!slots.length) return [];
  const inserted = await slotRepo.insertMany(slots);
  return inserted.map(s => s._id);
}

// ✅ Tạo schedule
exports.createSchedule = async (data) => {
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Room cache not found');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id.toString() === data.roomId.toString());
  if (!room) throw new Error('Room not found');

  const conflict = await checkScheduleConflict(data.roomId, data.shiftIds, data.startDate, data.endDate);
  if (conflict) throw new Error(`Conflict: trùng với schedule ${conflict._id}`);

  const schedule = await scheduleRepo.createSchedule({
    roomId: room._id,
    startDate: data.startDate,
    endDate: data.endDate,
    shiftIds: data.shiftIds,
    slotDuration: data.slotDuration
  });

  let allSlotIds = [];
  for (const subRoom of room.subRooms) {
    const slotIds = await generateSlotsAndSave(schedule._id, subRoom._id, data.shiftIds, data.slotDuration, data.startDate, data.endDate);
    allSlotIds = allSlotIds.concat(slotIds);
  }

  schedule.slots = allSlotIds;
  await schedule.save();
  return schedule;
};

// ✅ Update schedule
// ✅ Update schedule
exports.updateSchedule = async (id, data) => {
  const schedule = await scheduleRepo.findById(id);
  if (!schedule) throw new Error('Schedule not found');

  // Không cho phép update shiftIds
  if (data.shiftIds && data.shiftIds.toString() !== schedule.shiftIds.toString()) {
    throw new Error('Cannot update shiftIds. To change shifts, create a new schedule.');
  }

  // Không cho phép update startDate/endDate
  if (data.startDate || data.endDate) {
    const oldStart = new Date(schedule.startDate);
    const oldEnd = new Date(schedule.endDate);
    const newStart = data.startDate ? new Date(data.startDate) : oldStart;
    const newEnd = data.endDate ? new Date(data.endDate) : oldEnd;

    if (newStart.getTime() !== oldStart.getTime() || newEnd.getTime() !== oldEnd.getTime()) {
      throw new Error('Cannot change schedule dates. To create new dates, use createSchedule.');
    }
  }

  const slotDurationChanged = data.slotDuration && data.slotDuration !== schedule.slotDuration;

  if (slotDurationChanged) {
    // 1️⃣ Xóa tất cả slot cũ
    await slotRepo.deleteMany({ scheduleId: schedule._id });
    schedule.slots = [];

    // 2️⃣ Lấy room từ cache
    const roomCache = await redisClient.get('rooms_cache');
    if (!roomCache) throw new Error('Room cache not found');
    const rooms = JSON.parse(roomCache);
    const room = rooms.find(r => r._id.toString() === schedule.roomId.toString());

    // 3️⃣ Sinh slot mới cho tất cả subRoom
    let allSlotIds = [];
    for (const subRoom of room.subRooms) {
      const slotIds = await generateSlotsAndSave(
        schedule._id,
        subRoom._id,
        schedule.shiftIds,        // giữ nguyên shiftIds
        data.slotDuration,        // slotDuration mới
        schedule.startDate,
        schedule.endDate
      );
      allSlotIds = allSlotIds.concat(slotIds);
    }

    schedule.slots = allSlotIds;
    schedule.slotDuration = data.slotDuration;
  }

  // Cập nhật các trường khác (status, note, name…)
  const allowedFields = ['status', 'note', 'name'];
  for (const field of allowedFields) {
    if (data[field] !== undefined) schedule[field] = data[field];
  }

  await schedule.save();
  return schedule;
};


// ✅ Tạo slot cho 1 subRoom
exports.createSlotsForSubRoom = async (scheduleId, subRoomId, overrides = {}) => {
  const schedule = await scheduleRepo.findById(scheduleId);
  if (!schedule) throw new Error('Schedule not found');

  const slotIds = await generateSlotsAndSave(
    scheduleId,
    subRoomId,
    overrides.shiftIds || schedule.shiftIds,
    overrides.slotDuration || schedule.slotDuration,
    overrides.startDate || schedule.startDate,
    overrides.endDate || schedule.endDate
  );

  schedule.slots = schedule.slots.concat(slotIds);
  await schedule.save();

  return { schedule, createdSlotIds: slotIds };
};  


// ✅ Toggle status
exports.toggleStatus = async (id) => {
  const schedule = await scheduleRepo.findById(id);
  if (!schedule) throw new Error('Schedule not found');

  schedule.status = schedule.status === 'active' ? 'inactive' : 'active';
  await schedule.save();

  return schedule;
};



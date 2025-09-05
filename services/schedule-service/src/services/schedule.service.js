const scheduleRepo = require('../repositories/schedule.repository');
const slotRepo = require('../repositories/slot.repository');
const redisClient = require('../utils/redis.client');

// Helper: kiểm tra ngày hợp lệ
function validateDates(startDate, endDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // so sánh từ đầu ngày

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start < today) {
    throw new Error('Ngày bắt đầu phải từ hôm nay trở đi');
  }
  if (end < start) {
    throw new Error('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu');
  }
}


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
  if (!shiftCache) throw new Error('Không tìm thấy bộ nhớ đệm ca/kíp');
  const shifts = JSON.parse(shiftCache);
  const selectedShifts = shifts.filter(s => shiftIds.includes(s._id.toString()));
  if (!selectedShifts.length) return [];

  const slots = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const now = new Date();
  const minStart = new Date(now.getTime() + 5 * 60000); // sau 5 phút

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (const shift of selectedShifts) {
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      const shiftStart = new Date(d);
      shiftStart.setHours(startHour, startMinute, 0, 0);

      const shiftEnd = new Date(d);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // ✅ Nếu ca đã kết thúc hoàn toàn → bỏ qua
      if (shiftEnd <= now) continue;

      for (let cur = new Date(shiftStart); cur < shiftEnd;) {
        const next = new Date(cur.getTime() + slotDuration * 60000);
        if (next > shiftEnd) break;

        // ✅ Chỉ tạo slot bắt đầu sau 5 phút kể từ hiện tại
        if (cur >= minStart) {
          slots.push({
            date: new Date(d),
            startTime: new Date(cur),
            endTime: next,
            scheduleId,
            subRoomId
          });
        }

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
  if (!roomCache) throw new Error('Không tìm thấy bộ nhớ đệm phòng');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id.toString() === data.roomId.toString());
  if (!room) throw new Error('Không tìm thấy phòng');

  // 🔹 Kiểm tra conflict
  const conflict = await checkScheduleConflict(data.roomId, data.shiftIds, data.startDate, data.endDate);
  if (conflict) throw new Error(`Lịch bị trùng với schedule ${conflict._id}`);

  // 🔹 Lấy shift từ cache để kiểm tra slotDuration
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Không tìm thấy bộ nhớ đệm ca/kíp');
  const shifts = JSON.parse(shiftCache);
  const selectedShifts = shifts.filter(s => data.shiftIds.includes(s._id.toString()));
  if (!selectedShifts.length) throw new Error('Không tìm thấy ca/kíp hợp lệ');

  for (const shift of selectedShifts) {
  const [startHour, startMinute] = shift.startTime.split(':').map(Number);
  const [endHour, endMinute] = shift.endTime.split(':').map(Number);

  const shiftStart = new Date();
  shiftStart.setHours(startHour, startMinute, 0, 0);

  const shiftEnd = new Date();
  shiftEnd.setHours(endHour, endMinute, 0, 0);

  // Tổng thời lượng ca (phút)
  const shiftMinutes = (endHour * 60 + endMinute) - (startHour * 60 + startMinute);

  // Thời lượng còn lại (phút) – nếu ca đang diễn ra thì tính từ "bây giờ" đến khi kết thúc
  let remainingMinutes = shiftMinutes;
  const now = new Date();
  if (now >= shiftStart && now < shiftEnd) {
    remainingMinutes = Math.floor((shiftEnd - now) / 60000);
  }

  // Nếu slotDuration quá lớn so với thời lượng còn lại
  if (data.slotDuration >= remainingMinutes) {
    throw new Error(
      `slotDuration (${data.slotDuration} phút) không hợp lệ cho ca ${shift._id}. ` +
      `Chỉ còn ${remainingMinutes} phút khả dụng trong ca này.`
    );
  }
}

  
  // ✅ Kiểm tra ngày bắt đầu và kết thúc
  validateDates(data.startDate, data.endDate);

  // 🔹 Tạo schedule
  const schedule = await scheduleRepo.createSchedule({
    roomId: room._id,
    startDate: data.startDate,
    endDate: data.endDate,
    shiftIds: data.shiftIds,
    slotDuration: data.slotDuration
  });

  // 🔹 Sinh slot cho tất cả subRoom
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
exports.updateSchedule = async (id, data) => {
  const schedule = await scheduleRepo.findById(id);
  if (!schedule) throw new Error('Không tìm thấy lịch');

  // Không cho phép update shiftIds
  if (data.shiftIds && data.shiftIds.toString() !== schedule.shiftIds.toString()) {
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

    // 🔹 Lấy shift từ cache để kiểm tra slotDuration
    const shiftCache = await redisClient.get('shifts_cache');
    if (!shiftCache) throw new Error('Không tìm thấy bộ nhớ đệm ca/kíp');
    const shifts = JSON.parse(shiftCache);
    const selectedShifts = shifts.filter(s => schedule.shiftIds.includes(s._id.toString()));

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
    schedule.slots = [];

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
        schedule.shiftIds,
        data.slotDuration,
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

// ✅ Tạo slot cho 1 subRoom, nhưng chỉ nếu chưa có slot trong khoảng ngày đó

exports.createSlotsForSubRoom = async (scheduleId, subRoomId) => {
  const schedule = await scheduleRepo.findById(scheduleId);
  if (!schedule) {
    console.log(`⚠️ Không tìm thấy lịch ${scheduleId} cho subRoom ${subRoomId}, bỏ qua`);
    return null;
  }

  const { startDate, endDate, slotDuration, shiftIds } = schedule;
  console.log(`📅 Bắt đầu tạo slot cho subRoom ${subRoomId} từ ${startDate} đến ${endDate}, slotDuration: ${slotDuration} phút`);

  // Kiểm tra subRoom đã có slot chưa
  const existingSlots = await slotRepo.findSlots({
    scheduleId,
    subRoomId,
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  if (existingSlots.length > 0) {
    console.log(`⚠️ SubRoom ${subRoomId} đã có ${existingSlots.length} slot trong khoảng ngày, bỏ qua`);
    return { schedule, createdSlotIds: [] };
  }

  // Sinh slot mới
  const slotIds = await generateSlotsAndSave(
    schedule._id,
    subRoomId,
    shiftIds,
    slotDuration,
    startDate,
    endDate
  );

  console.log(`✅ Đã tạo ${slotIds.length} slot mới cho subRoom ${subRoomId}`);

  schedule.slots = schedule.slots.concat(slotIds);
  await schedule.save();

  return { schedule, createdSlotIds: slotIds };
};





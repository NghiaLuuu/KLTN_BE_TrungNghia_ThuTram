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

// 🔹 Kiểm tra khả năng tạo slot cho tất cả subRoom
async function checkSlotsAvailability(subRooms, shiftIds, slotDuration, startDate, endDate) {
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Không tìm thấy bộ nhớ đệm ca/kíp');
  const shifts = JSON.parse(shiftCache);
  const selectedShifts = shifts.filter(s => shiftIds.includes(s._id.toString()) && s.isActive);
  if (!selectedShifts.length) throw new Error('Không tìm thấy ca/kíp hợp lệ hoặc ca/kíp không hoạt động');

  const now = new Date();
  const minStart = new Date(now.getTime() + 5 * 60000); // slot bắt đầu sau 5 phút

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
// 🔹 Sinh slot core
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
  const minStart = new Date(now.getTime() + 5 * 60000); // bắt đầu sau 5 phút

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (const shift of selectedShifts) {
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      const shiftStart = new Date(d);
      shiftStart.setHours(startHour, startMinute, 0, 0);

      const shiftEnd = new Date(d);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // Bỏ ca đã kết thúc hoàn toàn
      if (shiftEnd <= minStart) continue;

      // Bắt đầu slot từ max(shiftStart, minStart)
      let cur = shiftStart > minStart ? new Date(shiftStart) : new Date(minStart);
      let slotCreated = false;

      while (cur < shiftEnd) {
        const next = new Date(cur.getTime() + slotDuration * 60000);

        // Nếu slot không còn đủ thời lượng → break
        if (next > shiftEnd) break;

        slots.push({
          date: new Date(d),
          startTime: new Date(cur),
          endTime: next,
          scheduleId,
          subRoomId
        });

        slotCreated = true;
        cur = next;
      }

      // Nếu không tạo được slot nào trong ca → ném lỗi
      if (!slotCreated) {
        const availableMinutes = Math.floor((shiftEnd - minStart) / 60000);
        throw new Error(
          `Không thể tạo slot cho ca ${shift.name} vào ngày ${d.toISOString().split('T')[0]}. ` +
          `Thời gian còn lại sau 5 phút từ giờ hiện tại là ${availableMinutes} phút, ` +
          `không đủ cho slotDuration ${slotDuration} phút.`
        );
      }
    }
  }

  return slots;
}

// 🔹 Wrapper: sinh + lưu DB sau khi có schedule._id
async function generateSlotsAndSave(scheduleId, subRoomId, shiftIds, slotDuration, startDate, endDate) {
  // 1️⃣ Lấy cache ca/kíp
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Không tìm thấy bộ nhớ đệm ca/kíp');

  const shifts = JSON.parse(shiftCache);
  const selectedShifts = shifts.filter(s => shiftIds.includes(s._id.toString()) && s.isActive);
  if (!selectedShifts.length) return [];

  const slots = [];
  const now = new Date();
  now.setSeconds(0, 0); // Giây = 0, mili giây = 0
  const minStart = new Date(now.getTime() + 5 * 60000); // 5 phút sau giờ hiện tại

  // 2️⃣ Lặp qua từng ngày
  for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
    for (const shift of selectedShifts) {
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      // Tạo giờ bắt đầu và kết thúc ca
      const shiftStart = new Date(d);
      shiftStart.setHours(startHour, startMinute, 0, 0); // Giây = 0, mili giây = 0
      const shiftEnd = new Date(d);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // Bỏ ca đã kết thúc
      if (shiftEnd <= minStart) continue;

      // Xác định điểm bắt đầu slot: max(shiftStart, minStart)
      let cur = shiftStart > minStart ? new Date(shiftStart) : new Date(minStart);

      // 🔹 Căn phút theo slotDuration
      const remainder = cur.getMinutes() % slotDuration;
      if (remainder !== 0) {
        cur.setMinutes(cur.getMinutes() + (slotDuration - remainder));
        cur.setSeconds(0, 0);
      }

      // 3️⃣ Sinh slot
      while (cur < shiftEnd) {
        const next = new Date(cur.getTime() + slotDuration * 60000);
        next.setSeconds(0, 0); // Giây = 0
        if (next > shiftEnd) break;

        slots.push({
          date: new Date(d),
          startTime: new Date(cur),
          endTime: new Date(next),
          scheduleId,
          subRoomId
        });

        cur = next;
      }
    }
  }

  if (!slots.length) throw new Error('Không thể tạo slot sau khi check availability.');

  // 4️⃣ Lưu slot vào DB
  const inserted = await slotRepo.insertMany(slots);
  return inserted.map(s => s._id);
}




// ✅ Tạo schedule
// 🔹 Tạo schedule
exports.createSchedule = async (data) => {
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Không tìm thấy bộ nhớ đệm phòng');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id.toString() === data.roomId.toString());
  if (!room) throw new Error('Không tìm thấy phòng');
  if (!room.isActive) throw new Error(`Phòng ${room._id} hiện không hoạt động`);

  const conflict = await checkScheduleConflict(data.roomId, data.shiftIds, data.startDate, data.endDate);
  if (conflict) throw new Error(`Lịch bị trùng với schedule ${conflict._id}`);

  // Kiểm tra khả năng tạo slot cho tất cả subRoom
  await checkSlotsAvailability(room.subRooms, data.shiftIds, data.slotDuration, data.startDate, data.endDate);

  // ✅ Kiểm tra ngày bắt đầu/kết thúc
  validateDates(data.startDate, data.endDate);

  // Tạo schedule thực
  const schedule = await scheduleRepo.createSchedule({
    roomId: room._id,
    startDate: data.startDate,
    endDate: data.endDate,
    shiftIds: data.shiftIds,
    slotDuration: data.slotDuration
  });

  // Sinh slot thực cho tất cả subRoom
  let allSlotIds = [];
  for (const subRoom of room.subRooms) {
    const slotIds = await generateSlotsAndSave(
      schedule._id,
      subRoom._id,
      data.shiftIds,
      data.slotDuration,
      data.startDate,
      data.endDate
    );
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

  // ✅ Kiểm tra ngày
  validateDates(startDate, endDate);

  // ✅ Kiểm tra subRoom đã có slot chưa
  const existingSlots = await slotRepo.findSlots({
    scheduleId,
    subRoomId,
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  });

  if (existingSlots.length > 0) {
    console.log(`⚠️ SubRoom ${subRoomId} đã có ${existingSlots.length} slot trong khoảng ngày, bỏ qua`);
    return { schedule, createdSlotIds: [] };
  }

  // 🔹 Lấy shift từ cache để kiểm tra slotDuration
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Không tìm thấy bộ nhớ đệm ca/kíp');
  const shifts = JSON.parse(shiftCache);
  const selectedShifts = shifts.filter(s => shiftIds.includes(s._id.toString()));

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

    if (slotDuration >= remainingMinutes) {
      console.log(`⚠️ slotDuration (${slotDuration} phút) không hợp lệ cho ca ${shift._id}. Chỉ còn ${remainingMinutes} phút khả dụng. Bỏ qua subRoom ${subRoomId}`);
      return { schedule, createdSlotIds: [] };
    }
  }

  // 🔹 Sinh slot mới
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

exports.listSchedules = async ({ roomId, shiftIds = [], page = 1, limit = 10 }) => {
  // Nếu có roomId => trả danh sách như cũ
  if (roomId) {
    const skip = (page - 1) * limit;

    const { schedules, total } = await scheduleRepo.findSchedules({
      roomId,
      shiftIds,
      skip,
      limit
    });

    // Enrich từng schedule
    const enrichedSchedules = [];
    for (const sch of schedules) {
      const { slots: dbSlots } = await slotRepo.findSlotsByScheduleId(sch._id);
      const enrichedSlots = await enrichSlots(dbSlots);

      enrichedSchedules.push({
        ...sch.toObject(),
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
      shiftIds: [],
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

  // 🔹 Tập hợp shiftIds duy nhất
  const shiftIds = [
    ...new Set(schedules.flatMap(s => s.shiftIds.map(id => id.toString())))
  ];

  // 🔹 Map shiftId → shift info
  const shiftMap = await getShiftMapFromCache();
  const shifts = shiftIds
    .map(id => shiftMap[id])
    .filter(Boolean); // loại bỏ shift không tồn tại trong cache
  // 🔹 Lấy toàn bộ slot từ schedules
  const allSlotIds = schedules.flatMap(s => s.slots.map(slot => slot._id));
  const dbSlots = await slotRepo.findByIds(allSlotIds); // [{_id, subRoomId}]
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





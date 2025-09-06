const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const redisClient = require('../utils/redis.client');

exports.assignStaff = async (data) => {
  const { scheduleId, subRoomId, dentistIds = [], nurseIds = [], startDate, endDate, shiftIds = [] } = data;

  // 1️⃣ Lấy schedule
  const schedule = await scheduleRepo.findById(scheduleId);
  if (!schedule) throw new Error('Không tìm thấy lịch làm việc');

  // 2️⃣ Lấy room từ cache
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Không tìm thấy dữ liệu phòng trong cache');
  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id === String(schedule.roomId));
  if (!room) throw new Error('Không tìm thấy phòng trong cache');

  // 3️⃣ Kiểm tra subRoomId
  const subRoom = room.subRooms.find(sr => sr._id === String(subRoomId));
  if (!subRoom) throw new Error(`Không tìm thấy buồng phụ ${subRoomId} trong phòng ${room._id}`);

  // 4️⃣ Lấy shift từ Redis cache
  let shiftTimes = [];
  if (shiftIds.length > 0) {
    const shiftCache = await redisClient.get('shifts_cache');
    if (!shiftCache) throw new Error('Không tìm thấy dữ liệu ca làm trong cache');
    const shifts = JSON.parse(shiftCache);

    // Lọc shift hợp lệ
    const validShifts = shifts.filter(s => shiftIds.includes(s._id));
    if (validShifts.length !== shiftIds.length) {
      const invalid = shiftIds.filter(id => !validShifts.some(s => s._id === id));
      throw new Error(`Các ca làm không hợp lệ: ${invalid.join(', ')}`);
    }

    // Lấy start/end time
    shiftTimes = validShifts.map(s => ({
      start: s.startTime,
      end: s.endTime
    }));
  }

  // 5️⃣ Kiểm tra bác sĩ / y tá hợp lệ và không vượt quá subRoom
  const userCache = await redisClient.get('users_cache');
  if (!userCache) throw new Error('Không tìm thấy dữ liệu người dùng trong cache');
  const users = JSON.parse(userCache);

  // Kiểm tra dentistIds
  for (const dId of dentistIds) {
    const user = users.find(u => u._id === String(dId));
    if (!user) {
      throw new Error(`Không tìm thấy nha sỹ với ID ${dId}`);
    }
    if (user.role !== 'dentist') {
      throw new Error(`Người dùng ${dId} không có vai trò bác sĩ`);
    }
  }

  // Kiểm tra nurseIds
  for (const nId of nurseIds) {
    const user = users.find(u => u._id === String(nId));
    if (!user) {
      throw new Error(`Không tìm thấy y tá với ID ${nId}`);
    }
    if (user.role !== 'nurse') {
      throw new Error(`Người dùng ${nId} không có vai trò y tá`);
    }
  }

  // Giới hạn số lượng trong subRoom
  if (dentistIds.length > subRoom.maxDoctors) {
    throw new Error(`Vượt quá giới hạn bác sĩ trong buồng phụ ${subRoom._id}: tối đa ${subRoom.maxDoctors}`);
  }
  if (nurseIds.length > subRoom.maxNurses) {
    throw new Error(`Vượt quá giới hạn y tá trong buồng phụ ${subRoom._id}: tối đa ${subRoom.maxNurses}`);
  }


  // 6️⃣ Lấy tất cả slot theo scheduleId + subRoomId + date range
  const filter = {
    scheduleId,
    subRoomId,
    date: { $gte: new Date(startDate), $lte: new Date(endDate) }
  };

  let slots = await slotRepo.findSlots(filter);
 if (!slots.length) {
  throw new Error(`Không tìm thấy slot nào trong buồng phụ ${subRoomId} từ ${startDate} đến ${endDate}`);
}

  // 7️⃣ Lọc slot dựa trên shiftTimes + kiểm tra slotDuration
  if (shiftTimes.length > 0) {
    slots = slots.filter(slot => {
      const slotStart = new Date(slot.startTime);
      const slotEnd = new Date(slot.endTime);

      // Thời lượng slot
      const slotDuration = (slotEnd - slotStart) / (1000 * 60); // phút

      return shiftTimes.some(shift => {
        const [shiftStartH, shiftStartM] = shift.start.split(':').map(Number);
        const [shiftEndH, shiftEndM] = shift.end.split(':').map(Number);

        const shiftStartTime = new Date(slotStart);
        shiftStartTime.setHours(shiftStartH, shiftStartM, 0, 0);

        const shiftEndTime = new Date(slotStart);
        shiftEndTime.setHours(shiftEndH, shiftEndM, 0, 0);

        // Nếu slot vượt ngoài shift → loại ngay
        if (slotStart < shiftStartTime || slotEnd > shiftEndTime) {
          throw new Error(`Slot ${slot._id} có thời gian vượt quá phạm vi ca làm`);
        }

        return slotStart >= shiftStartTime && slotEnd <= shiftEndTime;
      });
    });
    if (!slots.length) throw new Error('Không tìm thấy slot nào trong khoảng thời gian ca làm đã chọn');
  }

  // 8️⃣ Kiểm tra xung đột với dentist/nurse trong cùng thời gian
  for (const slot of slots) {
    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);

    // Lấy tất cả slot khác trong DB không phải slot đang gán(không phụ thuộc scheduleId, subRoomId…)
    const otherSlots = await slotRepo.findSlots({
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
      throw new Error(`Bác sĩ ${dentistConflict.join(', ')} đã được phân công trong slot trùng thời gian`);
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
      throw new Error(`Y tá ${nurseConflict.join(', ')} đã được phân công trong slot trùng thời gian`);
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
exports.getSlots = async (filters, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const [slots, total] = await Promise.all([
    slotRepo.findSlots(filters, skip, limit),
    slotRepo.countSlots(filters)
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    slots
  };
};

// Lấy chi tiết slot
exports.getSlotById = async (slotId) => {
  const slot = await slotRepo.findById(slotId);
  if (!slot) throw new Error('Không tìm thấy slot');
  return slot;
};


exports.assignStaffToSlots = async (slotIds = [], dentistIds = [], nurseIds = []) => {
  if (!slotIds.length) throw new Error('Cần truyền danh sách slotIds');

  // 1️⃣ Lấy cache trước (đỡ phải load lại nhiều lần)
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Không tìm thấy dữ liệu phòng trong cache');
  const rooms = JSON.parse(roomCache);

  const userCache = await redisClient.get('users_cache');
  if (!userCache) throw new Error('Không tìm thấy dữ liệu người dùng trong cache');
  const users = JSON.parse(userCache);

  // 2️⃣ Kiểm tra users hợp lệ
  for (const dId of dentistIds) {
    const user = users.find(u => u._id === String(dId));
    if (!user) throw new Error(`Không tìm thấy nha sỹ với ID ${dId}`);
    if (user.role !== 'dentist') throw new Error(`Người dùng ${dId} không có vai trò bác sĩ`);
  }
  for (const nId of nurseIds) {
    const user = users.find(u => u._id === String(nId));
    if (!user) throw new Error(`Không tìm thấy y tá với ID ${nId}`);
    if (user.role !== 'nurse') throw new Error(`Người dùng ${nId} không có vai trò y tá`);
  }

  const updatedSlots = [];

  // 3️⃣ Lặp từng slot
  for (const slotId of slotIds) {
    const slot = await slotRepo.findById(slotId);
    if (!slot) throw new Error(`Không tìm thấy slot ${slotId}`);

    // 4️⃣ Lấy schedule
    const schedule = await scheduleRepo.findById(slot.scheduleId);
    if (!schedule) throw new Error(`Không tìm thấy lịch làm việc cho slot ${slotId}`);

    // 5️⃣ Lấy room
    const room = rooms.find(r => r._id === String(schedule.roomId));
    if (!room) throw new Error(`Không tìm thấy phòng ${schedule.roomId} trong cache`);

    // 6️⃣ Lấy subRoom
    const subRoom = room.subRooms.find(sr => sr._id === String(slot.subRoomId));
    if (!subRoom) throw new Error(`Không tìm thấy buồng phụ ${slot.subRoomId} trong phòng ${room._id}`);

    // 7️⃣ Kiểm tra giới hạn subRoom
    if (dentistIds.length > subRoom.maxDoctors) {
      throw new Error(`Slot ${slotId}: Vượt quá giới hạn bác sĩ trong buồng phụ ${subRoom._id} (tối đa ${subRoom.maxDoctors})`);
    }
    if (nurseIds.length > subRoom.maxNurses) {
      throw new Error(`Slot ${slotId}: Vượt quá giới hạn y tá trong buồng phụ ${subRoom._id} (tối đa ${subRoom.maxNurses})`);
    }

    // 8️⃣ Kiểm tra xung đột với slot khác trong cùng schedule
    const otherSlots = await slotRepo.findSlots({
      scheduleId: schedule._id,
      _id: { $ne: slot._id }
    });

    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);

    // Bác sĩ
    const dentistConflict = dentistIds.filter(dId =>
      otherSlots.some(s =>
        s.dentistId.includes(dId) &&
        new Date(s.startTime) < slotEnd &&
        new Date(s.endTime) > slotStart
      )
    );
    if (dentistConflict.length) {
      throw new Error(`Slot ${slotId}: Bác sĩ ${dentistConflict.join(', ')} đã được phân công trong slot trùng thời gian`);
    }

    // Y tá
    const nurseConflict = nurseIds.filter(nId =>
      otherSlots.some(s =>
        s.nurseId.includes(nId) &&
        new Date(s.startTime) < slotEnd &&
        new Date(s.endTime) > slotStart
      )
    );
    if (nurseConflict.length) {
      throw new Error(`Slot ${slotId}: Y tá ${nurseConflict.join(', ')} đã được phân công trong slot trùng thời gian`);
    }

    // 9️⃣ Update slot
    slot.dentistId = dentistIds;
    slot.nurseId = nurseIds;
    await slot.save();

    updatedSlots.push(slot);
  }

  return updatedSlots;
};


exports.cancelSlots = async ({ slotIds = [], dentistIds = [], nurseIds = [], cancelAll = false }) => {
  // Ép dữ liệu thành mảng, bỏ phần tử rỗng
  dentistIds = (Array.isArray(dentistIds) ? dentistIds : dentistIds ? [dentistIds] : []).filter(Boolean);
  nurseIds   = (Array.isArray(nurseIds) ? nurseIds : nurseIds ? [nurseIds] : []).filter(Boolean);

  if (dentistIds.length === 0 && nurseIds.length === 0) {
    throw new Error('Phải truyền ít nhất 1 nha sỹ hoặc y tá để hủy');
  }

  let query = {};

  if (cancelAll) {
    query = { $or: [] };
    if (dentistIds.length) query.$or.push({ dentistId: { $in: dentistIds } });
    if (nurseIds.length)   query.$or.push({ nurseId: { $in: nurseIds } });
  } else if (slotIds.length > 0) {
    query = { _id: { $in: slotIds } };
  } else {
    throw new Error('Phải truyền slotIds hoặc bật cancelAll');
  }

  // ✅ Kiểm tra từng loại riêng
  if (dentistIds.length) {
    const dentistExist = await slotRepo.find({
      ...query,
      dentistId: { $in: dentistIds }
    });
    if (!dentistExist || dentistExist.length === 0) {
      throw new Error('Không tìm thấy slot nào có nha sỹ cần hủy');
    }
  }

  if (nurseIds.length) {
    const nurseExist = await slotRepo.find({
      ...query,
      nurseId: { $in: nurseIds }
    });
    if (!nurseExist || nurseExist.length === 0) {
      throw new Error('Không tìm thấy slot nào có y tá cần hủy');
    }
  }

  // Tạo update object động
  let update = {};
  if (dentistIds.length) {
    update.$pull = { ...(update.$pull || {}), dentistId: { $in: dentistIds } };
  }
  if (nurseIds.length) {
    update.$pull = { ...(update.$pull || {}), nurseId: { $in: nurseIds } };
  }

  const result = await slotRepo.updateMany(query, update);

  return result;
};

// Làm tròn lên khung giờ gần nhất (0,15,30,45)
function roundUpToNextQuarter(date) {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const remainder = minutes % 15;
  if (remainder !== 0) {
    rounded.setMinutes(minutes + (15 - remainder));
    rounded.setSeconds(0, 0);
  }
  return rounded;
}

function groupConsecutiveSlots(slots, requiredDuration) {
  const groups = [];
  const slotDuration = (slots[0] && (slots[0].endTime - slots[0].startTime) / (1000 * 60)) || 15; // phút
  const slotsNeeded = Math.ceil(requiredDuration / slotDuration);

  for (let i = 0; i <= slots.length - slotsNeeded; i++) {
    const group = slots.slice(i, i + slotsNeeded);
    let continuous = true;
    for (let j = 0; j < group.length - 1; j++) {
      if (group[j].endTime.getTime() !== group[j + 1].startTime.getTime()) {
        continuous = false;
        break;
      }
    }
    if (continuous) {
      groups.push({
        slots: group,
        startTime: group[0].startTime,
        endTime: group[group.length - 1].endTime
      });
    }
  }

  return groups;
}

exports.findAvailableSlotsForServiceFromNow = async ({ serviceId, dentistId }) => {
  // 1️⃣ Lấy thông tin service từ Redis
  const servicesCache = await redisClient.get('services_cache');
  if (!servicesCache) throw new Error('Không tìm thấy cache dịch vụ');
  const services = JSON.parse(servicesCache);
  const service = services.find(s => s._id === serviceId);
  if (!service) throw new Error('Dịch vụ không hợp lệ');

  const requiredDuration = service.duration; // phút

  
  // 2️⃣ Lấy thời gian hiện tại và làm tròn lên khung giờ 0,15,30,45
  const now = roundUpToNextQuarter(new Date());

  // 3️⃣ Lấy slot trống từ thời điểm này trở đi
  const slots = await slotRepo.findSlotsByDentistFromNow(dentistId, now);
  if (!slots.length) return [];

  // 4️⃣ Gom nhóm slot liên tiếp đủ duration
  const groups = groupConsecutiveSlots(slots, requiredDuration);
  return groups;
};
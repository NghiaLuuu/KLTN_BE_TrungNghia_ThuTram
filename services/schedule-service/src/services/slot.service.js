const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const redisClient = require('../utils/redis.client');
const Schedule = require('../models/schedule.model');
const scheduleService = require('../services/schedule.service');
exports.assignStaff = async (data) => {
  const { subRoomId, dentistIds = [], nurseIds = [], startDate, endDate, shiftIds } = data;

  if (!subRoomId || !startDate || !endDate || !Array.isArray(shiftIds) || shiftIds.length === 0) {
    throw new Error('subRoomId, startDate, endDate và shiftIds là bắt buộc');
  }

  // 1️⃣ Lấy summary của room từ subRoomId
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Không tìm thấy dữ liệu phòng trong cache');
  const rooms = JSON.parse(roomCache);

  const room = rooms.find(r => r.subRooms.some(sr => sr._id === String(subRoomId)));
  if (!room) throw new Error('Không tìm thấy phòng chứa buồng phụ');

  const summary = await scheduleService.getRoomSchedulesSummary(room._id);

  // 2️⃣ Kiểm tra subRoomId có hợp lệ trong summary
  const validSubRoom = summary.subRooms.find(sr => sr.subRoomId === String(subRoomId));
  if (!validSubRoom) throw new Error(`Buồng phụ ${subRoomId} không thuộc phạm vi lịch làm việc của phòng ${room._id}`);

  // 3️⃣ Kiểm tra ngày trong phạm vi summary
  const sumStart = new Date(summary.startDate);
  const sumEnd = new Date(summary.endDate);
  const reqStart = new Date(startDate);
  const reqEnd = new Date(endDate);

  if (reqStart < sumStart || reqEnd > sumEnd) {
    throw new Error(`Khoảng ngày ${startDate} → ${endDate} nằm ngoài phạm vi lịch ${summary.startDate} → ${summary.endDate}`);
  }

  // 4️⃣ Kiểm tra shiftIds hợp lệ
  const invalidShifts = shiftIds.filter(id => !summary.shiftIds.includes(id));
  if (invalidShifts.length) throw new Error(`Các ca làm không thuộc phạm vi lịch: ${invalidShifts.join(', ')}`);

  // 5️⃣ Kiểm tra active room/subRoom
  const subRoom = room.subRooms.find(sr => sr._id === String(subRoomId));
  if (!room.isActive || !subRoom.isActive) {
    throw new Error(`Phòng hoặc buồng phụ đang bị khóa (isActive = false)`);
  }

  // 6️⃣ Lấy shift từ cache
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Không tìm thấy dữ liệu ca làm trong cache');
  const shifts = JSON.parse(shiftCache);

  const validShifts = shifts.filter(s => shiftIds.includes(s._id) && s.isActive);
  if (validShifts.length !== shiftIds.length) {
    const invalid = shiftIds.filter(id => !validShifts.some(s => s._id === id));
    throw new Error(`Các ca làm không hợp lệ hoặc bị khóa: ${invalid.join(', ')}`);
  }

  // 7️⃣ Lấy tất cả slot của subRoom trong khoảng startDate → endDate
  const allSlots = await slotRepo.getSlots({
    subRoomId,
    date: { $gte: startDate, $lte: endDate }
  });

  // 8️⃣ Chuyển shift sang giờ UTC (chỉ giờ, không đổi ngày)
  const shiftTimes = validShifts.map(shift => {
    const [shH, shM] = shift.startTime.split(':').map(Number);
    const [ehH, ehM] = shift.endTime.split(':').map(Number);
    return { shH, shM, ehH, ehM };
  });

  // 9️⃣ Lọc slot theo giờ của shift
  let slots = allSlots.filter(slot => {
    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);

    return shiftTimes.some(shift => {
      const shiftStart = new Date(slotStart);
      shiftStart.setHours(shift.shH, shift.shM, 0, 0);

      const shiftEnd = new Date(slotEnd);
      shiftEnd.setHours(shift.ehH, shift.ehM, 0, 0);

      return slotStart >= shiftStart && slotEnd <= shiftEnd;
    });
  });

  if (!slots.length) {
    throw new Error(`Không có slot nào khớp với ca/kíp đã chọn trong buồng phụ "${subRoom.name}"`);
  }

  // 10️⃣ Kiểm tra giới hạn nhân sự
  const userCache = await redisClient.get('users_cache');
  if (!userCache) throw new Error('Không tìm thấy dữ liệu người dùng trong cache');
  const users = JSON.parse(userCache);

  for (const dId of dentistIds) {
    const user = users.find(u => u._id === String(dId));
    if (!user) throw new Error(`Không tìm thấy nha sĩ với ID ${dId}`);
    if (user.role !== 'dentist') throw new Error(`Người dùng ${dId} không có vai trò bác sĩ`);
  }
  for (const nId of nurseIds) {
    const user = users.find(u => u._id === String(nId));
    if (!user) throw new Error(`Không tìm thấy y tá với ID ${nId}`);
    if (user.role !== 'nurse') throw new Error(`Người dùng ${nId} không có vai trò y tá`);
  }

  if (dentistIds.length > subRoom.maxDoctors) {
    throw new Error(`Vượt quá giới hạn bác sĩ trong buồng phụ ${subRoom._id}: tối đa ${subRoom.maxDoctors}`);
  }
  if (nurseIds.length > subRoom.maxNurses) {
    throw new Error(`Vượt quá giới hạn y tá trong buồng phụ ${subRoom._id}: tối đa ${subRoom.maxNurses}`);
  }

  // 11️⃣ Cập nhật slot
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

  const now = new Date();

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
    if (!user) throw new Error(`Không tìm thấy nha sĩ với ID ${dId}`);
    if (user.role !== 'dentist') throw new Error(`Người dùng ${dId} không có vai trò bác sĩ`);
  }
  for (const nId of nurseIds) {
    const user = users.find(u => u._id === String(nId));
    if (!user) throw new Error(`Không tìm thấy y tá với ID ${nId}`);
    if (user.role !== 'nurse') throw new Error(`Người dùng ${nId} không có vai trò y tá`);
  }

  // 3️⃣ Lấy tất cả slot từ DB
  const slots = await slotRepo.findSlots({ _id: { $in: slotIds } });
  if (!slots.length) throw new Error('Không tìm thấy slot nào');

  // 4️⃣ Kiểm tra slot từ hiện tại trở đi
  for (const slot of slots) {
    if (new Date(slot.startTime) < now) {
      throw new Error(`Slot ${slot._id} đã diễn ra, không thể gán nhân sự`);
    }
  }

  // 5️⃣ Kiểm tra appointmentId
  const appointmentIds = [...new Set(slots.map(s => s.appointmentId).filter(Boolean))];
  for (const appId of appointmentIds) {
    const relatedSlots = await slotRepo.findSlots({ appointmentId: appId });
    const relatedSlotIds = relatedSlots.map(s => String(s._id));
    const missingSlotIds = relatedSlotIds.filter(id => !slotIds.includes(id));
    if (missingSlotIds.length) {
      throw new Error(`Slot liên quan đến appointment ${appId} chưa được truyền đầy đủ. Cần truyền các slot: ${relatedSlotIds.join(', ')}`);
    }
  }

  const updatedSlots = [];

  // 6️⃣ Lặp từng slot
  for (const slot of slots) {
    const schedule = await scheduleRepo.findById(slot.scheduleId);
    if (!schedule) throw new Error(`Không tìm thấy lịch làm việc cho slot ${slot._id}`);

    const room = rooms.find(r => r._id === String(schedule.roomId));
    if (!room) throw new Error(`Không tìm thấy phòng ${schedule.roomId} trong cache`);

    const subRoom = room.subRooms.find(sr => sr._id === String(slot.subRoomId));
    if (!subRoom) throw new Error(`Không tìm thấy buồng phụ ${slot.subRoomId} trong phòng ${room._id}`);

    if (dentistIds.length > subRoom.maxDoctors) {
      throw new Error(`Slot ${slot._id}: Vượt quá giới hạn bác sĩ trong buồng phụ ${subRoom._id} (tối đa ${subRoom.maxDoctors})`);
    }
    if (nurseIds.length > subRoom.maxNurses) {
      throw new Error(`Slot ${slot._id}: Vượt quá giới hạn y tá trong buồng phụ ${subRoom._id} (tối đa ${subRoom.maxNurses})`);
    }

    // Kiểm tra xung đột với slot khác trong cùng schedule
    const otherSlots = await slotRepo.findSlots({
      scheduleId: schedule._id,
      _id: { $ne: slot._id }
    });

    const slotStart = new Date(slot.startTime);
    const slotEnd = new Date(slot.endTime);

    const dentistConflict = dentistIds.filter(dId =>
      otherSlots.some(s =>
        s.dentistId.includes(dId) &&
        new Date(s.startTime) < slotEnd &&
        new Date(s.endTime) > slotStart
      )
    );
    if (dentistConflict.length) {
      throw new Error(`Slot ${slot._id}: Bác sĩ ${dentistConflict.join(', ')} đã được phân công trong slot trùng thời gian`);
    }

    const nurseConflict = nurseIds.filter(nId =>
      otherSlots.some(s =>
        s.nurseId.includes(nId) &&
        new Date(s.startTime) < slotEnd &&
        new Date(s.endTime) > slotStart
      )
    );
    if (nurseConflict.length) {
      throw new Error(`Slot ${slot._id}: Y tá ${nurseConflict.join(', ')} đã được phân công trong slot trùng thời gian`);
    }

    // Update slot
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

exports.validateSlotsForService = async ({ serviceId, preferredDentistId, slotIds }) => {
  if (!slotIds || !slotIds.length) {
    return { valid: false, reason: "Chưa chọn slot nào" };
  }

  // 🔹 Lấy slots theo slotIds
  const slots = await slotRepo.findByIds(slotIds, "dentistId startTime endTime status");
  if (!slots || !slots.length) {
    return { valid: false, reason: "Slot không tồn tại" };
  }

  /// 🔹 Kiểm tra trạng thái slot
  const invalidSlots = slots.filter(s => s.status !== "available");
  if (invalidSlots.length > 0) {
    return {
      valid: false,
      reason: `Các slot không khả dụng: ${invalidSlots.map(s => 
        `${s._id} (status=${s.status})`
      ).join(", ")}`
    };
  }

  // 🔹 Kiểm tra tất cả slot có chứa preferredDentistId
  const preferredId = String(preferredDentistId);
  let allMatchDentist = true;
  for (const s of slots) {
    const dentistIds = (s.dentistId || []).map(d => String(d));
    if (!dentistIds.includes(preferredId)) {
      allMatchDentist = false;
    }
  }

  if (!allMatchDentist) {
    return { valid: false, reason: "Slot không thuộc nha sĩ đã chọn" };
  }

  // 🔹 Lấy thông tin service
  const servicesCache = await redisClient.get("services_cache");
  if (!servicesCache) return { valid: false, reason: "Không tìm thấy cache dịch vụ" };
  const services = JSON.parse(servicesCache);
  const service = services.find(s => s._id === serviceId);
  if (!service) return { valid: false, reason: "Dịch vụ không hợp lệ" };

  // 🔹 Kiểm tra các slot có liên tiếp hay không
  const sortedSlots = slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  for (let i = 1; i < sortedSlots.length; i++) {
    if (new Date(sortedSlots[i].startTime).getTime() !== new Date(sortedSlots[i - 1].endTime).getTime()) {
      return { valid: false, reason: "Các slot đã chọn không liên tiếp" };
    }
  }

  // 🔹 Kiểm tra tổng thời lượng có đủ cho service không
  const totalDuration =
    (new Date(sortedSlots[sortedSlots.length - 1].endTime) -
      new Date(sortedSlots[0].startTime)) /
    (1000 * 60);

  if (totalDuration < service.duration) {
    return { valid: false, reason: "Thời lượng slot không đủ cho dịch vụ" };
  }

  return { valid: true, service: { type: service.type, price: service.price } };
};





// slotService.js
exports.getEmployeeSchedule = async ({ employeeId, startDate, endDate, page = 1, limit = 1 }) => {
  if (!employeeId) throw new Error('Thiếu employeeId');

  // Lấy tất cả slot của nhân viên
  const slots = await slotRepo.findSlotsByEmployee({ employeeId, startDate, endDate });
  if (slots.length === 0) return { total: 0, page, limit, totalPages: 0, data: [] };

  // Nhóm slot theo ngày Việt Nam
  const slotsByDay = {};
  slots.forEach(slot => {
    const vnDate = new Date(slot.date.getTime() + 7 * 60 * 60 * 1000); // UTC+7
    const dayKey = vnDate.toISOString().split('T')[0];
    if (!slotsByDay[dayKey]) slotsByDay[dayKey] = [];
    slotsByDay[dayKey].push(slot);
  });

  // Lấy tất cả scheduleId để fetch schedule
  const scheduleIds = [...new Set(slots.map(s => s.scheduleId.toString()))];
  const schedules = await Schedule.find({ _id: { $in: scheduleIds } });

  // Sắp xếp các ngày và phân trang theo ngày
  const sortedDays = Object.keys(slotsByDay).sort();
  const totalDays = sortedDays.length;
  const totalPages = Math.ceil(totalDays / limit);
  const pagedDays = sortedDays.slice((page - 1) * limit, page * limit);

  // Tạo kết quả
  const data = pagedDays.map(day => {
    const daySlots = slotsByDay[day];

    // Nhóm slot theo schedule
    const schedulesMap = {};
    daySlots.forEach(slot => {
      const sid = slot.scheduleId.toString();
      if (!schedulesMap[sid]) schedulesMap[sid] = [];
      schedulesMap[sid].push(slot);
    });

    // Tạo array schedule với shiftSlots
    const schedulesData = Object.entries(schedulesMap).map(([sid, sSlots]) => {
      const schedule = schedules.find(s => s._id.toString() === sid);
      const shiftMap = {};
      schedule.shiftIds.forEach(shiftId => {
        shiftMap[shiftId] = sSlots.filter(s => schedule.shiftIds.includes(shiftId));
      });
      return {
        scheduleId: schedule._id,
        roomId: schedule.roomId,
        startDate: schedule.startDate,
        endDate: schedule.endDate,
        shiftSlots: shiftMap
      };
    });

    return {
      date: day,
      schedules: schedulesData
    };
  });

  return {
    total: totalDays,
    page,
    limit,
    totalPages,
    data
  };
};

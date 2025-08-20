  const scheduleRepo = require('../repositories/schedule.repository');
  const slotRepo = require('../repositories/slot.repository');
  const redisClient = require('../utils/redis.client');



exports.createSchedule = async (data) => {
  // 1. Lấy shift từ Redis
  const shiftCache = await redisClient.get('shifts_cache');
  if (!shiftCache) throw new Error('Shift cache not found');

  const shifts = JSON.parse(shiftCache);
  const shift = shifts.find(s => s._id === data.shiftId);
  if (!shift) throw new Error('Shift not found in cache');

  // 2. Lấy room từ Redis
  const roomCache = await redisClient.get('rooms_cache');
  if (!roomCache) throw new Error('Room cache not found');

  const rooms = JSON.parse(roomCache);
  const room = rooms.find(r => r._id === data.roomId);
  if (!room) throw new Error('Room not found in cache');

  // 3. Lấy user từ Redis để kiểm tra role
  const userCache = await redisClient.get('users_cache');
  if (!userCache) throw new Error('User cache not found');

  const users = JSON.parse(userCache);

  // 3.1 Kiểm tra dentistIds
  if (data.dentistIds?.length) {
    const invalidDentists = data.dentistIds.filter(id => {
      const u = users.find(user => user._id === id);
      return !u || u.role !== 'dentist';
    });
    if (invalidDentists.length) {
      throw new Error(`Invalid dentist IDs or role mismatch: ${invalidDentists.join(', ')}`);
    }
  }

  // 3.2 Kiểm tra nurseIds
  if (data.nurseIds?.length) {
    const invalidNurses = data.nurseIds.filter(id => {
      const u = users.find(user => user._id === id);
      return !u || u.role !== 'nurse';
    });
    if (invalidNurses.length) {
      throw new Error(`Invalid nurse IDs or role mismatch: ${invalidNurses.join(', ')}`);
    }
  }

  // 4. Kiểm tra số lượng nha sĩ & y tá không vượt giới hạn phòng
  if (data.dentistIds && data.dentistIds.length > room.maxDoctors) {
    throw new Error(`Number of dentists (${data.dentistIds.length}) exceeds room limit (${room.maxDoctors})`);
  }
  if (data.nurseIds && data.nurseIds.length > room.maxNurses) {
    throw new Error(`Number of nurses (${data.nurseIds.length}) exceeds room limit (${room.maxNurses})`);
  }

  // 5. Chuyển giờ bắt đầu/kết thúc shift thành Date
  const dateOnly = new Date(data.date);
  const [startHour, startMinute] = shift.startTime.split(':').map(Number);
  const [endHour, endMinute] = shift.endTime.split(':').map(Number);

  const shiftStart = new Date(dateOnly);
  shiftStart.setHours(startHour, startMinute, 0, 0);

  const shiftEnd = new Date(dateOnly);
  shiftEnd.setHours(endHour, endMinute, 0, 0);

  // 6. Tạo schedule
  const schedule = await scheduleRepo.createSchedule({
    ...data,
    roomId: room._id,
    shiftId: shift._id
  });

  // 7. Sinh slot dựa trên slotDuration
  let currentStart = new Date(shiftStart);
  const slotIds = [];

  while (currentStart < shiftEnd) {
    let currentEnd = new Date(currentStart.getTime() + data.slotDuration * 60000);
    if (currentEnd > shiftEnd) break;

    const slot = await slotRepo.createSlot({
      date: dateOnly,
      startTime: currentStart,
      endTime: currentEnd,
      scheduleId: schedule._id
    });

    slotIds.push(slot._id);
    currentStart = currentEnd;
  }

  // 8. Gắn slot vào schedule
  schedule.slots = slotIds;
  await schedule.save();

  return schedule;
};



  exports.updateSchedule = async (id, data) => {
  if (!id) throw new Error('Schedule ID is required');

  // Kiểm tra dữ liệu ngày
  if (data.date) {
    const dateObj = new Date(data.date);
    if (isNaN(dateObj)) throw new Error('Invalid date format');
    data.date = dateObj;
  }

  const schedule = await scheduleRepo.findById(id);
  if (!schedule) throw new Error('Schedule not found');

  // Lấy user cache để kiểm tra role nếu dentistIds hoặc nurseIds được thay đổi
  if (data.dentistIds || data.nurseIds) {
    const userCache = await redisClient.get('users_cache');
    if (!userCache) throw new Error('User cache not found');
    const users = JSON.parse(userCache);

    if (data.dentistIds?.length) {
      const invalidDentists = data.dentistIds.filter(id => {
        const u = users.find(user => user._id === id);
        return !u || u.role !== 'dentist';
      });
      if (invalidDentists.length) {
        throw new Error(`Invalid dentist IDs or role mismatch: ${invalidDentists.join(', ')}`);
      }
    }

    if (data.nurseIds?.length) {
      const invalidNurses = data.nurseIds.filter(id => {
        const u = users.find(user => user._id === id);
        return !u || u.role !== 'nurse';
      });
      if (invalidNurses.length) {
        throw new Error(`Invalid nurse IDs or role mismatch: ${invalidNurses.join(', ')}`);
      }
    }
  }

  // Nếu có thay đổi slotDuration
  if (data.slotDuration !== undefined) {
    if (typeof data.slotDuration !== 'number' || data.slotDuration <= 0) {
      throw new Error('slotDuration must be a positive number');
    }

    if (schedule.slotDuration !== data.slotDuration) {
      // 1. Xóa slot cũ
      await slotRepo.deleteMany({ scheduleId: id });

      // 2. Lấy shift từ Redis
      const shiftCache = await redisClient.get('shifts_cache');
      if (!shiftCache) throw new Error('Shift cache not found');
      const shifts = JSON.parse(shiftCache);
      const shift = shifts.find(s => s._id === String(schedule.shiftId));
      if (!shift) throw new Error('Shift not found in cache');

      // 3. Tính thời gian
      const dateOnly = new Date(schedule.date);
      const [startHour, startMinute] = shift.startTime.split(':').map(Number);
      const [endHour, endMinute] = shift.endTime.split(':').map(Number);

      const shiftStart = new Date(dateOnly);
      shiftStart.setHours(startHour, startMinute, 0, 0);

      const shiftEnd = new Date(dateOnly);
      shiftEnd.setHours(endHour, endMinute, 0, 0);

      // 4. Tạo slot mới
      let currentStart = new Date(shiftStart);
      const slotIds = [];
      while (currentStart < shiftEnd) {
        let currentEnd = new Date(currentStart.getTime() + data.slotDuration * 60000);
        if (currentEnd > shiftEnd) break;

        const slot = await slotRepo.createSlot({
          date: dateOnly,
          startTime: currentStart,
          endTime: currentEnd,
          scheduleId: schedule._id
        });

        slotIds.push(slot._id);
        currentStart = currentEnd;
      }

      // 5. Cập nhật schedule với slot mới
      schedule.slotDuration = data.slotDuration;
      schedule.slots = slotIds;
      await schedule.save();
    }
  }

  // Cập nhật các trường khác (bao gồm dentistIds, nurseIds nếu có)
  const updatedSchedule = await scheduleRepo.updateSchedule(id, data);
  if (!updatedSchedule) throw new Error('Schedule not found');

  return updatedSchedule;
};





  exports.toggleStatus = async (id) => {
    if (!id) throw new Error('Schedule ID is required');

    const schedule = await scheduleRepo.findById(id);
    if (!schedule) throw new Error('Schedule not found');

    const newStatus = schedule.status === 'active' ? 'inactive' : 'active';
    return await scheduleRepo.updateSchedule(id, { status: newStatus });
  };


  exports.viewByStaff = async (staffId, date) => {
    if (!staffId) throw new Error('Staff ID is required');
    if (!date) throw new Error('Date is required');

    const dateObj = new Date(date);
    if (isNaN(dateObj)) throw new Error('Invalid date format');

    return await scheduleRepo.findByStaffAndDate(staffId, dateObj);
  };

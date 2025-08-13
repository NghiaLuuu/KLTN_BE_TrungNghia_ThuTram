// services/appointment.service.js
const appointmentRepo = require('../repositories/appointment.repository');
const rpcClient = require('../utils/rpcClient');
const redis = require('../utils/redis.client');

// Tạo mới appointment (chưa chiếm slot)
exports.createHold = async (data, userIdFromToken) => {
  const { patientId, serviceId, scheduleId, slotId, preferredDentistId, channel } = data;

  // 0. Kiểm tra patientId bên Auth/User Service
  const patient = await rpcClient.request('auth_queue', {
    action: 'getUserById',
    payload: { userId: patientId }
  });
  if (!patient || patient.role !== 'patient') {
    throw new Error('Invalid patientId or user is not a patient');
  }

  // 1. Kiểm tra serviceId trong Redis
  const servicesCache = await redis.get('services_cache');
  if (!servicesCache) throw new Error('Services cache not found');
  const services = JSON.parse(servicesCache);
  const selectedService = services.find(s => s._id === serviceId);
  if (!selectedService) throw new Error('Invalid serviceId');

  // 2. Kiểm tra scheduleId và dentist trong Schedule Service
  const schedule = await rpcClient.request('schedule_queue', {
    action: 'getScheduleById',
    payload: { scheduleId }
  });
  if (!schedule || schedule.status !== 'active') {
    throw new Error('Schedule not found or inactive');
  }

  // Nếu có preferredDentistId, kiểm tra dentist có trong schedule không
  if (preferredDentistId && !schedule.dentistIds.includes(preferredDentistId)) {
    throw new Error('Preferred dentist is not available in this schedule');
  }

  // 3. Check slot có thuộc schedule và trạng thái khác booked
  const slot = await rpcClient.request('schedule_queue', {
    action: 'getSlotById',
    payload: { slotId }
  });
  if (!slot || slot.scheduleId !== scheduleId) {
    throw new Error('Slot does not belong to the schedule');
  }
  if (slot.status === 'booked') {
    throw new Error('Slot is already booked');
  }

  // 4. Xác định bookedBy
  const bookedBy = patientId || userIdFromToken;
  if (!bookedBy) throw new Error('Cannot determine who booked the appointment');

  // 5. Lưu booking tạm vào Redis với TTL 10 phút
  const holdKey = `appointment_hold:${slotId}`;
  await redis.set(holdKey, JSON.stringify({
    ...data,
    bookedBy,
    status: 'booked', 
    createdAt: new Date()
  }), 'EX', 10 * 60);

  console.log(`✅ Appointment hold created for slot ${slotId} (slot status unchanged)`);

  // Tạo timeout để release slot tự động khi hold hết hạn
  setTimeout(async () => {
    const exists = await redis.get(holdKey);
    if (!exists) {
      // Nếu key đã hết hạn (10p trôi qua) thì release slot
      try {
        const released = await rpcClient.request('schedule_queue', {
          action: 'releaseSlot',
          payload: { slotId }
        });
        console.log(`🔄 Slot ${slotId} automatically released after hold expired`, released);
      } catch (err) {
        console.error(`Failed to release slot ${slotId}:`, err.message);
      }
    }
  }, 10 * 60 * 1000); // 10 phút

  return { message: 'Slot hold created for 10 minutes', holdKey };
};



exports.confirm = async (slotId) => {
  const holdKey = `appointment_hold:${slotId}`;
  const holdDataRaw = await redis.get(holdKey);
  if (!holdDataRaw) throw new Error('Hold expired or not found');

  const holdData = JSON.parse(holdDataRaw);

  // 1. Lưu vào DB
  const appointment = await appointmentRepo.create({
    ...holdData,
    status: 'confirmed'
  });

  // 2. Gửi sự kiện sang Schedule Service để đổi trạng thái slot
  await rpcClient.request('schedule_queue', {
    action: 'booked',
    payload: { slotId }
  });

  // 3. Xoá khỏi Redis
  await redis.del(holdKey);

  console.log(`✅ Appointment confirmed for slot ${slotId}`);
  return appointment;
};


// Cập nhật appointment (có xử lý đổi slot)
exports.update = async (id, data) => {
  const appointment = await appointmentRepo.findById(id);
  if (!appointment) throw new Error('Appointment not found');

  // Chỉ xử lý khi đổi slot
  if (data.slotId && data.slotId !== appointment.slotId) {

    if (appointment.status !== 'confirmed') {
      throw new Error('Only confirmed appointments can be updated');
    }

    // --- Trả slot cũ ---
    await rpcClient.request('schedule_queue', {
      action: 'updateSlot',
      payload: {
        slotId: appointment.slotId,
        update: { status: 'available', appointmentId: null }
      }
    });

    // --- Kiểm tra slot mới ---
    const slot = await rpcClient.request('schedule_queue', {
      action: 'getSlotById',
      payload: { slotId: data.slotId }
    });

    if (!slot || slot.status !== 'available') {
      throw new Error('New slot is not available');
    }

    // --- Chiếm slot mới ---
    await rpcClient.request('schedule_queue', {
      action: 'updateSlot',
      payload: {
        slotId: data.slotId,
        update: { status: 'booked', appointmentId: appointment._id }
      }
    });
  }

  return appointmentRepo.updateById(id, data);
};

// Huỷ appointment
exports.cancelHold = async (slotId) => {
  const holdKey = `appointment_hold:${slotId}`;
  const holdDataRaw = await redis.get(holdKey);
  if (!holdDataRaw) throw new Error('Hold not found');

  const holdData = JSON.parse(holdDataRaw);

  // Trả slot về available
  await rpcClient.request('schedule_queue', {
    action: 'releaseSlot',
    payload: { slotId }
  });

  // Xoá Redis
  await redis.del(holdKey);

  console.log(`❌ Hold cancelled for slot ${slotId}`);
  return { message: 'Hold cancelled' };
};

// Check-in
exports.checkIn = (id) => {
  return appointmentRepo.updateById(id, { status: 'checked-in' });
};

// Hoàn thành
exports.complete = (id) => {
  return appointmentRepo.updateById(id, { status: 'completed' });
};

// Tìm kiếm
exports.search = (filter) => {
  return appointmentRepo.search(filter);
};

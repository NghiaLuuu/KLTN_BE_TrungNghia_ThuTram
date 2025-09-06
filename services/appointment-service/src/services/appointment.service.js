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
    throw new Error('ID bệnh nhân không hợp lệ hoặc người dùng không phải bệnh nhân');
  }

  // 1. Kiểm tra serviceId trong Redis
  const servicesCache = await redis.get('services_cache');
  if (!servicesCache) throw new Error('Không tìm thấy cache dịch vụ');
  const services = JSON.parse(servicesCache);
  const selectedService = services.find(s => s._id === serviceId);
  if (!selectedService) throw new Error('ID dịch vụ không hợp lệ');

  // 2. Kiểm tra scheduleId và dentist trong Schedule Service
  const schedule = await rpcClient.request('schedule_queue', {
    action: 'getScheduleById',
    payload: { scheduleId }
  });
  if (!schedule || schedule.status !== 'active') {
    throw new Error('Lịch không tồn tại hoặc không hoạt động');
  }

  // Nếu có preferredDentistId, kiểm tra dentist có trong schedule không
  if (preferredDentistId && !schedule.dentistIds.includes(preferredDentistId)) {
    throw new Error('Bác sĩ được ưu tiên không có trong lịch này');
  }

  // 3. Kiểm tra slot có thuộc schedule và trạng thái là available
  const slot = await rpcClient.request('schedule_queue', {
    action: 'getSlotById',
    payload: { slotId }
  });
  if (!slot || slot.scheduleId !== scheduleId) {
    throw new Error('Slot không thuộc lịch này');
  }

  if (slot.status === 'confirmed') {
    throw new Error('Slot đã được xác nhận');
  }

  if (slot.status === 'reserved') {
    throw new Error('Slot đang được giữ bởi cuộc hẹn khác');
  }

  if (slot.status !== 'available') {
    throw new Error(`Slot không khả dụng (trạng thái: ${slot.status})`);
  }

  // 4. Xác định bookedBy
  const bookedBy = patientId || userIdFromToken;
  if (!bookedBy) throw new Error('Không xác định được người đặt cuộc hẹn');

  // 5. Lưu booking tạm vào Redis với TTL 10 phút
  const holdKey = `appointment_hold:${slotId}`;
  await redis.set(
    holdKey,
    JSON.stringify({
      ...data,
      bookedBy,
      status: 'booked',
      createdAt: new Date()
    }),
    'EX',
    10 * 60
  );

  // 🔹 Cập nhật trạng thái slot sang "reserved"
  try {
    await rpcClient.request('schedule_queue', {
      action: 'reserved',
      payload: { slotId }
    });
    console.log(`✅ Slot ${slotId} đã được đặt giữ`);
  } catch (err) {
    console.error(`❌ Không thể đặt giữ slot ${slotId}:`, err.message);
  }

  // 🔹 Gọi sang Payment Service để tạo payment tạm
  const payment = await rpcClient.request('payment_queue', {
    action: 'createTemporaryPayment',
    payload: {
      appointmentHoldKey: holdKey,
      slotId,
      amount: selectedService.price,
      method: channel || 'vnpay'
    }
  });

  console.log(`✅ Cuộc hẹn tạm thời được tạo cho slot ${slotId}`);

  // Timeout để release slot tự động khi hold hết hạn
  setTimeout(async () => {
    const holdDataRaw = await redis.get(holdKey);
    if (!holdDataRaw) {
      try {
        const released = await rpcClient.request('schedule_queue', {
          action: 'releaseSlot',
          payload: { slotId }
        });
        console.log(`🔄 Slot ${slotId} tự động trả về sau khi hết hạn hold`, released);
      } catch (err) {
        console.error(`❌ Không thể trả slot ${slotId}:`, err.message);
      }
      return;
    }

    const holdData = JSON.parse(holdDataRaw);

    if (holdData.status === 'confirmed') {
      try {
        await exports.confirm(slotId);
        console.log(`✅ Cuộc hẹn tự động xác nhận cho slot ${slotId} sau khi thanh toán`);
      } catch (err) {
        console.error(`❌ Không thể tự động xác nhận cuộc hẹn cho slot ${slotId}:`, err.message);
      }
    } else {
      try {
        await rpcClient.request('schedule_queue', {
          action: 'releaseSlot',
          payload: { slotId }
        });
        await redis.del(holdKey);
        console.log(`🔄 Slot ${slotId} được trả về sau khi hold hết hạn mà chưa xác nhận`);
      } catch (err) {
        console.error(`❌ Không thể trả slot ${slotId}:`, err.message);
      }
    }
  }, 10 * 60 * 1000);

  return {
    message: 'Slot được giữ trong 10 phút',
    holdKey,
    slotId: slot._id
  };
};

// Các hàm khác cũng tương tự, chỉ cần đổi các throw Error sang tiếng Việt
exports.confirm = async (holdKey) => {
  const keyStr = typeof holdKey === 'string' ? holdKey : holdKey.holdKey;
  const holdDataRaw = await redis.get(keyStr);

  if (!holdDataRaw) throw new Error('Hold đã hết hạn hoặc không tìm thấy');

  const holdData = JSON.parse(holdDataRaw);

  if (holdData.status !== 'confirmed') {
    throw new Error('Thanh toán chưa xác nhận, không thể tạo cuộc hẹn');
  }

  const appointment = await appointmentRepo.create({
    ...holdData,
    status: 'confirmed'
  });

  await rpcClient.request('schedule_queue', {
    action: 'confirmed',
    payload: { slotId: holdData.slotId }
  });

  await rpcClient.request('schedule_queue', {
    action: 'appointmentId',
    payload: { slotId: holdData.slotId, appointmentId: appointment._id }
  });

  await redis.del(keyStr);

  console.log(`✅ Cuộc hẹn đã được xác nhận cho slot ${holdData.slotId}`);
  return appointment;
};

exports.update = async (id, data) => {
  const appointment = await appointmentRepo.findById(id);
  if (!appointment) throw new Error('Không tìm thấy cuộc hẹn');

  if (data.slotId && data.slotId !== appointment.slotId) {
    if (appointment.status !== 'confirmed') {
      throw new Error('Chỉ có cuộc hẹn đã xác nhận mới được cập nhật');
    }

    await rpcClient.request('schedule_queue', {
      action: 'updateSlot',
      payload: { slotId: appointment.slotId, update: { status: 'available', appointmentId: null } }
    });

    const slot = await rpcClient.request('schedule_queue', {
      action: 'getSlotById',
      payload: { slotId: data.slotId }
    });

    if (!slot || slot.status !== 'available') {
      throw new Error('Slot mới không khả dụng');
    }

    await rpcClient.request('schedule_queue', {
      action: 'updateSlot',
      payload: { slotId: data.slotId, update: { status: 'confirmed', appointmentId: appointment._id } }
    });
  }

  return appointmentRepo.updateById(id, data);
};

exports.cancelHold = async (slotId) => {
  const holdKey = `appointment_hold:${slotId}`;
  const holdDataRaw = await redis.get(holdKey);
  if (!holdDataRaw) throw new Error('Không tìm thấy hold');

  const holdData = JSON.parse(holdDataRaw);

  await rpcClient.request('schedule_queue', {
    action: 'releaseSlot',
    payload: { slotId }
  });

  await redis.del(holdKey);

  console.log(`❌ Hold đã bị hủy cho slot ${slotId}`);
  return { message: 'Hold đã bị hủy' };
};

exports.checkIn = async (id) => {
  const appointment = await appointmentRepo.findById(id);
  if (!appointment) throw new Error('Không tìm thấy cuộc hẹn');

  if (appointment.status !== 'confirmed') {
    throw new Error('Chỉ có cuộc hẹn đã xác nhận mới được check-in');
  }

  const updated = await appointmentRepo.updateById(id, { status: 'checked-in' });

  try {
    const recordResponse = await rpcClient.request('record_queue', {
      action: 'createRecord',
      payload: {
        appointmentId: updated._id,
        patientId: updated.patientId._id || updated.patientId,
        dentistId: updated.preferredDentistId || null,
        serviceId: (updated.serviceId || []).map(s => s.toString()),
        type: updated.type,
        notes: updated.notes || ""
      }
    });
    console.log("📤 Check-in RPC request gửi tới record_queue:", recordResponse);
  } catch (err) {
    console.error("❌ Không thể tạo record khi check-in:", err);
  }

  return updated;
};

exports.complete = (id) => {
  return appointmentRepo.updateById(id, { status: 'completed' });
};

exports.search = (filter) => {
  return appointmentRepo.search(filter);
};

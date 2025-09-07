// services/appointment.service.js
const appointmentRepo = require('../repositories/appointment.repository');
const rpcClient = require('../utils/rpcClient');
const redis = require('../utils/redis.client');

// 🔹 Tạo mới appointment hold (chưa chiếm slot)
exports.createHold = async (data, userFromToken) => {
  const { serviceId, slotIds = [], preferredDentistId, type, patientId, patientInfo } = data;
  if (!userFromToken || !userFromToken.userId || !userFromToken.role) {
  throw new Error("❌ req.user không hợp lệ");
}

const bookedBy = userFromToken.userId;
const role = userFromToken.role;

  if (!bookedBy) throw new Error('Không xác định được người đặt cuộc hẹn');

  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    throw new Error('Cần chọn ít nhất một slot');
  }

  // 🔹 Logic xác định bệnh nhân
  let finalPatientId = null;
  let finalPatientInfo = null;

  if (role === 'patient') {
    finalPatientId = bookedBy;
  } else {
    if (patientId && patientInfo) {
      throw new Error('Chỉ được truyền patientId hoặc patientInfo, không được cả hai');
    }
    if (!patientId && !patientInfo) {
      throw new Error('Cần có patientId hoặc patientInfo khi nhân viên đặt hộ');
    }
    if (patientInfo) {
      const { name, phone, birthYear } = patientInfo;
      if (!name || !phone || !birthYear) {
        throw new Error('patientInfo không hợp lệ (thiếu name, phone hoặc birthYear)');
      }
      finalPatientInfo = patientInfo;
    } else {
      finalPatientId = patientId;
    }
  }

  // 🔹 Lấy dịch vụ từ Redis
  const servicesCache = await redis.get('services_cache');
  if (!servicesCache) throw new Error('Không tìm thấy cache dịch vụ');
  const services = JSON.parse(servicesCache);

  const selectedService = services.find(s => s._id === serviceId);
  if (!selectedService) throw new Error('Dịch vụ không hợp lệ');

  // 🔹 Nếu là dịch vụ điều trị => check hồ sơ (chỉ với patient)
  if (selectedService.type === 'treatment' && role === 'patient') {
    const examRecord = await rpcClient.request('record_queue', {
      action: 'getActiveExamRecord',
      payload: { patientId: bookedBy }
    });

    if (!examRecord) throw new Error('Bạn chưa có hồ sơ khám hợp lệ');
    if (!examRecord.validUntil || new Date(examRecord.validUntil) < new Date()) {
      throw new Error('Hồ sơ khám đã hết hiệu lực');
    }
    if (!examRecord.recommendedServices.includes(serviceId)) {
      throw new Error('Dịch vụ điều trị này chưa được chỉ định trong hồ sơ khám');
    }
  }

  // 🔹 Validate slot hợp lệ
  const validateResult = await rpcClient.request('schedule_queue', {
    action: 'validateSlotsForService',
    payload: { serviceId, dentistId: preferredDentistId, slotIds }
  });
  if (!validateResult.valid) {
    throw new Error(validateResult.reason);
  }

  const totalPrice = selectedService.price || 0;

  // =================================================================
  // 🔹 Patient flow → giữ tạm trên Redis + confirm khi thanh toán Momo
  if (role === 'patient') {
    const holdKey = `appointment_hold:${slotIds.join(',')}`;
    await redis.set(
      holdKey,
      JSON.stringify({
        serviceId: [serviceId],
        slotIds,
        preferredDentistId,
        type,
        bookedBy,
        role,
        patientId: finalPatientId,
        patientInfo: finalPatientInfo,
        status: 'booked',
        createdAt: new Date()
      }),
      'EX',
      10 * 60
    );

    // Reserve slot
    for (const sid of slotIds) {
      await rpcClient.request('schedule_queue', {
        action: 'reserved',
        payload: { slotId: sid }
      });
    }

    // Tạo payment tạm
    const payment = await rpcClient.request('payment_queue', {
      action: 'createTemporaryPayment',
      payload: {
        appointmentHoldKey: holdKey,
        slotIds,
        amount: totalPrice,
        method: 'momo'
      }
    });

    // Auto release nếu quá hạn
    setTimeout(async () => {
      const holdDataRaw = await redis.get(holdKey);
      if (!holdDataRaw) {
        for (const sid of slotIds) {
          await rpcClient.request('schedule_queue', {
            action: 'releaseSlot',
            payload: { slotId: sid }
          });
        }
        return;
      }
      const holdData = JSON.parse(holdDataRaw);
      if (holdData.status !== 'confirmed') {
        for (const sid of slotIds) {
          await rpcClient.request('schedule_queue', {
            action: 'releaseSlot',
            payload: { slotId: sid }
          });
        }
        await redis.del(holdKey);
      }
    }, 10 * 60 * 1000);

    return {
      message: 'Các slot được giữ trong 10 phút',
      holdKey,
      slotIds,
      payment
    };
  }

  // =================================================================
  // 🔹 Staff flow → tạo invoice pending ngay, confirm + checkIn luôn
  else {
    const holdKey = `appointment_hold:${slotIds.join(',')}`;
    await redis.set(
      holdKey,
      JSON.stringify({
        serviceId: [serviceId],
        slotIds,
        preferredDentistId,
        type,
        bookedBy,
        role,
        patientId: finalPatientId,
        patientInfo: finalPatientInfo,
        status: 'confirmed', // staff => confirm ngay
        createdAt: new Date()
      }),
      'EX',
      10 * 60
    );

        // Tạo payment pending (online)
    const payment = await rpcClient.request('payment_queue', {
      action: 'createPayment',
      payload: {
        appointmentHoldKey: holdKey,
        slotIds,
        amount: totalPrice,
        method: 'momo',
        status: 'pending'
      }
    });


    // Confirm appointment
    const appointment = await exports.confirm(holdKey);

    // Check-in luôn
    const checkedIn = await exports.checkIn(appointment._id);

    return {
      message: 'Tạo phiếu hẹn thành công (staff tạo, check-in ngay)',
      appointment: checkedIn,
    };
  }
};

// 🔹 Xác nhận appointment
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
    status: 'confirmed',
    paymentId: holdData.paymentId
  });
  
  // 🔹 Xử lý nhiều slot
  for (const sid of holdData.slotIds) {
    await rpcClient.request('schedule_queue', {
      action: 'confirmed',
      payload: { slotId: sid }
    });

    await rpcClient.request('schedule_queue', {
      action: 'appointmentId',
      payload: { slotId: sid, appointmentId: appointment._id }
    });
  }

  await redis.del(keyStr);
  return appointment;
};

// 🔹 Update appointment
exports.update = async (id, data) => {
  const appointment = await appointmentRepo.findById(id);
  if (!appointment) throw new Error('Không tìm thấy cuộc hẹn');

  if (data.slotId && data.slotId.toString() !== appointment.slotId.toString()) {
    if (appointment.status !== 'confirmed') {
      throw new Error('Chỉ có cuộc hẹn đã xác nhận mới được cập nhật slot');
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

// 🔹 Hủy hold
exports.cancelHold = async (slotId) => {
  const holdKey = `appointment_hold:${slotId}`;
  const holdDataRaw = await redis.get(holdKey);
  if (!holdDataRaw) throw new Error('Không tìm thấy hold');

  await rpcClient.request('schedule_queue', {
    action: 'releaseSlot',
    payload: { slotId }
  });
  await redis.del(holdKey);
  return { message: 'Hold đã bị hủy' };
};

// 🔹 Check-in
exports.checkIn = async (id) => {
  const appointment = await appointmentRepo.findById(id);
  if (!appointment) throw new Error('Không tìm thấy cuộc hẹn');
  if (appointment.status !== 'confirmed') {
    throw new Error('Chỉ có cuộc hẹn đã xác nhận mới được check-in');
  }

  const updated = await appointmentRepo.updateById(id, { status: 'checked-in' });

  try {
    const payload = {
      appointmentId: updated._id,
      dentistId: updated.preferredDentistId || updated.dentistId || null,
      serviceId: Array.isArray(updated.serviceId) 
        ? updated.serviceId.map(s => s.toString()) 
        : updated.serviceId.toString(),
      type: updated.type,
      notes: updated.notes || ""
    };

    // 🔹 Kiểm tra patient
    if (updated.patientInfo) {
      payload.patientInfo = updated.patientInfo;
    } else if (updated.bookedBy) {
      payload.bookedBy = updated.bookedBy; // patient tự đặt
    } else if (updated.patientId) {
      payload.patientId = updated.patientId; // trường hợp hiếm
    } else {
      throw new Error("Không xác định được patient để tạo record");
    }

    await rpcClient.request('record_queue', {
      action: 'createRecord',
      payload
    });

  } catch (err) {
    console.error("❌ Không thể tạo record khi check-in:", err);
  }

  return updated;
};


// 🔹 Tìm kiếm
exports.search = (filter) => {
  return appointmentRepo.search(filter);
};

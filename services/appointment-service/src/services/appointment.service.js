// services/appointment.service.js
const appointmentRepo = require('../repositories/appointment.repository');
const rpcClient = require('../utils/rpcClient');
const redis = require('../utils/redis.client');
const Appointment = require('../models/appointment.model');

async function generateAppointmentCode() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());

  const startOfDay = new Date(now.setHours(0, 0, 0, 0));
  const endOfDay = new Date(now.setHours(23, 59, 59, 999));

  const count = await Appointment.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });

  const seqNumber = String(count + 1).padStart(4, '0'); // 0001, 0002,...
  return `${seqNumber}-${dd}${mm}${yyyy}`;
}

// 🔹 Tạo mới appointment hold (chưa chiếm slot)
exports.createHold = async (data, userFromToken) => {
  const { serviceId, slotIds = [], preferredDentistId, patientInfo } = data;
  let type;
  if (!userFromToken || !userFromToken.userId || !userFromToken.role) {
    throw new Error("❌ req.user không hợp lệ");
  }
  const bookedBy = userFromToken.userId;
  const role = userFromToken.role;

  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    throw new Error('Cần chọn ít nhất một slot');
  }

  // Validate slot
  const validateResult = await rpcClient.request('schedule_queue', {
    action: 'validateSlotsForService',
    payload: { serviceId, slotIds, preferredDentistId }
  });
  if (!validateResult.valid) throw new Error(validateResult.reason);
  // 🔹 Gán type từ kết quả validate
  type = validateResult.service.type;
  let finalPatientInfo = null;
  if (role !== 'patient') {
    if (!patientInfo || !patientInfo.name || !patientInfo.phone || !patientInfo.birthYear) {
      throw new Error('patientInfo không hợp lệ khi nhân viên đặt hộ');
    }
    finalPatientInfo = patientInfo;
  }

  // Lấy service từ Redis
  const servicesCache = await redis.get('services_cache');
  if (!servicesCache) throw new Error('Không tìm thấy cache dịch vụ');
  const services = JSON.parse(servicesCache);
  const selectedService = services.find(s => s._id === serviceId);
  if (!selectedService) throw new Error('Dịch vụ không hợp lệ');

  const totalPrice = selectedService.price || 0;
  const holdKey = `appointment_hold:${slotIds.join(',')}`;

  // 🔹 Lưu hold data vào Redis
  const holdData = {
    serviceId: [serviceId],
    slotIds,
    preferredDentistId,
    type,
    bookedBy,
    role,
    patientInfo: finalPatientInfo,
    status: 'hold',
    createdAt: new Date()
  };
  await redis.set(holdKey, JSON.stringify(holdData), 'EX', 10 * 60);

  // 🔹 Reserve slot
  for (const sid of slotIds) {
    await rpcClient.request('schedule_queue', {
      action: 'reserved',
      payload: { slotIds: [sid] }
    });
  }

  // 🔹 Tạo payment tạm (patient) hoặc pending (staff)
  let payment = null;
  if (role === 'patient') {
    payment = await rpcClient.request('payment_queue', {
      action: 'createTemporaryPayment',
      payload: { appointmentHoldKey: holdKey, slotIds, amount: totalPrice, method: 'momo' }
    });
  } else {
    payment = await rpcClient.request('payment_queue', {
      action: 'createPayment',
      payload: { appointmentHoldKey: holdKey, slotIds, amount: totalPrice, method: 'momo', status: 'pending' }
    });
  }

  // 🔹 Auto release slot sau 10 phút nếu chưa confirm
  setTimeout(async () => {
    const raw = await redis.get(holdKey);
    if (!raw) {
      for (const sid of slotIds) {
        await rpcClient.request('schedule_queue', { action: 'releaseSlot', payload: { slotIds: [sid] } });
      }
      return;
    }
    const data = JSON.parse(raw);
    if (data.status !== 'confirmed') {
      for (const sid of slotIds) {
        await rpcClient.request('schedule_queue', { action: 'releaseSlot', payload: { slotIds: [sid] } });
      }
      await redis.del(holdKey);
    }
  }, 10 * 60 * 1000);

  // 🔹 Nếu staff, confirm luôn + check-in
  if (role !== 'patient') {
    const appointment = await exports.confirm({ holdKey, paymentId: payment._id });
    const checkedIn = await exports.checkIn(appointment._id);
    return { message: 'Tạo phiếu hẹn thành công (staff tạo, check-in ngay)', appointment: checkedIn };
  }

  return { message: 'Các slot được giữ trong 10 phút', holdKey, slotIds, payment };
};

// 🔹 Xác nhận appointment
exports.confirm = async ({ holdKey, paymentId = null }) => {
  if (!holdKey) throw new Error("Hold key không tồn tại hoặc đã hết hạn");

  const raw = await redis.get(holdKey);
  if (!raw) throw new Error("Hold key đã hết hạn");

  const holdData = JSON.parse(raw);
  if (holdData.status !== 'hold') throw new Error("Chỉ có thể confirm khi appointment đang ở trạng thái hold");

  // Tạo appointmentCode
  const appointmentCode = await generateAppointmentCode();

  // Tạo appointment trong DB
  const appointment = await appointmentRepo.create({
    ...holdData,
    status: 'confirmed',
    appointmentCode
  });

  // Gửi event sang payment để update appointmentCode
  if (paymentId) {
  try {
    const result = await rpcClient.request('payment_queue', {
      action: 'updateAppointmentCode',
      payload: { paymentId, appointmentCode }
    });

    // Tuỳ nhu cầu, có thể kiểm tra kết quả trả về
    if (!result || result.error) {
      throw new Error(result?.error || 'Failed to update appointmentCode in payment service');
    }
  } catch (err) {
    // Ném lỗi ra để biết thất bại
    throw new Error(`Không gửi được sự kiện updateAppointmentCode: ${err.message}`);
  }
} else {
  throw new Error('paymentId không tồn tại, không thể gửi sự kiện updateAppointmentCode');
}


  // Update slot status
  if (Array.isArray(holdData.slotIds)) {
    for (const sid of holdData.slotIds) {
      await rpcClient.request('schedule_queue', { action: 'confirmed', payload: { slotIds: [sid] } });
    }
  }

  // Xóa holdKey khỏi Redis
  await redis.del(holdKey);

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

    // 🔹 Xác định bệnh nhân
    if (updated.patientInfo) {
      // Staff đặt hộ, bệnh nhân chưa đăng ký
      payload.patientInfo = updated.patientInfo;
    } else if (updated.bookedBy) {
      // Bệnh nhân tự đặt, bookedBy = patientId
      payload.patientId = updated.bookedBy;
    } else {
      throw new Error("Không xác định được bệnh nhân để tạo record");
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

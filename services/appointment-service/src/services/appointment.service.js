// services/appointment.service.js
const appointmentRepo = require('../repositories/appointment.repository');
const rpcClient = require('../utils/rpcClient');
const redis = require('../utils/redis.client');

// Tạo mới appointment (chưa chiếm slot)
exports.createHold = async (data, userIdFromToken) => {
  const { patientId, serviceId, scheduleId, slotId, preferredDentistId, channel} = data;

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

  // 3. Check slot có thuộc schedule và trạng thái là available
  const slot = await rpcClient.request('schedule_queue', {
    action: 'getSlotById',
    payload: { slotId }
  });
  if (!slot || slot.scheduleId !== scheduleId) {
    throw new Error('Slot does not belong to the schedule');
  }
  // Kiểm tra trạng thái slot
  if (slot.status === 'confirmed') {
    throw new Error('Slot is already confirmed');
  }

  if (slot.status === 'reserved') {
    throw new Error('Slot is currently reserved by another appointment');
  }

  if (slot.status !== 'available') {
    throw new Error(`Slot is not available (status: ${slot.status})`);
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
   

  


  // 🔹 Cập nhật trạng thái slot sang "reserved"
  try {
    await rpcClient.request('schedule_queue', {
      action: 'reserved',
      payload: { slotId }
    });
    console.log(`✅ Slot ${slotId} status updated to reserved`);
  } catch (err) {
    console.error(`❌ Failed to set slot ${slotId} to reserved:`, err.message);
  }

  // 🔹 Gọi sang Payment Service để tạo payment tạm
  const payment = await rpcClient.request('payment_queue', {
    action: 'createTemporaryPayment',
    payload: {
      appointmentHoldKey: holdKey,
      slotId,
      amount: selectedService.price,  // giá dịch vụ
      method: channel || 'vnpay'
    }
  });


  console.log(`✅ Appointment hold created for slot ${slotId}`);

  // Tạo timeout để release slot tự động khi hold hết hạn
  // Tạo timeout để xử lý sau 10 phút
  setTimeout(async () => {
    const holdDataRaw = await redis.get(holdKey);
    if (!holdDataRaw) {
      // Nếu key đã hết hạn (Redis auto xóa) thì release slot
      try {
        const released = await rpcClient.request('schedule_queue', {
          action: 'releaseSlot',
          payload: { slotId }
        });
        console.log(`🔄 Slot ${slotId} automatically released after hold expired`, released);
      } catch (err) {
        console.error(`Failed to release slot ${slotId}:`, err.message);
      }
      return;
    }

    // Nếu Redis còn tồn tại (nghĩa là vẫn chưa expire sau 10 phút)
    const holdData = JSON.parse(holdDataRaw);

    if (holdData.status === 'confirmed') {
      // Nếu appointment đã confirm (do payment confirm RPC), thì push vào DB
      try {
        await exports.confirm(slotId);
        console.log(`✅ Auto-confirmed appointment for slot ${slotId} after payment`);
      } catch (err) {
        console.error(`❌ Failed to auto-confirm appointment for slot ${slotId}:`, err.message);
      }
    } else {
      // Nếu chưa confirmed thì release slot
      try {
        await rpcClient.request('schedule_queue', {
          action: 'releaseSlot',
          payload: { slotId }
        });
        await redis.del(holdKey);
        console.log(`🔄 Slot ${slotId} released after hold expired without confirmed`);
      } catch (err) {
        console.error(`❌ Failed to release slot ${slotId}:`, err.message);
      }
    }
  }, 10 * 60 * 1000); // 10 phút

  return {
      message: 'Slot hold created for 10 minutes',
      holdKey,
      slotId: slot._id
};
};



exports.confirm = async (holdKey) => {
  console.log('✅ Confirm appointment triggered for holdKey:', holdKey);

  // 1️⃣ Lấy dữ liệu appointment tạm từ Redis
  const keyStr = typeof holdKey === 'string' ? holdKey : holdKey.holdKey;
  const holdDataRaw = await redis.get(keyStr);

  console.log('holdDataRaw:', holdDataRaw);

  if (!holdDataRaw) {
    throw new Error('Hold expired or not found');
  }

  const holdData = JSON.parse(holdDataRaw);

  // 2️⃣ Kiểm tra trạng thái payment đã confirm chưa
  if (holdData.status !== 'confirmed') {
    throw new Error('Payment not confirmed yet, cannot create appointment');
  }

  // 3️⃣ Tạo appointment thật trong DB
  const appointment = await appointmentRepo.create({
    ...holdData,
    status: 'confirmed'
  });

  // 4️⃣ Cập nhật trạng thái slot sang "confirmed" trong Schedule Service
  await rpcClient.request('schedule_queue', {
    action: 'confirmed',
    payload: { slotId: holdData.slotId }
  });

  // 5️⃣ Gửi appointmentId sang Schedule Service để cập nhật slot
  await rpcClient.request('schedule_queue', {
    action: 'appointmentId',
    payload: {
      slotId: holdData.slotId,
      appointmentId: appointment._id
    }
  });

  // 6️⃣ Tạo Invoice trong Invoice Service qua RabbitMQ
  try {
  const invoiceResponse = await rpcClient.request('invoice_queue', {
    action: 'createInvoiceFromAppointment',
    payload: {
      patientId: appointment.patientId,
      appointmentId: appointment._id,
      services: appointment.serviceId.map(id => ({
        serviceId: id,
        quantity: 1,          // mặc định 1
        note: `Service from appointment ${appointment._id}`
      })),
      method: holdData.paymentMethod || 'cash',
      notes: `Invoice for appointment ${appointment._id}`
    }
  });



  console.log('✅ Invoice created from appointment:', invoiceResponse);
} catch (err) {
  console.error('❌ Failed to create invoice from appointment:', err);
  // có thể rollback hoặc chỉ log
}


  // 7️⃣ Xóa appointment tạm trong Redis
  await redis.del(keyStr);

  console.log(`✅ Appointment confirmed and created for slot ${holdData.slotId}`);
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
        update: { status: 'confirmed', appointmentId: appointment._id }
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
exports.checkIn = async (id) => {
  // 1️⃣ Lấy appointment từ DB
  const appointment = await appointmentRepo.findById(id);
  if (!appointment) throw new Error('Appointment not found');

  if (appointment.status !== 'confirmed') {
    throw new Error('Only confirmed appointments can be checked-in');
  }

  // 2️⃣ Cập nhật trạng thái trong DB
  const updated = await appointmentRepo.updateById(id, { status: 'checked-in' });

  // 3️⃣ Gọi Record Service qua RPC (thay vì publish trực tiếp bằng amqp)
  try {
     const recordResponse = await rpcClient.request('record_queue', {
    action: 'createRecord',
    payload: {
      appointmentId: updated._id,
      patientId: updated.patientId._id || updated.patientId,
      dentistId: updated.preferredDentistId || null,
      serviceId: (updated.serviceId || []).map(s => s.toString()), // ✅ đảm bảo array ObjectId string
      type: updated.type,
      notes: updated.notes || ""
      }
    });


    console.log("📤 Check-in RPC request sent to record_queue:", recordResponse);
  } catch (err) {
    console.error("❌ Failed to create record on check-in:", err);
  }

  return updated;
};


// Hoàn thành
exports.complete = (id) => {
  return appointmentRepo.updateById(id, { status: 'completed' });
};

// Tìm kiếm
exports.search = (filter) => {
  return appointmentRepo.search(filter);
};



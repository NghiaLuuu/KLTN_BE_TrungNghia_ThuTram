const Appointment = require('../models/appointment.model');
const appointmentRepo = require('../repositories/appointment.repository');
const redisClient = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitmq.client');
const rpcClient = require('../utils/rpcClient');
const serviceClient = require('../utils/serviceClient');
const { getIO } = require('../utils/socket');
const axios = require('axios');

const resolveBookingChannel = (bookedByRole) => (
  bookedByRole === 'patient' ? 'online' : 'offline'
);

class AppointmentService {
  
  async getAvailableSlotGroups(dentistId, date, serviceDuration) {
    try {
      const slots = await rpcClient.call('schedule-service', 'getSlotsByDentistAndDate', {
        dentistId,
        date
      });
      
      if (!slots || slots.length === 0) {
        return { date, dentistId, slotGroups: [] };
      }
      
      const availableSlots = [];
      for (const slot of slots) {
        if (slot.status === 'available' && slot.isActive) {
          const isLocked = await this.isSlotLocked(slot._id.toString());
          if (!isLocked) {
            availableSlots.push(slot);
          }
        }
      }
      
      const slotGroups = this.groupConsecutiveSlots(availableSlots, serviceDuration);
      const dentistInfo = await this.getDentistInfo(dentistId);
      
      return {
        date,
        dentistId,
        dentistName: dentistInfo?.name || 'Unknown',
        serviceDuration,
        slotGroups
      };
      
    } catch (error) {
      console.error('Error getting available slot groups:', error);
      throw new Error('Cannot get slot groups: ' + error.message);
    }
  }
  
  groupConsecutiveSlots(slots, serviceDuration) {
    slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    
    const slotDuration = 15;
    const slotsNeeded = Math.ceil(serviceDuration / slotDuration);
    const groups = [];
    
    for (let i = 0; i <= slots.length - slotsNeeded; i++) {
      const group = [];
      let isConsecutive = true;
      
      for (let j = 0; j < slotsNeeded; j++) {
        const currentSlot = slots[i + j];
        group.push(currentSlot);
        
        if (j > 0) {
          const prevSlot = slots[i + j - 1];
          const prevEnd = new Date(prevSlot.endTime);
          const currentStart = new Date(currentSlot.startTime);
          const timeDiff = (currentStart - prevEnd) / 60000;
          
          if (timeDiff !== 0) {
            isConsecutive = false;
            break;
          }
        }
      }
      
      if (isConsecutive) {
        const firstSlot = group[0];
        const lastSlot = group[group.length - 1];
        
        groups.push({
          groupId: this.formatTime(firstSlot.startTime) + '-' + this.formatTime(lastSlot.endTime),
          startTime: this.formatTime(firstSlot.startTime),
          endTime: this.formatTime(lastSlot.endTime),
          duration: serviceDuration,
          roomId: firstSlot.roomId,
          subRoomId: firstSlot.subRoomId,
          slots: group.map(s => ({
            _id: s._id,
            startTime: this.formatTime(s.startTime),
            endTime: this.formatTime(s.endTime)
          }))
        });
      }
    }
    
    return groups;
  }
  
  formatTime(dateTime) {
    // Slot startTime/endTime được lưu dạng UTC Date trong schedule-service
    // Cần chuyển sang múi giờ Việt Nam (UTC+7) trước khi lưu dạng "HH:MM"
    const date = new Date(dateTime);
    
    // Lấy các thành phần UTC
    const utcHours = date.getUTCHours();
    const utcMinutes = date.getUTCMinutes();
    
    // Chuyển sang múi giờ Việt Nam (UTC+7)
    let vnHours = utcHours + 7;
    
    // Xử lý tràn ngày (vd: 23:00 UTC + 7 = 06:00 ngày hôm sau)
    if (vnHours >= 24) {
      vnHours -= 24;
    }
    
    const hours = String(vnHours).padStart(2, '0');
    const minutes = String(utcMinutes).padStart(2, '0');
    return hours + ':' + minutes;
  }
  
  /**
   * Kiểm tra slot có đang bị khóa tạm trong Redis không (trong 3 phút giữ chỗ)
   * KHÔNG phải kiểm tra slot.isBooked trong DB - việc đó thực hiện trong validateSlotsAvailable
   * @param {String} slotId 
   * @returns {Boolean} true nếu đang bị khóa trong Redis
   */
  async isSlotLocked(slotId) {
    try {
      const lock = await redisClient.get('temp_slot_lock:' + slotId);
      if (lock) {
        // Kiểm tra xem có phải lock của chính mình không (cho phép retry cùng user)
        const lockData = JSON.parse(lock);
        console.log(`⏳ Slot ${slotId} đang bị khóa bởi reservation ${lockData.reservationId}`);
      }
      return lock !== null;
    } catch (error) {
      console.warn('⚠️ Kiểm tra Redis thất bại, giả sử không bị khóa:', error);
      return false; // Fail open - cho phép đặt chỗ nếu Redis không hoạt động
    }
  }
  
  async reserveAppointment(reservationData, currentUser) {
    try {
      const {
        patientId, patientInfo, serviceId, serviceAddOnId,
        dentistId, slotIds, date, notes
      } = reservationData;
      
      // Chuẩn hóa role của currentUser (hỗ trợ cả role và roles)
      const userRole = currentUser.activeRole || currentUser.role || currentUser.roles?.[0] || 'unknown';
      
      // 1️⃣ Lấy cấu hình lịch để lấy số tiền cọc
      const scheduleConfig = await serviceClient.getScheduleConfig();
      const depositAmount = scheduleConfig.depositAmount || 100000; // Mặc định 100k VND
      
      // Xác thực slot và lấy thông tin chi tiết (query một lần, tái sử dụng)
      const slots = await this.validateSlotsAvailable(slotIds);
      const serviceInfo = await this.getServiceInfo(serviceId, serviceAddOnId);
      const dentistInfo = await this.getDentistInfo(dentistId);
      
      const reservationId = 'RSV' + Date.now();
      
      // Sắp xếp slot theo thời gian
      slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      
      const firstSlot = slots[0]; // Sử dụng slot đầu tiên từ mảng đã sắp xếp
      
      // 🔧 Trích xuất roomId và subRoomId (xử lý cả trường hợp đã populate và chưa populate)
      // Khi đã populate: roomId/subRoomId là objects { _id, name }
      // Khi chưa populate: roomId/subRoomId là strings (ObjectId)
      const extractId = (field) => {
        if (!field) return null;
        return typeof field === 'object' && field._id ? field._id.toString() : field.toString();
      };
      
      const roomId = extractId(firstSlot.roomId);
      const subRoomId = extractId(firstSlot.subRoomId);
      
      console.log('🔍 [reserveAppointment] firstSlot data:', JSON.stringify({
        _id: firstSlot._id,
        roomId: roomId,
        subRoomId: subRoomId,
        status: firstSlot.status,
        startTime: firstSlot.startTime
      }, null, 2));
      
      const startTime = this.formatTime(firstSlot.startTime);
      const endTime = this.formatTime(slots[slots.length - 1].endTime);
      
      // 💰 Tính tổng tiền cọc: depositAmount × số lượng slot
      const totalDepositAmount = depositAmount * slotIds.length;
      
      // 🏠 Lấy tên phòng/phòng con từ room-service
      const roomInfo = await this.getRoomInfo(roomId, subRoomId);
      console.log('🔍 [reserveAppointment] roomInfo result:', JSON.stringify(roomInfo, null, 2));
      
      const reservation = {
        reservationId, patientId, patientInfo,
        serviceId, serviceName: serviceInfo.serviceName,
        serviceType: serviceInfo.serviceType,
        serviceAddOnId, serviceAddOnName: serviceInfo.serviceAddOnName,
        serviceDuration: serviceInfo.serviceDuration,
        servicePrice: serviceInfo.servicePrice,
        dentistId, dentistName: dentistInfo.name,
        slotIds, appointmentDate: date, startTime, endTime,
        roomId: roomId, 
        roomName: roomInfo.roomName,
        subroomId: subRoomId || null,
        subroomName: roomInfo.subroomName,
        notes: notes || '',
        bookedBy: currentUser._id, 
        bookedByRole: userRole, // Use normalized role
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3 * 60 * 1000)
      };
      
      console.log('🔍 [reserveAppointment] reservation object:', JSON.stringify({
        reservationId: reservation.reservationId,
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        subroomId: reservation.subroomId,
        subroomName: reservation.subroomName
      }, null, 2));
      
      // 2️⃣ Khóa slot trong DB (đặt status='locked')
      try {
        const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
        await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
          slotIds,
          updates: {
            status: 'locked',
            lockedAt: new Date(),
            lockedBy: reservationId
          }
        });
        console.log('✅ Đã khóa slot trong DB (status=locked)');
      } catch (error) {
        console.error('❌ Không thể khóa slot trong DB:', error.message);
        // Tiếp tục anyway - Redis lock là chính
      }
      
      // 3️⃣ Lưu reservation + locks trong Redis (TTL 3 phút)
      const ttl = 3 * 60; // 180 giây = 3 phút
      await redisClient.setEx(
        'temp_reservation:' + reservationId,
        ttl,
        JSON.stringify(reservation)
      );
      
      for (const slotId of slotIds) {
        await redisClient.setEx(
          'temp_slot_lock:' + slotId,
          ttl,
          JSON.stringify({ reservationId, lockedAt: new Date() })
        );
      }
      
      // 4️⃣ Tạo thanh toán tạm với số tiền cọc (thay thế RPC)
      const paymentResult = await serviceClient.createTemporaryPayment(
        reservationId, // appointmentHoldKey
        totalDepositAmount // 💰 Sử dụng số tiền cọc: depositAmount × slotCount
      );
      
      return {
        reservationId,
        orderId: reservationId, // Cho thanh toán
        paymentUrl: paymentResult.paymentUrl,
        amount: totalDepositAmount, // 💰 Trả về số tiền cọc
        servicePrice: totalDepositAmount, // Để hiển thị
        depositPerSlot: depositAmount, // 🆕 Hiển thị tiền cọc mỗi slot
        slotCount: slotIds.length, // 🆕 Hiển thị số lượng slot
        expiresAt: reservation.expiresAt,
        // ✅ Thêm đầy đủ chi tiết reservation để hiển thị
        serviceName: serviceInfo.serviceName,
        serviceAddOnName: serviceInfo.serviceAddOnName,
        dentistName: dentistInfo.name,
        appointmentDate: date,
        startTime: startTime,
        endTime: endTime,
        roomName: roomInfo.roomName || 'Sẽ được thông báo',
        subroomName: roomInfo.subroomName || null
      };
      
    } catch (error) {
      console.error('Error reserving appointment:', error);
      throw new Error(error.message || 'Không thể đặt lịch hẹn. Vui lòng thử lại sau.');
    }
  }
  
  /**
   * Xác thực slot khả dụng và trả về chi tiết slot
   * @param {Array<String>} slotIds 
   * @returns {Array<Object>} slots - Mảng các object slot
   */
  async validateSlotsAvailable(slotIds) {
    // 1️⃣ Query tất cả slot một lần (query song song cho hiệu năng)
    const slots = await Promise.all(slotIds.map(id => this.getSlotInfo(id)));
    
    // 2️⃣ Xác thực từng slot
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const slotId = slotIds[i];
      
      // Kiểm tra đã đặt hoặc bị khóa trong database
      if (slot.status === 'booked') {
        throw new Error('Khung giờ này đã được đặt. Vui lòng chọn khung giờ khác.');
      }
      
      if (slot.status === 'locked') {
        throw new Error('Khung giờ này đang được giữ chỗ. Vui lòng chọn khung giờ khác hoặc đợi 3 phút để đặt lại nếu bạn đang trong quá trình thanh toán.');
      }
      
      // 3️⃣ Kiểm tra khóa tạm trong Redis (kiểm tra dự phòng)
      const isLocked = await this.isSlotLocked(slotId);
      if (isLocked) {
        throw new Error('Khung giờ này đang được giữ chỗ. Vui lòng chọn khung giờ khác hoặc đợi 3 phút để đặt lại nếu bạn đang trong quá trình thanh toán.');
      }
    }
    
    // Trả về slot đã xác thực để tái sử dụng
    return slots;
  }
  
  async getServiceInfo(serviceId, serviceAddOnId) {
    try {
      // ✅ Nếu không có serviceAddOnId, chỉ lấy service
      if (!serviceAddOnId) {
        console.log('⚠️ [getServiceInfo] Không có serviceAddOnId, chỉ lấy service');
        
        const serviceResult = await rpcClient.call('service-service', 'getService', {
          serviceId
        });
        
        console.log('📦 [getServiceInfo] Kết quả chỉ có service:', JSON.stringify(serviceResult));
        
        if (!serviceResult || !serviceResult.service) {
          throw new Error('Không tìm thấy dịch vụ');
        }
        
        const service = serviceResult.service;
        
        return {
          serviceId: service._id,
          serviceName: service.name,
          serviceType: service.type,
          serviceDuration: 30, // Thời lượng mặc định
          servicePrice: service.price || 0,
          serviceAddOnId: null,
          serviceAddOnName: null,
          serviceAddOnPrice: 0
        };
      }
      
      // 🔥 Gọi API service-service với serviceAddOnId
      const result = await rpcClient.call('service-service', 'getServiceAddOn', {
        serviceId, serviceAddOnId
      });
      
      console.log('📦 [getServiceInfo] Kết quả RPC thô:', JSON.stringify(result));
      
      if (!result || !result.service || !result.addOn) {
        throw new Error('Không tìm thấy Service hoặc ServiceAddOn');
      }
      
      const { service, addOn } = result;
      
      // ✅ Build response đầy đủ với tất cả các trường cần thiết
      return {
        serviceId: service._id,
        serviceName: service.name,
        serviceType: service.type, // ⭐ Service model dùng 'type' không phải 'serviceType'
        serviceDuration: addOn.durationMinutes || addOn.duration, // ⭐ ServiceAddOn dùng 'durationMinutes'
        servicePrice: service.price || 0,
        serviceAddOnId: addOn._id,
        serviceAddOnName: addOn.name,
        serviceAddOnPrice: addOn.effectivePrice || addOn.basePrice || addOn.price || 0
      };
    } catch (error) {
      console.error('❌ [getServiceInfo] Lỗi:', error);
      throw new Error('Không thể lấy thông tin dịch vụ: ' + error.message);
    }
  }
  
  async getDentistInfo(dentistId) {
    try {
      // 🔥 Gọi API auth-service trực tiếp (không còn cache Redis)
      const { sendRpcRequest } = require('../utils/rabbitmq.client');
      
      console.log(`🔍 [Appointment] Đang yêu cầu thông tin nha sĩ với ID: ${dentistId}`);
      
      const userResult = await sendRpcRequest('auth_queue', {
        action: 'getUserById',
        payload: { userId: dentistId.toString() }
      }, 20000); // Tăng timeout lên 20s
      
      console.log(`📥 [Appointment] Phản hồi từ auth-service:`, JSON.stringify(userResult));
      
      if (!userResult || !userResult.success || !userResult.data) {
        console.error('❌ [Appointment] Phản hồi không hợp lệ từ auth-service:', userResult);
        throw new Error('Không tìm thấy nha sĩ');
      }
      
      const dentist = userResult.data;
      
      // ⭐ Trả về object đã chuẩn hóa với trường 'name'
      return {
        _id: dentist._id,
        name: dentist.fullName || dentist.name, // Hỗ trợ cả fullName và name
        specialization: dentist.specializations?.[0] || dentist.specialization
      };
    } catch (error) {
      console.error('❌ [Appointment] Lỗi getDentistInfo:', error);
      throw new Error('Không thể lấy thông tin nha sĩ: ' + error.message);
    }
  }

  /**
   * Lấy tên phòng và phòng con từ room-service (gọi API trực tiếp)
   * @param {String} roomId - ID phòng
   * @param {String|null} subroomId - ID phòng con (tùy chọn)
   * @returns {Object} { roomName, subroomName }
   */
  async getRoomInfo(roomId, subroomId = null) {
    try {
      let roomName = 'Phòng khám';
      let subroomName = null;

      // 🔥 Gọi API room-service trực tiếp (không còn cache Redis)
      if (roomId) {
        const { sendRpcRequest } = require('../utils/rabbitmq.client');
        const roomResult = await sendRpcRequest('room_queue', {
          action: 'getRoomById',
          payload: { roomId: roomId.toString() }
        }, 5000);
        
        if (roomResult && roomResult.success && roomResult.data) {
          const room = roomResult.data;
          roomName = room.name || roomName;
          
          // Tìm phòng con nếu có
          if (subroomId && room.subRooms && Array.isArray(room.subRooms)) {
            const subroom = room.subRooms.find(sr => sr._id.toString() === subroomId.toString());
            if (subroom) {
              subroomName = subroom.name;
            }
          }
        }
      }

      console.log(`🏠 [getRoomInfo] roomId=${roomId}, subroomId=${subroomId} → roomName="${roomName}", subroomName="${subroomName}"`);
      return { roomName, subroomName };
    } catch (error) {
      console.warn('⚠️ Không thể lấy thông tin phòng từ API:', error.message);
      // Trả về giá trị mặc định nếu API không hoạt động
      return { roomName: 'Phòng khám', subroomName: null };
    }
  }
  
  /**
   * Lấy thông tin slot từ schedule-service DB (nguồn dữ liệu chính)
   * Kiểm tra slot.status thực tế trong database, không phải Redis
   * @param {String} slotId 
   * @returns {Object} slot với status, appointmentId, dentist, v.v.
   */
  async getSlotInfo(slotId) {
    try {
      // Sử dụng HTTP call đến schedule-service để lấy status DB thời gian thực
      const slot = await serviceClient.getSlot(slotId);
      if (!slot) {
        throw new Error('Không tìm thấy slot');
      }
      
      console.log(`📅 Slot ${slotId} DB status: ${slot.status}, appointmentId: ${slot.appointmentId || 'null'}`);
      return slot;
    } catch (error) {
      console.error('[AppointmentService] Lỗi getSlotInfo:', error.message);
      throw new Error('Không thể lấy thông tin slot: ' + error.message);
    }
  }
  
  async createAppointmentFromPayment(paymentSuccessData) {
    try {
      const { reservationId, paymentId } = paymentSuccessData;
      
      const reservationStr = await redisClient.get('temp_reservation:' + reservationId);
      if (!reservationStr) {
        throw new Error('Reservation not found or expired');
      }
      
      const reservation = JSON.parse(reservationStr);
      
      console.log('🔍 [createAppointmentFromPayment] reservation from Redis:', JSON.stringify({
        reservationId: reservation.reservationId,
        serviceType: reservation.serviceType, // ⭐ Check if serviceType exists
        serviceDuration: reservation.serviceDuration, // ⭐ Check if serviceDuration exists
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        subroomId: reservation.subroomId,
        subroomName: reservation.subroomName
      }, null, 2));
      
      // 🔧 FIX: Nếu reservation thiếu serviceType/serviceDuration, lấy lại từ service-service
      if (!reservation.serviceType || !reservation.serviceDuration) {
        console.warn('⚠️ [createAppointmentFromPayment] Thiếu serviceType hoặc serviceDuration trong reservation, đang lấy lại...');
        const serviceInfo = await this.getServiceInfo(reservation.serviceId, reservation.serviceAddOnId);
        reservation.serviceType = serviceInfo.serviceType;
        reservation.serviceDuration = serviceInfo.serviceDuration;
        console.log('✅ [createAppointmentFromPayment] Đã lấy lại serviceInfo:', { 
          serviceType: serviceInfo.serviceType, 
          serviceDuration: serviceInfo.serviceDuration 
        });
      }
      
      const appointmentDate = new Date(reservation.appointmentDate);
      const appointmentCode = await Appointment.generateAppointmentCode(appointmentDate);
      
      const appointment = new Appointment({
        appointmentCode,
        patientId: reservation.patientId,
        patientInfo: reservation.patientInfo,
        serviceId: reservation.serviceId,
        serviceName: reservation.serviceName,
        serviceType: reservation.serviceType,
        serviceAddOnId: reservation.serviceAddOnId,
        serviceAddOnName: reservation.serviceAddOnName,
        serviceDuration: reservation.serviceDuration,
        servicePrice: reservation.servicePrice,
        dentistId: reservation.dentistId,
        dentistName: reservation.dentistName,
        slotIds: reservation.slotIds,
        appointmentDate,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        subroomId: reservation.subroomId || null,
        subroomName: reservation.subroomName || null,
        paymentId,
        totalAmount: reservation.servicePrice,
        status: 'confirmed',
        bookedAt: new Date(),
        bookedBy: reservation.bookedBy,
  bookedByRole: reservation.bookedByRole,
        notes: reservation.notes
      });
      
      console.log('🔍 [createAppointmentFromPayment] appointment before save:', JSON.stringify({
        appointmentCode: appointment.appointmentCode,
        roomId: appointment.roomId,
        roomName: appointment.roomName,
        subroomId: appointment.subroomId,
        subroomName: appointment.subroomName
      }, null, 2));
      
      await appointment.save();
      
      console.log('🔍 [createAppointmentFromPayment] appointment after save:', JSON.stringify({
        appointmentCode: appointment.appointmentCode,
        roomId: appointment.roomId,
        roomName: appointment.roomName,
        subroomId: appointment.subroomId,
        subroomName: appointment.subroomName
      }, null, 2));
      
      await serviceClient.bulkUpdateSlots(reservation.slotIds, {
        status: 'booked',
        appointmentId: appointment._id
      });
      
      // Đánh dấu dịch vụ đã sử dụng qua Queue (không blocking)
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: [{
              serviceId: reservation.serviceId,
              serviceAddOnId: reservation.serviceAddOnId
            }]
          }
        });
        console.log('✅ Đã publish event đánh dấu dịch vụ đã sử dụng (từ reservation)');
      } catch (queueError) {
        console.warn('⚠️ Không thể publish event dịch vụ:', queueError.message);
        // Không throw - cho phép tạo lịch hẹn tiếp tục
      }
      
      // 🔓 Dọn dẹp reservation và slot locks từ Redis (idempotent - an toàn khi gọi nhiều lần)
      try {
        await redisClient.del('temp_reservation:' + reservationId);
        console.log('✅ Đã xóa reservation từ Redis:', reservationId);
      } catch (error) {
        console.warn('⚠️ Không thể xóa reservation từ Redis:', error.message);
      }
      
      for (const slotId of reservation.slotIds) {
        try {
          const deleted = await redisClient.del('temp_slot_lock:' + slotId);
          if (deleted > 0) {
            console.log(`🔓 [Thanh toán thành công] Đã xóa Redis lock cho slot ${slotId}`);
          } else {
            console.log(`ℹ️ [Thanh toán thành công] Không có Redis lock cho slot ${slotId} (đã xóa hoặc hết hạn)`);
          }
        } catch (redisError) {
          console.warn(`⚠️ Không thể xóa Redis lock cho slot ${slotId}:`, redisError.message);
        }
      }
      
      await publishToQueue('invoice_queue', {
        event: 'appointment_created',
        data: {
          appointmentId: appointment._id,
          appointmentCode: appointment.appointmentCode,
          patientId: appointment.patientId,
          patientInfo: appointment.patientInfo,
          serviceId: appointment.serviceId,
          serviceName: appointment.serviceName,
          serviceAddOnId: appointment.serviceAddOnId,
          serviceAddOnName: appointment.serviceAddOnName,
          servicePrice: appointment.servicePrice,
          dentistId: appointment.dentistId,
          dentistName: appointment.dentistName,
          roomId: appointment.roomId,
          roomName: appointment.roomName,
          subroomId: appointment.subroomId,
          subroomName: appointment.subroomName,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          paymentId,
          totalAmount: appointment.totalAmount
        }
      });
      
      console.log('Đã tạo lịch hẹn: ' + appointmentCode);
      return appointment;
      
    } catch (error) {
      console.error('Lỗi tạo lịch hẹn từ thanh toán:', error);
      throw error;
    }
  }
  
  // cancelReservation() đã xóa - reservations tự hết hạn sau 3 phút (Redis TTL)
  // Nếu bệnh nhân không thanh toán, Redis sẽ tự xóa temp_reservation và temp_slot_lock keys
  
  async getByCode(appointmentCode) {
    const appointment = await Appointment.findByCode(appointmentCode);
    if (!appointment) throw new Error('Appointment not found');
    return appointment;
  }
  
  async getByPatient(patientId, filters = {}) {
    return await Appointment.findByPatient(patientId, filters);
  }
  
  async getByDentist(dentistId, filters = {}) {
    return await Appointment.findByDentist(dentistId, filters);
  }
  
  async checkIn(appointmentId, userId) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) throw new Error('Appointment not found');
    
    console.log('🔍 [CheckIn] Appointment status:', {
      appointmentId,
      currentStatus: appointment.status,
      canCheckIn: appointment.canCheckIn(),
      appointmentCode: appointment.appointmentCode
    });
    
    // Nếu đã check-in/in-progress/completed, trả về thành công (idempotent)
    if (['checked-in', 'in-progress', 'completed'].includes(appointment.status)) {
      console.log('⚠️ [CheckIn] Đã check-in/in-progress/completed, bỏ qua...');
      return appointment;
    }
    
    if (!appointment.canCheckIn()) {
      throw new Error(`Không thể check-in lịch hẹn này. Trạng thái hiện tại: ${appointment.status}`);
    }
    
  // ✅ Check-in: chuyển trạng thái sang 'checked-in'
  appointment.status = 'checked-in';
  appointment.checkedInAt = new Date();
  appointment.checkedInBy = userId;
    await appointment.save();
    
    // 🔥 EMIT SOCKET TRỰC TIẾP: Thông báo Queue Dashboard ngay lập tức
    // Queue Dashboard kết nối với CẢ appointment-service (3006) VÀ record-service (3010)
    try {
      const { emitAppointmentStatusChange, emitQueueUpdate } = require('../utils/socket');
      
      if (appointment.roomId && appointment.appointmentDate) {
        const date = new Date(appointment.appointmentDate).toISOString().split('T')[0];
        
        // Populate cho socket emit
        const appointmentWithDate = {
          ...appointment.toObject(),
          date: date
        };
        
        // Emit trực tiếp đến socket appointment-service (port 3006)
        emitAppointmentStatusChange(appointmentWithDate);
        emitQueueUpdate(appointment.roomId, date, `${appointment.patientInfo?.name || 'Bệnh nhân'} đã check-in`);
        
        console.log(`📡 [CheckIn] Đã emit socket events trực tiếp từ appointment-service`);
      }
    } catch (socketError) {
      console.warn('⚠️ Không thể emit socket:', socketError.message);
    }
    
    const bookingChannel = resolveBookingChannel(appointment.bookedByRole);

    // 🔥 Publish event đến record-service để tự động tạo hồ sơ khám
    try {
      await publishToQueue('record_queue', {
        event: 'appointment_checked-in',
        data: {
          appointmentId: appointment._id.toString(),
          appointmentCode: appointment.appointmentCode,
          patientId: appointment.patientId ? appointment.patientId.toString() : null,
          patientInfo: appointment.patientInfo,
          serviceId: appointment.serviceId.toString(),
          serviceName: appointment.serviceName,
          servicePrice: appointment.servicePrice || 0, // ✅ Giá dịch vụ chính
          serviceAddOnId: appointment.serviceAddOnId ? appointment.serviceAddOnId.toString() : null,
          serviceAddOnName: appointment.serviceAddOnName || null,
          serviceAddOnPrice: appointment.serviceAddOnPrice || 0, // ✅ Giá dịch vụ con
          totalAmount: appointment.totalAmount || ((appointment.servicePrice || 0) + (appointment.serviceAddOnPrice || 0)), // ✅ Tổng tiền
          serviceType: appointment.serviceType,
          bookingChannel,
          dentistId: appointment.dentistId.toString(),
          dentistName: appointment.dentistName,
          roomId: appointment.roomId ? appointment.roomId.toString() : null,
          roomName: appointment.roomName || null,
          subroomId: appointment.subroomId ? appointment.subroomId.toString() : null,
          subroomName: appointment.subroomName || null,
          appointmentDate: appointment.appointmentDate,
          checkedInAt: appointment.checkedInAt,
          checkedInBy: userId.toString()
        }
      });
      console.log(`✅ Đã publish event appointment_checked-in cho lịch hẹn ${appointment.appointmentCode}`);
    } catch (publishError) {
      console.error('❌ Không thể publish event appointment_checked-in:', publishError);
      // Không throw lỗi - appointment check-in vẫn thành công
    }
    
    return appointment;
  }
  
  async complete(appointmentId, userId, completionData) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) throw new Error('Không tìm thấy lịch hẹn');
    
    if (!appointment.canComplete()) {
      throw new Error('Không thể hoàn thành lịch hẹn này');
    }
    
    appointment.status = 'completed';
    appointment.completedAt = new Date();
    appointment.completedBy = userId;
    appointment.actualDuration = completionData.actualDuration || appointment.serviceDuration;
    
    if (completionData.notes) {
      appointment.notes = appointment.notes 
        ? appointment.notes + '\n---\n' + completionData.notes
        : completionData.notes;
    }
    
    await appointment.save();
    
    // 🔥 PUBLISH ĐẾN RECORD SERVICE: Để record-service emit socket
    try {
      if (appointment.roomId && appointment.appointmentDate) {
        const date = new Date(appointment.appointmentDate).toISOString().split('T')[0];
        
        await publishToQueue('record_queue', {
          event: 'appointment.status_changed',
          data: {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointment.appointmentCode,
            status: 'completed',
            roomId: appointment.roomId.toString(),
            date: date,
            patientName: appointment.patientInfo?.name,
            message: `${appointment.patientInfo?.name || 'Bệnh nhân'} đã hoàn thành`
          }
        });
        
        console.log(`📡 [Complete] Đã publish thay đổi trạng thái đến record-service để emit socket`);
      }
    } catch (socketError) {
      console.warn('⚠️ Không thể publish thay đổi trạng thái:', socketError.message);
    }
    
    // 🔥 Publish event appointment.completed (RabbitMQ cho các service khác)
    try {
      await publishToQueue('appointment_queue', {
        event: 'appointment.completed',
        data: {
          appointmentId: appointment._id.toString(),
          appointmentCode: appointment.appointmentCode,
          patientId: appointment.patientId ? appointment.patientId.toString() : null,
          patientInfo: appointment.patientInfo,
          serviceId: appointment.serviceId.toString(),
          serviceName: appointment.serviceName,
          serviceType: appointment.serviceType,
          dentistId: appointment.dentistId.toString(),
          dentistName: appointment.dentistName,
          roomId: appointment.roomId ? appointment.roomId.toString() : null,
          completedAt: appointment.completedAt,
          completedBy: userId.toString(),
          actualDuration: appointment.actualDuration
        }
      });
      console.log(`✅ Đã publish event appointment.completed cho ${appointment.appointmentCode}`);
    } catch (publishError) {
      console.error('❌ Không thể publish event appointment.completed:', publishError);
    }
    
    return appointment;
  }
  
  /**
   * Yêu cầu hủy lịch hẹn cho đặt online
   * Bệnh nhân có thể yêu cầu nếu lịch hẹn >= 1 ngày trước
   */
  async requestCancellation(appointmentId, patientId, reason) {
    const appointment = await Appointment.findById(appointmentId);
    
    if (!appointment) {
      throw new Error('Không tìm thấy phiếu khám');
    }
    
    // Kiểm tra bệnh nhân có sở hữu lịch hẹn này không
    if (appointment.patientId.toString() !== patientId.toString()) {
      throw new Error('Bạn không có quyền yêu cầu hủy phiếu khám này');
    }
    
    // Kiểm tra có thể yêu cầu hủy không
    const canRequest = appointment.canRequestCancellation();
    if (!canRequest.canRequest) {
      throw new Error(canRequest.reason);
    }
    
    // Cập nhật status sang pending-cancellation và lưu lý do vào notes
    appointment.status = 'pending-cancellation';
    appointment.cancellationRequestedAt = new Date();
    appointment.cancellationRequestedBy = patientId;
    appointment.cancellationRequestReason = reason || 'Không có lý do';
    appointment.notes = reason || 'Không có lý do'; // ✅ Lưu lý do vào trường notes
    await appointment.save();
    
    // 🔥 Publish event để thông báo
    try {
      await publishToQueue('appointment_queue', {
        event: 'cancellation_requested',
        data: {
          appointmentId: appointment._id,
          appointmentCode: appointment.appointmentCode,
          patientName: appointment.patientInfo?.name,
          patientPhone: appointment.patientInfo?.phone,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          reason: reason || 'Không có lý do'
        }
      });
      
      console.log(`📡 [Yêu cầu hủy] Đã publish event cho ${appointment.appointmentCode}`);
    } catch (error) {
      console.warn('⚠️ Không thể publish event yêu cầu hủy:', error.message);
    }
    
    return appointment;
  }

  /**
   * Admin/Manager/Receptionist hủy lịch hẹn
   * Không giới hạn thời gian - có thể hủy bất cứ lúc nào
   */
  async adminCancelAppointment(appointmentId, staffId, staffRole, reason, currentUser = null) {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId', 'email fullName name phoneNumber');
    
    if (!appointment) {
      throw new Error('Không tìm thấy phiếu khám');
    }
    
    console.log('🔍 [adminCancelAppointment] Appointment data:', {
      _id: appointment._id,
      appointmentCode: appointment.appointmentCode,
      status: appointment.status,
      patientId: appointment.patientId ? {
        _id: appointment.patientId._id,
        email: appointment.patientId.email,
        fullName: appointment.patientId.fullName
      } : 'NULL',
      patientInfo: appointment.patientInfo
    });
    
    // Kiểm tra lịch hẹn có thể hủy không
    if (appointment.status === 'cancelled') {
      throw new Error('Phiếu khám đã bị hủy trước đó');
    }
    
    if (appointment.status === 'completed') {
      throw new Error('Không thể hủy phiếu khám đã hoàn thành');
    }

    // 🔥 Lấy email bệnh nhân để thông báo
    let patientEmail = null;
    let patientName = null;
    let patientPhone = null;
    let patientIdStr = null;
    
    // Thử lấy từ patientId đã populate trước
    if (appointment.patientId) {
      // Kiểm tra patientId đã được populate (object) hay chỉ là ObjectId
      if (typeof appointment.patientId === 'object' && appointment.patientId._id) {
        patientIdStr = appointment.patientId._id.toString();
        patientEmail = appointment.patientId.email;
        patientName = appointment.patientId.fullName || appointment.patientId.name;
        patientPhone = appointment.patientId.phoneNumber;
      } else {
        // Chỉ là ObjectId, chưa populate
        patientIdStr = appointment.patientId.toString();
      }
    }
    
    // Fallback sang patientInfo
    if (!patientEmail && appointment.patientInfo?.email) {
      patientEmail = appointment.patientInfo.email;
    }
    if (!patientName && appointment.patientInfo?.name) {
      patientName = appointment.patientInfo.name;
    }
    if (!patientPhone && appointment.patientInfo?.phone) {
      patientPhone = appointment.patientInfo.phone;
    }
    
    console.log('📧 [adminCancelAppointment] Đã trích xuất thông tin bệnh nhân:', {
      patientEmail,
      patientName,
      patientPhone,
      patientIdStr
    });
    
    // Cập nhật status sang cancelled
    const cancelledAt = new Date();
    appointment.status = 'cancelled';
    appointment.cancellationRequestedAt = cancelledAt;
    appointment.cancellationRequestedBy = staffId;
    appointment.cancellationRequestReason = reason || 'Hủy bởi ' + staffRole;
    appointment.cancelledAt = cancelledAt;
    appointment.cancelledBy = staffId;
    appointment.cancellationReason = reason || 'Hủy bởi ' + staffRole;
    
    await appointment.save();
    
    const appointmentIdStr = appointment._id.toString();
    const appointmentCode = appointment.appointmentCode;
    
    console.log(`✅ [Admin Cancel] Lịch hẹn ${appointmentCode} đã bị hủy bởi ${staffRole}`);

    // 🔥 Giải phóng slot về trạng thái available
    if (appointment.slotIds && appointment.slotIds.length > 0) {
      try {
        await serviceClient.bulkUpdateSlots(appointment.slotIds, {
          status: 'available',
          appointmentId: null
        });
        console.log(`🔓 [Admin Cancel] Đã giải phóng ${appointment.slotIds.length} slot về trạng thái available`);
        
        // 🔥 QUAN TRỌNG: Xóa Redis locks cho các slot này (dù không tìm thấy cũng không lỗi)
        for (const slotId of appointment.slotIds) {
          try {
            const deleted = await redisClient.del('temp_slot_lock:' + slotId);
            if (deleted > 0) {
              console.log(`🔓 [Admin Cancel] Đã xóa Redis lock cho slot ${slotId}`);
            } else {
              console.log(`ℹ️ [Admin Cancel] Không tìm thấy Redis lock cho slot ${slotId} (đã hết hạn hoặc không bị khóa)`);
            }
          } catch (redisError) {
            console.warn(`⚠️ Không thể xóa Redis lock cho slot ${slotId}:`, redisError.message);
          }
        }
      } catch (slotError) {
        console.warn('⚠️ Không thể giải phóng slot:', slotError.message);
      }
    }

    // 🔥 Ghi log hủy vào DayClosure (để theo dõi từng hủy lịch hẹn bởi nhân viên)
    try {
      await publishToQueue('schedule_queue', {
        event: 'log_appointment_cancellation',
        data: {
          appointmentId: appointmentIdStr,
          appointmentCode: appointmentCode,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          shiftName: appointment.shiftName || 'N/A',
          patientId: patientIdStr,
          patientName: patientName,
          patientEmail: patientEmail,
          patientPhone: patientPhone,
          roomId: appointment.roomId?.toString(),
          roomName: appointment.roomName,
          dentistId: appointment.dentistId?.toString(),
          dentistName: appointment.dentistName,
          slotIds: appointment.slotIds,
          paymentInfo: appointment.paymentId ? {
            paymentId: appointment.paymentId.toString(),
            status: 'cancelled',
            amount: appointment.totalAmount
          } : null,
          invoiceInfo: appointment.invoiceId ? {
            invoiceId: appointment.invoiceId.toString(),
            status: 'cancelled'
          } : null,
          cancelledBy: staffId.toString(),
          cancelledByName: currentUser?.name || currentUser?.fullName || 'Staff',
          cancelledByRole: staffRole,
          cancelledAt: cancelledAt,
          reason: reason || 'Hủy bởi ' + staffRole
        }
      });
      console.log(`📝 [Admin Cancel] Đã publish log hủy đến schedule-service`);
    } catch (logError) {
      console.warn('⚠️ Không thể ghi log hủy vào DayClosure:', logError.message);
    }

    // 🔥 1. Gửi email đến bệnh nhân nếu có email
    if (patientEmail) {
      try {
        await publishToQueue('email_notifications', {
          type: 'appointment_cancelled_by_admin',
          notifications: [{
            email: patientEmail,
            name: patientName || 'Bệnh nhân',
            role: 'patient',
            appointmentCode: appointmentCode,
            appointmentInfo: {
              date: appointment.appointmentDate,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              serviceName: appointment.serviceName,
              serviceAddOnName: appointment.serviceAddOnName,
              dentistName: appointment.dentistName,
              roomName: appointment.roomName,
              subroomName: appointment.subroomName
            },
            cancelledBy: staffRole,
            reason: reason || 'Không rõ lý do',
            cancelledAt: cancelledAt
          }],
          metadata: {
            appointmentId: appointmentIdStr,
            appointmentCode: appointmentCode,
            action: 'cancelled_by_admin'
          }
        });
        console.log(`📧 [Admin Cancel] Đã đưa email vào hàng đợi cho bệnh nhân: ${patientEmail}`);
      } catch (emailError) {
        console.warn('⚠️ Không thể đưa email bệnh nhân vào hàng đợi:', emailError.message);
      }
    } else {
      console.warn(`⚠️ [Admin Cancel] Không tìm thấy email bệnh nhân cho lịch hẹn ${appointmentCode}`);
    }

    // 🔥 2. Hủy Invoice và InvoiceDetails nếu có
    if (appointment.invoiceId) {
      try {
        await publishToQueue('invoice_queue', {
          event: 'appointment_cancelled',
          data: {
            appointmentId: appointmentIdStr,
            invoiceId: appointment.invoiceId.toString(),
            cancelledBy: staffId,
            cancelledByRole: staffRole,
            cancelReason: reason || 'Hủy bởi ' + staffRole,
            cancelledAt: cancelledAt
          }
        });
        console.log(`📡 [Admin Cancel] Đã publish event hủy hóa đơn cho invoice ${appointment.invoiceId}`);
      } catch (error) {
        console.warn('⚠️ Không thể publish event hủy hóa đơn:', error.message);
      }
    }
    
    // 🔥 3. Hủy Payment nếu có
    if (appointment.paymentId) {
      try {
        await publishToQueue('payment_queue', {
          event: 'appointment_cancelled',
          data: {
            appointmentId: appointmentIdStr,
            paymentId: appointment.paymentId.toString(),
            cancelledBy: staffId,
            cancelledByRole: staffRole,
            cancelReason: reason || 'Hủy bởi ' + staffRole,
            cancelledAt: cancelledAt
          }
        });
        console.log(`📡 [Admin Cancel] Đã publish event hủy thanh toán cho payment ${appointment.paymentId}`);
      } catch (error) {
        console.warn('⚠️ Không thể publish event hủy thanh toán:', error.message);
      }
    }
    
    // 🔥 4. Xóa Records liên kết với lịch hẹn này
    try {
      await publishToQueue('record_queue', {
        event: 'delete_records_by_appointment',
        data: {
          appointmentId: appointmentIdStr,
          deletedBy: staffId,
          deletedByRole: staffRole,
          reason: 'Lịch hẹn bị hủy bởi ' + staffRole,
          deletedAt: cancelledAt
        }
      });
      console.log(`📡 [Admin Cancel] Đã publish event xóa hồ sơ cho lịch hẹn ${appointmentIdStr}`);
    } catch (error) {
      console.warn('⚠️ Không thể publish event xóa hồ sơ:', error.message);
    }

    // Ghi chú: DayClosure logging đã xóa - chỉ dành cho hủy slot hàng loạt do phòng khám chủ động
    
    // 🔥 5. Publish event hủy lịch hẹn chung để thông báo
    try {
      await publishToQueue('appointment_queue', {
        event: 'admin_cancelled',
        data: {
          appointmentId: appointmentIdStr,
          appointmentCode: appointmentCode,
          patientName: patientName,
          patientPhone: patientPhone,
          patientEmail: patientEmail,
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          cancelledBy: staffRole,
          reason: reason || 'Hủy bởi ' + staffRole
        }
      });
      
      console.log(`📡 [Admin Cancel] Đã publish event thông báo cho ${appointmentCode} bởi ${staffRole}`);
    } catch (error) {
      console.warn('⚠️ Không thể publish event thông báo hủy bởi admin:', error.message);
    }
    
    return appointment;
  }

  /**
   * 🆕 Hủy lịch hẹn do slot bị tắt (KHÔNG xóa appointmentId trong slots)
   * Sử dụng khi tắt slot - cho phép khôi phục khi slot được bật lại
   */
  async slotCancelAppointment(appointmentId, reason = null) {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId', 'email fullName name phoneNumber');
    
    if (!appointment) {
      throw new Error('Không tìm thấy phiếu khám');
    }
    
    console.log('🔄 [slotCancelAppointment] Dữ liệu lịch hẹn:', {
      _id: appointment._id,
      appointmentCode: appointment.appointmentCode,
      status: appointment.status,
      invoiceId: appointment.invoiceId,
      paymentId: appointment.paymentId
    });
    
    // Chỉ hủy những lịch hẹn có thể hủy
    if (appointment.status === 'cancelled') {
      console.log(`ℹ️ [slotCancelAppointment] Lịch hẹn ${appointment.appointmentCode} đã bị hủy, bỏ qua`);
      return appointment;
    }
    
    if (appointment.status === 'completed') {
      console.log(`ℹ️ [slotCancelAppointment] Lịch hẹn ${appointment.appointmentCode} đã hoàn thành, không thể hủy`);
      return appointment;
    }

    // Cập nhật status sang cancelled
    const cancelledAt = new Date();
    appointment.status = 'cancelled';
    appointment.cancelledAt = cancelledAt;
    appointment.cancelledBy = null; // Hành động hệ thống
    appointment.cancellationReason = reason || 'Slot bị tắt';
    
    await appointment.save();
    
    const appointmentIdStr = appointment._id.toString();
    const appointmentCode = appointment.appointmentCode;
    
    console.log(`✅ [Slot Cancel] Lịch hẹn ${appointmentCode} đã bị hủy do slot bị tắt`);

    // 🔥 GHI CHÚ: KHÔNG giải phóng slot - giữ appointmentId để khôi phục

    // Hủy Invoice nếu có
    if (appointment.invoiceId) {
      try {
        await publishToQueue('invoice_queue', {
          event: 'appointment_cancelled',
          data: {
            appointmentId: appointmentIdStr,
            invoiceId: appointment.invoiceId.toString(),
            cancelledBy: 'system',
            cancelledByRole: 'system',
            cancelReason: reason || 'Slot bị tắt',
            cancelledAt: cancelledAt
          }
        });
        console.log(`📡 [Slot Cancel] Đã publish event hủy hóa đơn`);
      } catch (error) {
        console.warn('⚠️ Không thể publish event hủy hóa đơn:', error.message);
      }
    } else {
      console.log(`ℹ️ [Slot Cancel] Không có invoiceId cho lịch hẹn ${appointmentCode}`);
    }
    
    // Hủy Payment nếu có
    if (appointment.paymentId) {
      try {
        await publishToQueue('payment_queue', {
          event: 'appointment_cancelled',
          data: {
            appointmentId: appointmentIdStr,
            paymentId: appointment.paymentId.toString(),
            cancelledBy: 'system',
            cancelledByRole: 'system',
            cancelReason: reason || 'Slot bị tắt',
            cancelledAt: cancelledAt
          }
        });
        console.log(`📡 [Slot Cancel] Đã publish event hủy thanh toán`);
      } catch (error) {
        console.warn('⚠️ Không thể publish event hủy thanh toán:', error.message);
      }
    } else {
      console.log(`ℹ️ [Slot Cancel] Không có paymentId cho lịch hẹn ${appointmentCode}`);
    }
    
    return appointment;
  }

  /**
   * 🆕 Khôi phục lịch hẹn khi slot được bật lại
   * Thay đổi status từ 'cancelled' về 'confirmed'
   */
  async slotRestoreAppointment(appointmentId, reason = null) {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId', 'email fullName name phoneNumber');
    
    if (!appointment) {
      throw new Error('Không tìm thấy phiếu khám');
    }
    
    console.log('🔄 [slotRestoreAppointment] Dữ liệu lịch hẹn:', {
      _id: appointment._id,
      appointmentCode: appointment.appointmentCode,
      status: appointment.status,
      invoiceId: appointment.invoiceId,
      paymentId: appointment.paymentId
    });
    
    // Chỉ khôi phục lịch hẹn đã bị hủy
    if (appointment.status !== 'cancelled') {
      console.log(`ℹ️ [slotRestoreAppointment] Lịch hẹn ${appointment.appointmentCode} không bị hủy (status: ${appointment.status}), bỏ qua`);
      return appointment;
    }
    
    // Kiểm tra ngày lịch hẹn có trong tương lai không
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const appointmentDate = new Date(appointment.appointmentDate);
    appointmentDate.setHours(0, 0, 0, 0);
    
    if (appointmentDate < today) {
      console.log(`ℹ️ [slotRestoreAppointment] Lịch hẹn ${appointment.appointmentCode} đã qua, không thể khôi phục`);
      return appointment;
    }

    // Khôi phục status về confirmed
    appointment.status = 'confirmed';
    appointment.cancelledAt = null;
    appointment.cancelledBy = null;
    appointment.cancellationReason = null;
    
    await appointment.save();
    
    const appointmentIdStr = appointment._id.toString();
    const appointmentCode = appointment.appointmentCode;
    
    console.log(`✅ [Slot Restore] Lịch hẹn ${appointmentCode} đã được khôi phục về confirmed`);

    // Khôi phục Invoice nếu có
    if (appointment.invoiceId) {
      try {
        await publishToQueue('invoice_queue', {
          event: 'appointment_restored',
          data: {
            appointmentId: appointmentIdStr,
            invoiceId: appointment.invoiceId.toString(),
            restoredBy: 'system',
            restoredByRole: 'system',
            reason: reason || 'Slot được bật lại',
            restoredAt: new Date()
          }
        });
        console.log(`📡 [Slot Restore] Đã publish event khôi phục hóa đơn`);
      } catch (error) {
        console.warn('⚠️ Không thể publish event khôi phục hóa đơn:', error.message);
      }
    } else {
      console.log(`ℹ️ [Slot Restore] Không có invoiceId cho lịch hẹn ${appointmentCode}`);
    }
    
    // Khôi phục Payment nếu có
    if (appointment.paymentId) {
      try {
        await publishToQueue('payment_queue', {
          event: 'appointment_restored',
          data: {
            appointmentId: appointmentIdStr,
            paymentId: appointment.paymentId.toString(),
            restoredBy: 'system',
            restoredByRole: 'system',
            reason: reason || 'Slot được bật lại',
            restoredAt: new Date()
          }
        });
        console.log(`📡 [Slot Restore] Đã publish event khôi phục thanh toán`);
      } catch (error) {
        console.warn('⚠️ Không thể publish event khôi phục thanh toán:', error.message);
      }
    } else {
      console.log(`ℹ️ [Slot Restore] Không có paymentId cho lịch hẹn ${appointmentCode}`);
    }
    
    return appointment;
  }

  /**
   * Admin/Manager/Receptionist từ chối yêu cầu hủy
   * Thay đổi status từ 'pending-cancellation' về 'confirmed'
   */
  async rejectCancellation(appointmentId, staffId, staffRole, reason = null) {
    const appointment = await Appointment.findById(appointmentId)
      .populate('patientId', 'email fullName name phoneNumber');
    
    if (!appointment) {
      throw new Error('Không tìm thấy phiếu khám');
    }
    
    // Kiểm tra lịch hẹn có đang ở trạng thái pending-cancellation không
    if (appointment.status !== 'pending-cancellation') {
      throw new Error('Phiếu khám không ở trạng thái chờ duyệt hủy');
    }

    console.log(`🔄 [Từ chối hủy] Đang xử lý lịch hẹn ${appointment.appointmentCode}`);

    // 🔥 Lấy email bệnh nhân để thông báo
    let patientEmail = null;
    let patientName = null;
    let patientPhone = null;
    let patientIdStr = null;
    
    // Thử lấy từ patientId đã populate trước
    if (appointment.patientId) {
      // Kiểm tra patientId đã được populate (object) hay chỉ là ObjectId
      if (typeof appointment.patientId === 'object' && appointment.patientId._id) {
        patientIdStr = appointment.patientId._id.toString();
        patientEmail = appointment.patientId.email;
        patientName = appointment.patientId.fullName || appointment.patientId.name;
        patientPhone = appointment.patientId.phoneNumber;
      } else {
        // Chỉ là ObjectId, chưa populate
        patientIdStr = appointment.patientId.toString();
      }
    }
    
    // Fallback sang patientInfo
    if (!patientEmail && appointment.patientInfo?.email) {
      patientEmail = appointment.patientInfo.email;
    }
    if (!patientName && appointment.patientInfo?.name) {
      patientName = appointment.patientInfo.name;
    }
    if (!patientPhone && appointment.patientInfo?.phone) {
      patientPhone = appointment.patientInfo.phone;
    }
    
    console.log('📧 [Từ chối hủy] Đã trích xuất thông tin bệnh nhân:', {
      patientEmail,
      patientName,
      patientPhone,
      patientIdStr
    });

    // Cập nhật status về confirmed
    appointment.status = 'confirmed';
    
    // Xóa các trường yêu cầu hủy
    appointment.cancellationRequestedAt = null;
    appointment.cancellationRequestedBy = null;
    appointment.cancellationRequestReason = null;
    
    await appointment.save();
    
    const appointmentCode = appointment.appointmentCode;
    console.log(`✅ [Từ chối hủy] Lịch hẹn ${appointmentCode} đã đổi status về confirmed bởi ${staffRole}`);

    // 🔥 Gửi email đến bệnh nhân nếu có email
    if (patientEmail) {
      try {
        await publishToQueue('email_notifications', {
          type: 'cancellation_rejected',
          notifications: [{
            email: patientEmail,
            name: patientName || 'Bệnh nhân',
            role: 'patient',
            appointmentCode: appointmentCode,
            appointmentInfo: {
              date: appointment.appointmentDate,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              serviceName: appointment.serviceName,
              serviceAddOnName: appointment.serviceAddOnName,
              dentistName: appointment.dentistName,
              roomName: appointment.roomName,
              subroomName: appointment.subroomName
            },
            rejectedBy: staffRole,
            rejectionReason: reason || 'Yêu cầu hủy không được chấp nhận',
            rejectedAt: new Date()
          }],
          metadata: {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointmentCode,
            action: 'cancellation_rejected'
          }
        });
        console.log(`📧 [Từ chối hủy] Đã đưa email vào hàng đợi cho bệnh nhân: ${patientEmail}`);
      } catch (emailError) {
        console.warn('⚠️ Không thể đưa email bệnh nhân vào hàng đợi:', emailError.message);
      }
    } else {
      console.warn(`⚠️ [Từ chối hủy] Không tìm thấy email bệnh nhân cho lịch hẹn ${appointmentCode}`);
    }

    return appointment;
  }
  
  async cancel(appointmentId, userId, reason) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) throw new Error('Không tìm thấy lịch hẹn');
    
    if (!appointment.canBeCancelled()) {
      throw new Error('Không thể hủy lịch hẹn này');
    }
    
    appointment.status = 'cancelled';
    appointment.cancelledAt = new Date();
    appointment.cancelledBy = userId;
    appointment.cancellationReason = reason;
    await appointment.save();
    
    // 🔥 PUBLISH ĐẾN RECORD SERVICE: Để record-service emit socket
    try {
      if (appointment.roomId && appointment.appointmentDate) {
        const date = new Date(appointment.appointmentDate).toISOString().split('T')[0];
        
        await publishToQueue('record_queue', {
          event: 'appointment.status_changed',
          data: {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointment.appointmentCode,
            status: 'cancelled',
            roomId: appointment.roomId.toString(),
            date: date,
            patientName: appointment.patientInfo?.name,
            message: `${appointment.patientInfo?.name || 'Bệnh nhân'} đã hủy phiếu hẹn`
          }
        });
        
        console.log(`📡 [Cancel] Đã publish thay đổi trạng thái đến record-service để emit socket`);
      }
    } catch (socketError) {
      console.warn('⚠️ Không thể publish thay đổi trạng thái:', socketError.message);
    }
    
    await serviceClient.bulkUpdateSlots(appointment.slotIds, {
      status: 'available',
      appointmentId: null
    });
    
    // 🔓 Xóa Redis locks cho tất cả slot (idempotent - user cancel)
    for (const slotId of appointment.slotIds) {
      try {
        const deleted = await redisClient.del('temp_slot_lock:' + slotId);
        if (deleted > 0) {
          console.log(`🔓 [User Cancel] Đã xóa Redis lock cho slot ${slotId}`);
        } else {
          console.log(`ℹ️ [User Cancel] Không có Redis lock cho slot ${slotId} (đã xóa hoặc hết hạn)`);
        }
      } catch (redisError) {
        console.warn(`⚠️ Không thể xóa Redis lock cho slot ${slotId}:`, redisError.message);
      }
    }
    
    await publishToQueue('appointment_queue', {
      event: 'appointment_cancelled',
      data: {
        appointmentId: appointment._id,
        appointmentCode: appointment.appointmentCode,
        slotIds: appointment.slotIds,
        reason
      }
    });
    
    return appointment;
  }
  
  // Tạo lịch hẹn trực tiếp (cho nhân viên/admin - đặt offline)
  async createAppointmentDirectly(appointmentData, currentUser) {
    try {
      // Xác thực các trường bắt buộc
      if (!appointmentData.patientInfo || !appointmentData.patientInfo.name || !appointmentData.patientInfo.phone) {
        throw new Error('Thông tin bệnh nhân (tên, số điện thoại) là bắt buộc');
      }
      
      const {
        patientId, patientInfo, serviceId, serviceAddOnId,
        dentistId, slotIds, date, notes, paymentMethod, examRecordId
      } = appointmentData;
      
      // Xác thực slot khả dụng và lấy thông tin chi tiết (query một lần, tái sử dụng)
      const slots = await this.validateSlotsAvailable(slotIds);
      
      // Lấy thông tin dịch vụ
      const serviceInfo = await this.getServiceInfo(serviceId, serviceAddOnId);
      console.log('📦 [createOffline] Service Info:', JSON.stringify(serviceInfo, null, 2));
      
      // Lấy thông tin nha sĩ
      const dentistInfo = await this.getDentistInfo(dentistId);
      console.log('👨‍⚕️ Dentist Info:', dentistInfo);
      
      // Sắp xếp slot theo thời gian
      slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      const firstSlot = slots[0];
      
      // 🔧 Trích xuất roomId và subRoomId (xử lý cả trường hợp đã populate và chưa populate)
      const extractId = (field) => {
        if (!field) return null;
        return typeof field === 'object' && field._id ? field._id.toString() : field.toString();
      };
      
      const roomId = extractId(firstSlot.roomId);
      const subRoomId = extractId(firstSlot.subRoomId);
      
      const startTime = this.formatTime(slots[0].startTime);
      const endTime = this.formatTime(slots[slots.length - 1].endTime);
      
      // Tạo mã lịch hẹn
      const appointmentDate = new Date(date);
      const appointmentCode = await Appointment.generateAppointmentCode(appointmentDate);
      
      // 🏠 Lấy tên phòng/phòng con từ room-service
      const roomInfo = await this.getRoomInfo(roomId, subRoomId);
      
      // Tạo lịch hẹn trực tiếp (không cần thanh toán cho đặt offline)
      const appointment = new Appointment({
        appointmentCode,
        patientId: patientId || null, // null cho bệnh nhân walk-in
        patientInfo,
        serviceId,
        serviceName: serviceInfo.serviceName,
        serviceType: serviceInfo.serviceType,
        serviceAddOnId,
        serviceAddOnName: serviceInfo.serviceAddOnName,
        serviceDuration: serviceInfo.serviceDuration,
        servicePrice: serviceInfo.servicePrice,
        serviceAddOnPrice: serviceInfo.serviceAddOnPrice || 0, // ✅ Thêm serviceAddOnPrice
        dentistId,
        dentistName: dentistInfo.name,
        slotIds,
        appointmentDate,
        startTime,
        endTime,
        roomId: roomId,
        roomName: roomInfo.roomName,
        subroomId: subRoomId || null,
        subroomName: roomInfo.subroomName,
        paymentId: null, // Sẽ tạo sau nếu cần
        totalAmount: (serviceInfo.servicePrice || 0) + (serviceInfo.serviceAddOnPrice || 0), // ✅ Tổng = service + addon
        status: 'confirmed', // ⭐ Bắt đầu với confirmed, sau đó check-in
        bookedAt: new Date(),
        bookedBy: currentUser.userId || currentUser._id, // ⭐ Hỗ trợ cả userId và _id
        bookedByRole: currentUser.activeRole || currentUser.role || (Array.isArray(currentUser.roles) ? currentUser.roles[0] : 'staff'),
        examRecordId: examRecordId || null, // 🆕 Lưu exam record ID
        notes: notes || ''
      });
      
      // Lưu lịch hẹn (model sẽ tự động retry nếu code bị trùng)
      await appointment.save();
      console.log('✅ Đã tạo lịch hẹn walk-in:', appointment.appointmentCode);
      
      // ✅ Tự động check-in cho lịch hẹn walk-in (trigger event tạo record)
      const userId = currentUser.userId || currentUser._id;
      await this.checkIn(appointment._id, userId);
      console.log('✅ Đã tự động check-in lịch hẹn walk-in:', appointmentCode);
      
      // Cập nhật slot sang booked
      await serviceClient.bulkUpdateSlots(slotIds, {
        status: 'booked',
        appointmentId: appointment._id
      });
      
      // 🔓 Xóa Redis locks cho tất cả slot (quan trọng cho lịch hẹn offline)
      for (const slotId of slotIds) {
        try {
          const deleted = await redisClient.del('temp_slot_lock:' + slotId);
          if (deleted > 0) {
            console.log(`🔓 [Offline Appointment] Đã xóa Redis lock cho slot ${slotId}`);
          } else {
            console.log(`ℹ️ [Offline Appointment] Không có Redis lock cho slot ${slotId} (chưa từng bị khóa hoặc đã hết hạn)`);
          }
        } catch (redisError) {
          console.warn(`⚠️ Không thể xóa Redis lock cho slot ${slotId}:`, redisError.message);
          // Không throw - lịch hẹn đã tạo thành công
        }
      }
      
      // Đánh dấu dịch vụ đã sử dụng qua Queue (không blocking)
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: [{
              serviceId,
              serviceAddOnId
            }]
          }
        });
        console.log('✅ Đã publish event đánh dấu dịch vụ đã sử dụng');
      } catch (queueError) {
        console.warn('⚠️ Không thể publish event dịch vụ (RabbitMQ có thể không hoạt động):', queueError.message);
        // Không throw - cho phép tạo lịch hẹn tiếp tục
      }
      
      // 🆕 Publish event đến record-service để đánh dấu chỉ định điều trị đã sử dụng
      // Nên xảy ra SAU check-in để đảm bảo record được tạo trước
      if (patientId && serviceId) {
        try {
          const eventData = {
            event: 'appointment.service_booked',
            timestamp: new Date(),
            data: {
              appointmentId: appointment._id,
              patientId: patientId,
              serviceId: serviceId,
              serviceAddOnId: serviceAddOnId || null,
              appointmentDate: appointmentDate,
              reason: 'offline_appointment_created'
            }
          };
          
          console.log('📤 Đang publish event appointment.service_booked:', JSON.stringify(eventData, null, 2));
          
          await publishToQueue('record_queue', eventData);
          
          console.log('✅ Đã publish event appointment.service_booked đến record-service');
        } catch (eventError) {
          console.error('⚠️ Không thể publish đến record-service:', eventError.message);
          console.error('Event data:', { patientId, serviceId, serviceAddOnId });
          // Không throw - lịch hẹn đã tạo
        }
      } else {
        console.warn('⚠️ Bỏ qua event appointment.service_booked - thiếu patientId hoặc serviceId:', { patientId, serviceId });
      }
      
      // Publish event để tạo hóa đơn (không blocking)
      try {
        await publishToQueue('invoice_queue', {
          event: 'appointment_created',
          data: {
            appointmentId: appointment._id,
            appointmentCode: appointment.appointmentCode,
            patientId: appointment.patientId,
            patientInfo: appointment.patientInfo,
            serviceId: appointment.serviceId,
            serviceName: appointment.serviceName,
            serviceAddOnId: appointment.serviceAddOnId,
            serviceAddOnName: appointment.serviceAddOnName,
            servicePrice: appointment.servicePrice,
            dentistId: appointment.dentistId,
            dentistName: appointment.dentistName,
            roomId: appointment.roomId,
            roomName: appointment.roomName,
            subroomId: appointment.subroomId,
            subroomName: appointment.subroomName,
            appointmentDate: appointment.appointmentDate,
            startTime: appointment.startTime,
            endTime: appointment.endTime,
            paymentId: null,
            totalAmount: appointment.totalAmount,
            paymentMethod: paymentMethod || 'cash'
          }
        });
        console.log('✅ Đã publish event hóa đơn');
      } catch (queueError) {
        console.warn('⚠️ Không thể publish event hóa đơn (RabbitMQ có thể không hoạt động):', queueError.message);
        // Không throw - cho phép tạo lịch hẹn tiếp tục
      }
      
      console.log('✅ Đã tạo và check-in lịch hẹn offline: ' + appointmentCode);
      
      // Lấy lại lịch hẹn để có status và thông tin check-in cập nhật
      const updatedAppointment = await Appointment.findById(appointment._id);
      return updatedAppointment;
      
    } catch (error) {
      console.error('Lỗi tạo lịch hẹn offline:', error);
      throw new Error('Không thể tạo lịch hẹn offline: ' + error.message);
    }
  }
  
  /**
   * Tạo lịch hẹn từ reservation sau khi thanh toán hoàn tất
   * @param {String} reservationId 
   * @param {Object} paymentInfo 
   * @returns {Object} Lịch hẹn đã tạo
   */
  async createFromReservation(reservationId, paymentInfo) {
    try {
      console.log('Đang tạo lịch hẹn từ reservation:', reservationId);
      
      // Lấy reservation từ Redis
      const reservationData = await redisClient.get('temp_reservation:' + reservationId);
      if (!reservationData) {
        throw new Error('Không tìm thấy reservation hoặc đã hết hạn');
      }
      
      const reservation = JSON.parse(reservationData);
      
      // Tạo mã lịch hẹn (với tự động retry/tăng số nếu trùng)
      const appointmentDate = new Date(reservation.appointmentDate);
      const appointmentCode = await Appointment.generateAppointmentCode(appointmentDate);
      
      // Tạo lịch hẹn
      const appointment = new Appointment({
        appointmentCode,
        patientId: reservation.patientId,
        patientInfo: reservation.patientInfo,
        serviceId: reservation.serviceId,
        serviceName: reservation.serviceName,
        serviceType: reservation.serviceType,
        serviceAddOnId: reservation.serviceAddOnId,
        serviceAddOnName: reservation.serviceAddOnName,
        serviceDuration: reservation.serviceDuration,
        servicePrice: reservation.servicePrice,
        dentistId: reservation.dentistId,
        dentistName: reservation.dentistName,
        slotIds: reservation.slotIds,
        appointmentDate: reservation.appointmentDate,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        paymentId: paymentInfo.paymentId,
        totalAmount: reservation.servicePrice,
        status: 'confirmed',
        bookedAt: new Date(),
        bookedBy: reservation.bookedBy,
  bookedByRole: reservation.bookedByRole,
        notes: reservation.notes,
        paymentMethod: paymentInfo.paymentMethod,
        paymentStatus: paymentInfo.paymentStatus,
        paidAmount: paymentInfo.paidAmount,
        transactionId: paymentInfo.transactionId
      });
      
      // Lưu lịch hẹn (model sẽ tự động retry nếu code bị trùng)
      try {
        await appointment.save();
        console.log('✅ Đã tạo lịch hẹn online:', appointment.appointmentCode);
      } catch (saveError) {
        // Xử lý lỗi duplicate paymentId (idempotent - cùng một payment xử lý 2 lần)
        if (saveError.code === 11000 && saveError.keyPattern?.paymentId) {
          console.log('⚠️ Phát hiện paymentId trùng - payment đã được xử lý');
          const existingAppointment = await Appointment.findOne({
            paymentId: paymentInfo.paymentId
          });
          if (existingAppointment) {
            console.log('✅ Trả về lịch hẹn đã tồn tại:', existingAppointment.appointmentCode);
            return existingAppointment;
          }
        }
        throw saveError;
      }
      
      // Cập nhật slot: đặt status='booked' và appointmentId
      // Sử dụng HTTP thay vì RPC để debug tốt hơn
      try {
        const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
        await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
          slotIds: reservation.slotIds,
          updates: {
            status: 'booked', // Thay đổi từ 'locked' sang 'booked'
            appointmentId: appointment._id
          }
        });
        console.log('✅ Đã cập nhật slot sang booked (status=booked) qua HTTP');
      } catch (error) {
        console.error('❌ Không thể cập nhật slot qua HTTP:', error.message);
        // Đây là lỗi quan trọng - nếu cập nhật slot thất bại, sẽ có vấn đề
        // Nhưng lịch hẹn đã được tạo, nên ghi log lỗi để sửa thủ công
        console.error('⚠️ QUAN TRỌNG: Lịch hẹn đã tạo nhưng slot chưa được cập nhật sang booked!');
      }
      
      // Đánh dấu dịch vụ đã sử dụng qua Queue (không blocking)
      try {
        await publishToQueue('service_queue', {
          event: 'service.mark_as_used',
          data: {
            services: [{
              serviceId: reservation.serviceId,
              serviceAddOnId: reservation.serviceAddOnId
            }]
          }
        });
        console.log('✅ Đã publish event đánh dấu dịch vụ đã sử dụng (payment flow)');
      } catch (queueError) {
        console.warn('⚠️ Không thể publish event dịch vụ:', queueError.message);
        // Không throw - cho phép tạo lịch hẹn tiếp tục
      }
      
      // 🔓 Dọn dẹp reservation và slot locks từ Redis (idempotent - an toàn khi gọi nhiều lần)
      try {
        await redisClient.del('temp_reservation:' + reservationId);
        console.log('✅ Đã xóa reservation từ Redis:', reservationId);
      } catch (error) {
        console.warn('⚠️ Không thể xóa reservation từ Redis:', error.message);
      }
      
      for (const slotId of reservation.slotIds) {
        try {
          const deleted = await redisClient.del('temp_slot_lock:' + slotId);
          if (deleted > 0) {
            console.log(`🔓 [Thanh toán thành công] Đã xóa Redis lock cho slot ${slotId}`);
          } else {
            console.log(`ℹ️ [Thanh toán thành công] Không có Redis lock cho slot ${slotId} (đã xóa hoặc hết hạn)`);
          }
        } catch (redisError) {
          console.warn(`⚠️ Không thể xóa Redis lock cho slot ${slotId}:`, redisError.message);
        }
      }
      
      console.log('✅ Đã tạo lịch hẹn từ reservation:', appointmentCode);
      return appointment;
      
    } catch (error) {
      console.error('❌ Lỗi tạo lịch hẹn từ reservation:', error);
      throw error;
    }
  }
  
  /**
   * Hủy reservation và mở khóa slot
   * Được gọi khi: thanh toán thất bại, hết thời gian thanh toán, user hủy
   */
  async cancelReservation(reservationId, reason) {
    try {
      console.log('🚫 Đang hủy reservation:', reservationId, 'Lý do:', reason);
      
      // Lấy reservation từ Redis
      const reservationData = await redisClient.get('temp_reservation:' + reservationId);
      if (!reservationData) {
        console.log('⚠️ Không tìm thấy reservation hoặc đã hết hạn:', reservationId);
        
        // 🔥 Dù không tìm thấy reservation, vẫn thử dọn dẹp slot locks orphan
        // Xử lý trường hợp reservation hết hạn nhưng locks vẫn còn
        try {
          // Không có slotIds, nhưng Redis lock sẽ tự hết hạn qua TTL
          console.log('ℹ️ Không có dữ liệu reservation, slot locks sẽ tự hết hạn qua Redis TTL');
        } catch (error) {
          console.warn('⚠️ Lỗi khi dọn dẹp orphan lock:', error);
        }
        
        return;
      }
      
      const reservation = JSON.parse(reservationData);
      
      // 1️⃣ Mở khóa slot trong DB (đặt status='available')
      try {
        const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
        await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
          slotIds: reservation.slotIds,
          updates: {
            status: 'available',
            lockedAt: null,
            lockedBy: null
          }
        });
        console.log('✅ Đã mở khóa slot trong DB (status=available)');
      } catch (error) {
        console.error('❌ Không thể mở khóa slot trong DB:', error.message);
      }
      
      // 2️⃣ Mở khóa slot trong Redis (dù không tìm thấy cũng không lỗi)
      for (const slotId of reservation.slotIds) {
        try {
          const deleted = await redisClient.del('temp_slot_lock:' + slotId);
          if (deleted > 0) {
            console.log(`🔓 Đã mở khóa slot trong Redis: ${slotId}`);
          } else {
            console.log(`ℹ️ Không tìm thấy Redis lock cho slot ${slotId} (đã hết hạn)`);
          }
        } catch (error) {
          console.warn(`⚠️ Không thể mở khóa slot ${slotId}:`, error.message);
        }
      }
      
      // 3️⃣ Xóa reservation từ Redis (idempotent)
      try {
        await redisClient.del('temp_reservation:' + reservationId);
        console.log('✅ Đã xóa reservation từ Redis:', reservationId);
      } catch (error) {
        console.warn('⚠️ Không thể xóa reservation từ Redis:', error.message);
      }
      
      console.log('✅ Đã hủy reservation:', reservationId);
      
    } catch (error) {
      console.error('❌ Lỗi hủy reservation:', error);
      throw error;
    }
  }

  /**
   * Lấy tất cả lịch hẹn với bộ lọc (Admin/Manager)
   * @param {Object} filters - { status, dentistId, startDate, endDate, page, limit }
   * @returns {Object} - { appointments, total, page, limit }
   */
  async getAllAppointments(filters = {}) {
    try {
      const {
        status,
        dentistId,
        nurseId,
        startDate,
        endDate,
        page = 1,
        limit = 50
      } = filters;

      // Build query
      const query = {};

      if (status) {
        query.status = status;
      }

      if (dentistId) {
        query.dentistId = dentistId;
      }

      if (nurseId) {
        query.nurseId = nurseId;
      }

      if (startDate || endDate) {
        query.appointmentDate = {};
        if (startDate) {
          query.appointmentDate.$gte = new Date(startDate);
        }
        if (endDate) {
          query.appointmentDate.$lte = new Date(endDate);
        }
      }

      // Thực thi query với phân trang
      const skip = (page - 1) * limit;
      const appointments = await Appointment.find(query)
        .sort({ appointmentDate: -1, startTime: 1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Appointment.countDocuments(query);

      console.log(`✅ Đã lấy ${appointments.length} lịch hẹn (tổng: ${total})`);

      return {
        appointments,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('❌ Lỗi lấy tất cả lịch hẹn:', error);
      throw error;
    }
  }

  /**
   * Lấy lịch hẹn theo nhân viên (nha sĩ hoặc y tá) cho ngày cụ thể
   * @param {String} staffId - ID của nha sĩ hoặc y tá
   * @param {String} date - Ngày định dạng yyyy-MM-dd
   * @returns {Array} - Mảng lịch hẹn với đầy đủ chi tiết
   */
  async getByStaff(staffId, date) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Query lịch hẹn mà nhân viên là nha sĩ HOẶC y tá
      const query = {
        appointmentDate: { $gte: startOfDay, $lte: endOfDay },
        $or: [
          { dentistId: staffId },
          { nurseId: staffId }
        ],
        status: { $nin: ['cancelled'] }
      };

      const appointments = await Appointment.find(query)
        .sort({ startTime: 1 })
        .lean();

      console.log(`✅ Đã lấy ${appointments.length} lịch hẹn cho nhân viên ${staffId} ngày ${date}`);

      // Trả về chi tiết đầy đủ lịch hẹn bao gồm:
      // - Thông tin bệnh nhân (tên, SĐT, năm sinh)
      // - Thông tin dịch vụ (serviceName, serviceAddOnName, serviceDuration)
      // - Thời gian slot (startTime, endTime)
      // - Thông tin phòng (roomId, roomName)
      // - Status
      // - Record ID nếu có
      return appointments.map(apt => ({
        appointmentId: apt._id,
        appointmentCode: apt.appointmentCode,
        patientInfo: {
          name: apt.patientInfo.name,
          phone: apt.patientInfo.phone,
          email: apt.patientInfo.email || null,
          birthYear: apt.patientInfo.birthYear
        },
        service: {
          serviceName: apt.serviceName,
          serviceAddOnName: apt.serviceAddOnName || null,
          serviceDuration: apt.serviceDuration
        },
        slotTime: {
          date: apt.appointmentDate,
          startTime: apt.startTime,
          endTime: apt.endTime
        },
        room: {
          roomId: apt.roomId,
          roomName: apt.roomName || apt.subroomName || `Phòng ${apt.roomId?.toString().slice(-4)}`
        },
        dentist: {
          dentistId: apt.dentistId,
          dentistName: apt.dentistName
        },
        nurse: apt.nurseId ? {
          nurseId: apt.nurseId,
          nurseName: apt.nurseName
        } : null,
        status: apt.status,
        recordId: apt.examRecordId || null,
        checkedInAt: apt.checkedInAt || null,
        completedAt: apt.completedAt || null,
        notes: apt.notes || null
      }));
    } catch (error) {
      console.error('❌ Lỗi lấy lịch hẹn theo nhân viên:', error);
      throw error;
    }
  }

  // 🆕 LẤY LỊCH HẸN THEO IDS (cho schedule-service lấy thông tin bệnh nhân gửi email, và record-service lấy thời gian)
  async getAppointmentsByIds(appointmentIds) {
    try {
      if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
        return [];
      }

      const appointments = await Appointment.find({
        _id: { $in: appointmentIds }
      }).select('_id patientId patientInfo appointmentCode status paymentId invoiceId cancelledAt startTime endTime bookingChannel deposit paymentStatus');

      return appointments.map(apt => ({
        _id: apt._id,
        appointmentCode: apt.appointmentCode,
        patientId: apt.patientId,
        patientInfo: apt.patientInfo,
        status: apt.status,
        paymentId: apt.paymentId,
        invoiceId: apt.invoiceId,
        cancelledAt: apt.cancelledAt,
        startTime: apt.startTime,
        endTime: apt.endTime,
        bookingChannel: apt.bookingChannel, // online hoặc walk-in
        deposit: apt.deposit || 0, // Tiền cọc
        paymentStatus: apt.paymentStatus // pending, paid, v.v.
      }));
    } catch (error) {
      console.error('❌ Lỗi lấy lịch hẹn theo IDs:', error);
      throw error;
    }
  }

  /**
   * ✅ Lấy thống kê kênh đặt lịch (Online vs Offline)
   */
  async getBookingChannelStats(startDate, endDate, groupBy = 'day') {
    try {
      return await appointmentRepo.getBookingChannelStats(startDate, endDate, groupBy);
    } catch (error) {
      console.error('❌ Lỗi lấy thống kê kênh đặt lịch:', error);
      throw error;
    }
  }
}

module.exports = new AppointmentService();

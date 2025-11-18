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
    const date = new Date(dateTime);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return hours + ':' + minutes;
  }
  
  /**
   * Check if slot is temporarily locked in Redis (during 15-min reservation window)
   * This is NOT checking DB slot.isBooked - that's done in validateSlotsAvailable
   * @param {String} slotId 
   * @returns {Boolean} true if locked in Redis
   */
  async isSlotLocked(slotId) {
    try {
      const lock = await redisClient.get('temp_slot_lock:' + slotId);
      if (lock) {
        // Check if it's our own lock (allow same user to retry)
        const lockData = JSON.parse(lock);
        console.log(`⏳ Slot ${slotId} is locked by reservation ${lockData.reservationId}`);
      }
      return lock !== null;
    } catch (error) {
      console.warn('⚠️ Redis check failed, assuming not locked:', error);
      return false; // Fail open - allow reservation if Redis is down
    }
  }
  
  async reserveAppointment(reservationData, currentUser) {
    try {
      const {
        patientId, patientInfo, serviceId, serviceAddOnId,
        dentistId, slotIds, date, notes
      } = reservationData;
      
      // 1️⃣ Get schedule config for deposit amount
      const scheduleConfig = await serviceClient.getScheduleConfig();
      const depositAmount = scheduleConfig.depositAmount || 100000; // Default 50k VND
      
      // Validate slots and get slot details (query once, reuse result)
      const slots = await this.validateSlotsAvailable(slotIds);
      const serviceInfo = await this.getServiceInfo(serviceId, serviceAddOnId);
      const dentistInfo = await this.getDentistInfo(dentistId);
      
      const reservationId = 'RSV' + Date.now();
      
      // Sort slots by time
      slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      
      const firstSlot = slots[0]; // Use first slot from sorted array
      
      // 🔧 Extract roomId and subRoomId (handle both populated and non-populated cases)
      // When populated: roomId/subRoomId are objects { _id, name }
      // When not populated: roomId/subRoomId are strings (ObjectId)
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
      
      // 💰 Calculate total deposit: depositAmount × number of slots
      const totalDepositAmount = depositAmount * slotIds.length;
      
      // 🏠 Fetch room/subroom names from room-service
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
        bookedBy: currentUser._id, bookedByRole: currentUser.role,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      };
      
      console.log('🔍 [reserveAppointment] reservation object:', JSON.stringify({
        reservationId: reservation.reservationId,
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        subroomId: reservation.subroomId,
        subroomName: reservation.subroomName
      }, null, 2));
      
      // 2️⃣ Lock slots in DB (set status='locked')
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
        console.log('✅ Locked slots in DB (status=locked)');
      } catch (error) {
        console.error('❌ Failed to lock slots in DB:', error.message);
        // Continue anyway - Redis lock is primary
      }
      
      // 3️⃣ Store reservation + locks in Redis (15 min TTL)
      const ttl = 15 * 60;
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
      
      // 4️⃣ Create temporary payment with deposit amount (replaced RPC)
      const paymentResult = await serviceClient.createTemporaryPayment(
        reservationId, // appointmentHoldKey
        totalDepositAmount // 💰 Use deposit amount: depositAmount × slotCount
      );
      
      return {
        reservationId,
        orderId: reservationId, // For payment
        paymentUrl: paymentResult.paymentUrl,
        amount: totalDepositAmount, // 💰 Return deposit amount
        servicePrice: totalDepositAmount, // For display
        depositPerSlot: depositAmount, // 🆕 Show deposit per slot
        slotCount: slotIds.length, // 🆕 Show number of slots
        expiresAt: reservation.expiresAt,
        // ✅ Add full reservation details for display
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
      throw new Error('Cannot reserve appointment: ' + error.message);
    }
  }
  
  /**
   * Validate slots are available and return slot details
   * @param {Array<String>} slotIds 
   * @returns {Array<Object>} slots - Array of slot objects
   */
  async validateSlotsAvailable(slotIds) {
    // 1️⃣ Query all slots once (parallel query for performance)
    const slots = await Promise.all(slotIds.map(id => this.getSlotInfo(id)));
    
    // 2️⃣ Validate each slot
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const slotId = slotIds[i];
      
      // Check if already booked or locked in database
      if (slot.status === 'booked') {
        throw new Error('Slot ' + slotId + ' is already booked');
      }
      
      if (slot.status === 'locked') {
        throw new Error('Slot ' + slotId + ' is currently locked (another user is booking)');
      }
      
      // 3️⃣ Check temporary lock in Redis (backup check)
      const isLocked = await this.isSlotLocked(slotId);
      if (isLocked) {
        throw new Error('Slot ' + slotId + ' is currently locked by another reservation');
      }
    }
    
    // Return validated slots for reuse
    return slots;
  }
  
  async getServiceInfo(serviceId, serviceAddOnId) {
    try {
      const cached = await redisClient.get('services_cache');
      if (cached) {
        const services = JSON.parse(cached);
        const service = services.find(s => s._id.toString() === serviceId.toString());
        if (service) {
          console.log('🔍 Found service in cache:', JSON.stringify(service, null, 2));
          
          // ⭐ If serviceAddOnId provided, find the addOn
          if (serviceAddOnId) {
            const addOn = service.serviceAddOns.find(a => a._id.toString() === serviceAddOnId.toString());
            if (addOn) {
              return {
                serviceName: service.name,
                serviceType: service.type,
                serviceDuration: service.duration || service.durationMinutes || 30, // ⭐ Support both field names
                serviceAddOnName: addOn.name,
                servicePrice: addOn.price
              };
            }
          } else {
            // ⭐ No addOn - return service info only
            return {
              serviceName: service.name,
              serviceType: service.type,
              serviceDuration: service.duration || service.durationMinutes || 30,
              serviceAddOnName: null,
              servicePrice: service.price || 0
            };
          }
        }
      }
      
      // ⭐ Fallback to RPC if cache miss
      const result = await rpcClient.call('service-service', 'getServiceAddOn', {
        serviceId, serviceAddOnId
      });
      return result;
    } catch (error) {
      throw new Error('Cannot get service info: ' + error.message);
    }
  }
  
  async getDentistInfo(dentistId) {
    try {
      let cached = await redisClient.get('users_cache');
      
      // 🔄 AUTO-REBUILD: If cache miss, try to rebuild via RPC
      if (!cached) {
        console.warn('⚠️ users_cache not found - attempting rebuild...');
        try {
          const { sendRpcRequest } = require('../utils/rabbitmq.client');
          const rebuildResult = await sendRpcRequest('auth_queue', {
            action: 'rebuildUserCache'
          }, 5000);
          
          if (rebuildResult && rebuildResult.success) {
            cached = await redisClient.get('users_cache');
          }
        } catch (rebuildError) {
          console.error('❌ Failed to rebuild users_cache:', rebuildError.message);
        }
        
        if (!cached) {
          throw new Error('users_cache not found after rebuild attempt');
        }
      }
      
      const users = JSON.parse(cached);
      const dentist = users.find(u => u._id.toString() === dentistId.toString());
      
      if (!dentist) throw new Error('Dentist not found');
      
      // ⭐ Return normalized object with 'name' field
      return {
        _id: dentist._id,
        name: dentist.fullName || dentist.name, // Support both fullName and name
        role: dentist.role,
        specialization: dentist.specialization
      };
    } catch (error) {
      throw new Error('Cannot get dentist info: ' + error.message);
    }
  }

  /**
   * Get room and subroom names from Redis cache (populated by room-service)
   * @param {String} roomId - Room ID
   * @param {String|null} subroomId - Subroom ID (optional)
   * @returns {Object} { roomName, subroomName }
   */
  async getRoomInfo(roomId, subroomId = null) {
    try {
      let roomName = 'Phòng khám';
      let subroomName = null;

      // 🔥 Read from Redis cache (set by room-service)
      const roomsCacheStr = await redisClient.get('rooms_cache');
      
      if (!roomsCacheStr) {
        console.warn('⚠️ rooms_cache not found in Redis');
        return { roomName, subroomName };
      }

      const roomsCache = JSON.parse(roomsCacheStr);
      
      // Find room by ID
      if (roomId) {
        const room = roomsCache.find(r => r._id.toString() === roomId.toString());
        if (room) {
          roomName = room.name || roomName;
          
          // Find subroom if exists
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
      console.warn('⚠️ Could not fetch room info from cache:', error.message);
      // Return fallback values if Redis is down
      return { roomName: 'Phòng khám', subroomName: null };
    }
  }
  
  /**
   * Get slot info from schedule-service DB (source of truth)
   * Checks actual slot.status in database, not Redis
   * @param {String} slotId 
   * @returns {Object} slot with status, appointmentId, dentist, etc.
   */
  async getSlotInfo(slotId) {
    try {
      // Use HTTP call to schedule-service to get real-time DB status
      const slot = await serviceClient.getSlot(slotId);
      if (!slot) {
        throw new Error('Slot not found');
      }
      
      console.log(`📅 Slot ${slotId} DB status: ${slot.status}, appointmentId: ${slot.appointmentId || 'null'}`);
      return slot;
    } catch (error) {
      console.error('[AppointmentService] getSlotInfo error:', error.message);
      throw new Error('Cannot get slot info: ' + error.message);
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
        roomId: reservation.roomId,
        roomName: reservation.roomName,
        subroomId: reservation.subroomId,
        subroomName: reservation.subroomName
      }, null, 2));
      
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
      
      // Mark service as used via Queue (non-blocking)
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
        console.log('✅ Published service mark_as_used event (from reservation)');
      } catch (queueError) {
        console.warn('⚠️ Could not publish service event:', queueError.message);
        // Don't throw - allow appointment creation to continue
      }
      
      await redisClient.del('temp_reservation:' + reservationId);
      for (const slotId of reservation.slotIds) {
        await redisClient.del('temp_slot_lock:' + slotId);
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
      
      console.log('Appointment created: ' + appointmentCode);
      return appointment;
      
    } catch (error) {
      console.error('Error creating appointment from payment:', error);
      throw error;
    }
  }
  
  // cancelReservation() removed - reservations auto-expire after 15 minutes (Redis TTL)
  // If patient doesn't pay, Redis will auto-delete temp_reservation and temp_slot_lock keys
  
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
    
    // If already checked-in/in-progress/completed, return success (idempotent)
    if (['checked-in', 'in-progress', 'completed'].includes(appointment.status)) {
      console.log('⚠️ [CheckIn] Already checked-in/in-progress/completed, skipping...');
      return appointment;
    }
    
    if (!appointment.canCheckIn()) {
      throw new Error(`Cannot check-in this appointment. Current status: ${appointment.status}`);
    }
    
  // ✅ Check-in: chuyển trạng thái sang 'checked-in'
  appointment.status = 'checked-in';
  appointment.checkedInAt = new Date();
  appointment.checkedInBy = userId;
    await appointment.save();
    
    // 🔥 DIRECT SOCKET EMIT: Notify Queue Dashboard immediately
    // Queue Dashboard connects to BOTH appointment-service (3006) AND record-service (3010)
    try {
      const { emitAppointmentStatusChange, emitQueueUpdate } = require('../utils/socket');
      
      if (appointment.roomId && appointment.appointmentDate) {
        const date = new Date(appointment.appointmentDate).toISOString().split('T')[0];
        
        // Populate for socket emit
        const appointmentWithDate = {
          ...appointment.toObject(),
          date: date
        };
        
        // Emit directly to appointment-service socket (port 3006)
        emitAppointmentStatusChange(appointmentWithDate);
        emitQueueUpdate(appointment.roomId, date, `${appointment.patientInfo?.name || 'Bệnh nhân'} đã check-in`);
        
        console.log(`📡 [CheckIn] Emitted socket events directly from appointment-service`);
      }
    } catch (socketError) {
      console.warn('⚠️ Failed to emit socket:', socketError.message);
    }
    
    const bookingChannel = resolveBookingChannel(appointment.bookedByRole);

    // 🔥 Publish event to record-service to auto-create record
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
          totalAmount: appointment.totalAmount || appointment.servicePrice || 0, // ✅ Tổng tiền
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
      console.log(`✅ Published appointment_checked-in event for appointment ${appointment.appointmentCode}`);
    } catch (publishError) {
      console.error('❌ Failed to publish appointment_checked-in event:', publishError);
      // Don't throw error - appointment check-in still successful
    }
    
    return appointment;
  }
  
  async complete(appointmentId, userId, completionData) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) throw new Error('Appointment not found');
    
    if (!appointment.canComplete()) {
      throw new Error('Cannot complete this appointment');
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
    
    // 🔥 PUBLISH TO RECORD SERVICE: Let record-service emit socket
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
        
        console.log(`📡 [Complete] Published status change to record-service for socket emit`);
      }
    } catch (socketError) {
      console.warn('⚠️ Failed to publish status change:', socketError.message);
    }
    
    // 🔥 Publish appointment.completed event (RabbitMQ for other services)
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
      console.log(`✅ Published appointment.completed event for ${appointment.appointmentCode}`);
    } catch (publishError) {
      console.error('❌ Failed to publish appointment.completed event:', publishError);
    }
    
    return appointment;
  }
  
  /**
   * Request cancellation for online appointments
   * Patient can request if appointment is >= 1 day away
   */
  async requestCancellation(appointmentId, patientId, reason) {
    const appointment = await Appointment.findById(appointmentId);
    
    if (!appointment) {
      throw new Error('Không tìm thấy phiếu khám');
    }
    
    // Check if patient owns this appointment
    if (appointment.patientId.toString() !== patientId.toString()) {
      throw new Error('Bạn không có quyền yêu cầu hủy phiếu khám này');
    }
    
    // Check if can request cancellation
    const canRequest = appointment.canRequestCancellation();
    if (!canRequest.canRequest) {
      throw new Error(canRequest.reason);
    }
    
    // Update status to pending-cancellation and save reason to notes
    appointment.status = 'pending-cancellation';
    appointment.cancellationRequestedAt = new Date();
    appointment.cancellationRequestedBy = patientId;
    appointment.cancellationRequestReason = reason || 'Không có lý do';
    appointment.notes = reason || 'Không có lý do'; // ✅ Save reason to notes field
    await appointment.save();
    
    // 🔥 Publish event for notification
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
      
      console.log(`📡 [Request Cancellation] Published event for ${appointment.appointmentCode}`);
    } catch (error) {
      console.warn('⚠️ Failed to publish cancellation request event:', error.message);
    }
    
    return appointment;
  }

  /**
   * Admin/Manager/Receptionist cancel appointment
   * No time restrictions - can cancel anytime
   */
  async adminCancelAppointment(appointmentId, staffId, staffRole, reason) {
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
    
    // Check if appointment can be cancelled
    if (appointment.status === 'cancelled') {
      throw new Error('Phiếu khám đã bị hủy trước đó');
    }
    
    if (appointment.status === 'completed') {
      throw new Error('Không thể hủy phiếu khám đã hoàn thành');
    }

    // 🔥 Get patient email for notification
    let patientEmail = null;
    let patientName = null;
    let patientPhone = null;
    let patientIdStr = null;
    
    // Try to get from populated patientId first
    if (appointment.patientId) {
      // Check if patientId is populated (object) or just an ObjectId
      if (typeof appointment.patientId === 'object' && appointment.patientId._id) {
        patientIdStr = appointment.patientId._id.toString();
        patientEmail = appointment.patientId.email;
        patientName = appointment.patientId.fullName || appointment.patientId.name;
        patientPhone = appointment.patientId.phoneNumber;
      } else {
        // Just an ObjectId, not populated
        patientIdStr = appointment.patientId.toString();
      }
    }
    
    // Fallback to patientInfo
    if (!patientEmail && appointment.patientInfo?.email) {
      patientEmail = appointment.patientInfo.email;
    }
    if (!patientName && appointment.patientInfo?.name) {
      patientName = appointment.patientInfo.name;
    }
    if (!patientPhone && appointment.patientInfo?.phone) {
      patientPhone = appointment.patientInfo.phone;
    }
    
    console.log('📧 [adminCancelAppointment] Extracted patient info:', {
      patientEmail,
      patientName,
      patientPhone,
      patientIdStr
    });
    
    // Update status to cancelled
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
    
    console.log(`✅ [Admin Cancel] Appointment ${appointmentCode} cancelled by ${staffRole}`);

    // 🔥 1. Send email to patient if email exists
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
              roomName: appointment.roomName
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
        console.log(`📧 [Admin Cancel] Queued email to patient: ${patientEmail}`);
      } catch (emailError) {
        console.warn('⚠️ Failed to queue patient email:', emailError.message);
      }
    } else {
      console.warn(`⚠️ [Admin Cancel] No patient email found for appointment ${appointmentCode}`);
    }

    // 🔥 2. Cancel Invoice and InvoiceDetails if exists
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
        console.log(`📡 [Admin Cancel] Published invoice cancellation event for invoice ${appointment.invoiceId}`);
      } catch (error) {
        console.warn('⚠️ Failed to publish invoice cancellation event:', error.message);
      }
    }
    
    // 🔥 3. Cancel Payment if exists
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
        console.log(`📡 [Admin Cancel] Published payment cancellation event for payment ${appointment.paymentId}`);
      } catch (error) {
        console.warn('⚠️ Failed to publish payment cancellation event:', error.message);
      }
    }
    
    // 🔥 4. Delete Records linked to this appointment
    try {
      await publishToQueue('record_queue', {
        event: 'delete_records_by_appointment',
        data: {
          appointmentId: appointmentIdStr,
          deletedBy: staffId,
          deletedByRole: staffRole,
          reason: 'Appointment cancelled by ' + staffRole,
          deletedAt: cancelledAt
        }
      });
      console.log(`📡 [Admin Cancel] Published record deletion event for appointment ${appointmentIdStr}`);
    } catch (error) {
      console.warn('⚠️ Failed to publish record deletion event:', error.message);
    }

    // Note: DayClosure logging removed - only for bulk clinic-initiated slot cancellations
    
    // 🔥 5. Publish general appointment cancellation event for notifications
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
      
      console.log(`📡 [Admin Cancel] Published notification event for ${appointmentCode} by ${staffRole}`);
    } catch (error) {
      console.warn('⚠️ Failed to publish admin cancellation notification event:', error.message);
    }
    
    return appointment;
  }
  
  async cancel(appointmentId, userId, reason) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) throw new Error('Appointment not found');
    
    if (!appointment.canBeCancelled()) {
      throw new Error('Cannot cancel this appointment');
    }
    
    appointment.status = 'cancelled';
    appointment.cancelledAt = new Date();
    appointment.cancelledBy = userId;
    appointment.cancellationReason = reason;
    await appointment.save();
    
    // 🔥 PUBLISH TO RECORD SERVICE: Let record-service emit socket
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
            message: `${appointment.patientInfo?.name || 'Bệnh nhân'} đã hủy lịch hẹn`
          }
        });
        
        console.log(`📡 [Cancel] Published status change to record-service for socket emit`);
      }
    } catch (socketError) {
      console.warn('⚠️ Failed to publish status change:', socketError.message);
    }
    
    await serviceClient.bulkUpdateSlots(appointment.slotIds, {
      status: 'available',
      appointmentId: null
    });
    
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
  
  // Create appointment directly (for staff/admin - offline booking)
  async createAppointmentDirectly(appointmentData, currentUser) {
    try {
      // Validate required fields
      if (!appointmentData.patientInfo || !appointmentData.patientInfo.name || !appointmentData.patientInfo.phone) {
        throw new Error('Patient info (name, phone) is required');
      }
      
      const {
        patientId, patientInfo, serviceId, serviceAddOnId,
        dentistId, slotIds, date, notes, paymentMethod, examRecordId
      } = appointmentData;
      
      // Validate slots available and get slot details (query once, reuse result)
      const slots = await this.validateSlotsAvailable(slotIds);
      
      // Get service info
      const serviceInfo = await this.getServiceInfo(serviceId, serviceAddOnId);
      console.log('📦 Service Info:', serviceInfo);
      
      // Get dentist info
      const dentistInfo = await this.getDentistInfo(dentistId);
      console.log('👨‍⚕️ Dentist Info:', dentistInfo);
      
      // Sort slots by time
      slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      const firstSlot = slots[0];
      
      // 🔧 Extract roomId and subRoomId (handle both populated and non-populated cases)
      const extractId = (field) => {
        if (!field) return null;
        return typeof field === 'object' && field._id ? field._id.toString() : field.toString();
      };
      
      const roomId = extractId(firstSlot.roomId);
      const subRoomId = extractId(firstSlot.subRoomId);
      
      const startTime = this.formatTime(slots[0].startTime);
      const endTime = this.formatTime(slots[slots.length - 1].endTime);
      
      // Generate appointment code
      const appointmentDate = new Date(date);
      const appointmentCode = await Appointment.generateAppointmentCode(appointmentDate);
      
      // 🏠 Fetch room/subroom names from room-service
      const roomInfo = await this.getRoomInfo(roomId, subRoomId);
      
      // Create appointment directly (no payment required for offline booking)
      const appointment = new Appointment({
        appointmentCode,
        patientId: patientId || null, // null for walk-in patients
        patientInfo,
        serviceId,
        serviceName: serviceInfo.serviceName,
        serviceType: serviceInfo.serviceType,
        serviceAddOnId,
        serviceAddOnName: serviceInfo.serviceAddOnName,
        serviceDuration: serviceInfo.serviceDuration,
        servicePrice: serviceInfo.servicePrice,
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
        paymentId: null, // Will be created later if needed
        totalAmount: serviceInfo.servicePrice,
        status: 'confirmed', // ⭐ Start with confirmed, then check-in
        bookedAt: new Date(),
        bookedBy: currentUser.userId || currentUser._id, // ⭐ Support both userId and _id
        bookedByRole: currentUser.activeRole || currentUser.role || (Array.isArray(currentUser.roles) ? currentUser.roles[0] : 'staff'),
        examRecordId: examRecordId || null, // 🆕 Store exam record ID
        notes: notes || ''
      });
      
      await appointment.save();
      console.log('✅ Walk-in appointment created:', appointmentCode);
      
      // ✅ Auto check-in for walk-in appointments (triggers record creation event)
      const userId = currentUser.userId || currentUser._id;
      await this.checkIn(appointment._id, userId);
      console.log('✅ Walk-in appointment auto checked-in:', appointmentCode);
      
      // Update slots as booked
      await serviceClient.bulkUpdateSlots(slotIds, {
        status: 'booked',
        appointmentId: appointment._id
      });
      
      // Mark service as used via Queue (non-blocking)
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
        console.log('✅ Published service mark_as_used event');
      } catch (queueError) {
        console.warn('⚠️ Could not publish service event (RabbitMQ may be down):', queueError.message);
        // Don't throw - allow appointment creation to continue
      }
      
      // 🆕 Publish event to record-service to mark treatment indication as used
      // This should happen AFTER check-in to ensure record is created first
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
          
          console.log('📤 Publishing appointment.service_booked event:', JSON.stringify(eventData, null, 2));
          
          await publishToQueue('record_queue', eventData);
          
          console.log('✅ Published appointment.service_booked event to record-service');
        } catch (eventError) {
          console.error('⚠️ Failed to publish to record-service:', eventError.message);
          console.error('Event data:', { patientId, serviceId, serviceAddOnId });
          // Don't throw - appointment already created
        }
      } else {
        console.warn('⚠️ Skipping appointment.service_booked event - missing patientId or serviceId:', { patientId, serviceId });
      }
      
      // Publish event to create invoice (non-blocking)
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
        console.log('✅ Invoice event published');
      } catch (queueError) {
        console.warn('⚠️ Could not publish invoice event (RabbitMQ may be down):', queueError.message);
        // Don't throw - allow appointment creation to continue
      }
      
      console.log('✅ Offline appointment created and checked-in: ' + appointmentCode);
      
      // Refetch appointment to get updated status and check-in info
      const updatedAppointment = await Appointment.findById(appointment._id);
      return updatedAppointment;
      
    } catch (error) {
      console.error('Error creating offline appointment:', error);
      throw new Error('Cannot create offline appointment: ' + error.message);
    }
  }
  
  /**
   * Create appointment from reservation after payment completed
   * @param {String} reservationId 
   * @param {Object} paymentInfo 
   * @returns {Object} Created appointment
   */
  async createFromReservation(reservationId, paymentInfo) {
    try {
      console.log('Creating appointment from reservation:', reservationId);
      
      // Get reservation from Redis
      const reservationData = await redisClient.get('temp_reservation:' + reservationId);
      if (!reservationData) {
        throw new Error('Reservation not found or expired');
      }
      
      const reservation = JSON.parse(reservationData);
      
      // Generate appointment code
      const appointmentDate = new Date(reservation.appointmentDate);
      const appointmentCode = await Appointment.generateAppointmentCode(appointmentDate);
      
      // Create appointment
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
      
      await appointment.save();
      
      // Update slots: set status='booked' and appointmentId
      // Use HTTP instead of RPC for better debugging
      try {
        const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
        await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
          slotIds: reservation.slotIds,
          updates: {
            status: 'booked', // Change from 'locked' to 'booked'
            appointmentId: appointment._id
          }
        });
        console.log('✅ Updated slots to booked (status=booked) via HTTP');
      } catch (error) {
        console.error('❌ Failed to update slots via HTTP:', error.message);
        // This is critical - if slot update fails, we have a problem
        // But appointment is already created, so log error for manual fix
        console.error('⚠️ CRITICAL: Appointment created but slots not updated to booked!');
      }
      
      // Mark service as used via Queue (non-blocking)
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
        console.log('✅ Published service mark_as_used event (payment flow)');
      } catch (queueError) {
        console.warn('⚠️ Could not publish service event:', queueError.message);
        // Don't throw - allow appointment creation to continue
      }
      
      // Cleanup reservation và slot locks from Redis
      await redisClient.del('temp_reservation:' + reservationId);
      for (const slotId of reservation.slotIds) {
        await redisClient.del('temp_slot_lock:' + slotId);
      }
      
      console.log('✅ Appointment created from reservation:', appointmentCode);
      return appointment;
      
    } catch (error) {
      console.error('❌ Error creating appointment from reservation:', error);
      throw error;
    }
  }
  
  /**
   * Cancel reservation and unlock slots
   * @param {String} reservationId 
   * @param {String} reason 
   */
  /**
   * Cancel reservation and unlock slots
   * Called when: payment fails, payment timeout, user cancels
   */
  async cancelReservation(reservationId, reason) {
    try {
      console.log('🚫 Cancelling reservation:', reservationId, 'Reason:', reason);
      
      // Get reservation from Redis
      const reservationData = await redisClient.get('temp_reservation:' + reservationId);
      if (!reservationData) {
        console.log('⚠️ Reservation not found or already expired:', reservationId);
        return;
      }
      
      const reservation = JSON.parse(reservationData);
      
      // 1️⃣ Unlock slots in DB (set status='available')
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
        console.log('✅ Unlocked slots in DB (status=available)');
      } catch (error) {
        console.error('❌ Failed to unlock slots in DB:', error.message);
      }
      
      // 2️⃣ Unlock slots in Redis
      for (const slotId of reservation.slotIds) {
        await redisClient.del('temp_slot_lock:' + slotId);
        console.log('Unlocked slot:', slotId);
      }
      
      // 3️⃣ Delete reservation
      await redisClient.del('temp_reservation:' + reservationId);
      
      console.log('✅ Reservation cancelled:', reservationId);
      
    } catch (error) {
      console.error('❌ Error cancelling reservation:', error);
      throw error;
    }
  }

  /**
   * Get all appointments with filters (Admin/Manager)
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

      // Execute query with pagination
      const skip = (page - 1) * limit;
      const appointments = await Appointment.find(query)
        .sort({ appointmentDate: -1, startTime: 1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await Appointment.countDocuments(query);

      console.log(`✅ Retrieved ${appointments.length} appointments (total: ${total})`);

      return {
        appointments,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
    } catch (error) {
      console.error('❌ Error getting all appointments:', error);
      throw error;
    }
  }

  /**
   * Get appointments by staff (dentist or nurse) for specific date
   * @param {String} staffId - ID of dentist or nurse
   * @param {String} date - Date in yyyy-MM-dd format
   * @returns {Array} - Array of appointments with full details
   */
  async getByStaff(staffId, date) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Query appointments where staff is dentist OR nurse
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

      console.log(`✅ Retrieved ${appointments.length} appointments for staff ${staffId} on ${date}`);

      // Return full appointment details including:
      // - Patient info (name, phone, birthYear)
      // - Service info (serviceName, serviceAddOnName, serviceDuration)
      // - Slot time (startTime, endTime)
      // - Room info (roomId, roomName)
      // - Status
      // - Record ID if exists
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
      console.error('❌ Error getting appointments by staff:', error);
      throw error;
    }
  }

  // 🆕 GET APPOINTMENTS BY IDS (for schedule-service to get patient info for email, and record-service for times)
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
        bookingChannel: apt.bookingChannel, // online or walk-in
        deposit: apt.deposit || 0, // Tiền cọc
        paymentStatus: apt.paymentStatus // pending, paid, etc.
      }));
    } catch (error) {
      console.error('❌ Error getting appointments by IDs:', error);
      throw error;
    }
  }

  /**
   * ✅ Get booking channel statistics (Online vs Offline)
   */
  async getBookingChannelStats(startDate, endDate, groupBy = 'day') {
    try {
      return await appointmentRepo.getBookingChannelStats(startDate, endDate, groupBy);
    } catch (error) {
      console.error('❌ Error getting booking channel stats:', error);
      throw error;
    }
  }
}

module.exports = new AppointmentService();

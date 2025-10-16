const Appointment = require('../models/appointment.model');
const redisClient = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitmq.client');
const rpcClient = require('../utils/rpcClient');
const serviceClient = require('../utils/serviceClient');
const axios = require('axios');

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
      
      await this.validateSlotsAvailable(slotIds);
      const serviceInfo = await this.getServiceInfo(serviceId, serviceAddOnId);
      const dentistInfo = await this.getDentistInfo(dentistId);
      const firstSlot = await this.getSlotInfo(slotIds[0]);
      
      const reservationId = 'RSV' + Date.now();
      
      const slots = await Promise.all(slotIds.map(id => this.getSlotInfo(id)));
      slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      const startTime = this.formatTime(slots[0].startTime);
      const endTime = this.formatTime(slots[slots.length - 1].endTime);
      
      const reservation = {
        reservationId, patientId, patientInfo,
        serviceId, serviceName: serviceInfo.serviceName,
        serviceType: serviceInfo.serviceType,
        serviceAddOnId, serviceAddOnName: serviceInfo.serviceAddOnName,
        serviceDuration: serviceInfo.serviceDuration,
        servicePrice: serviceInfo.servicePrice,
        dentistId, dentistName: dentistInfo.name,
        slotIds, appointmentDate: date, startTime, endTime,
        roomId: firstSlot.roomId, roomName: firstSlot.roomName || '',
        notes: notes || '',
        bookedBy: currentUser._id, bookedByRole: currentUser.role,
        bookingChannel: currentUser.role === 'patient' ? 'online' : 'offline',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000)
      };
      
      // 1️⃣ Lock slots in DB (set status='locked')
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
      
      // 2️⃣ Store reservation + locks in Redis (15 min TTL)
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
      
      // 3️⃣ Create temporary payment via HTTP (replaced RPC)
      const paymentResult = await serviceClient.createTemporaryPayment(
        reservationId, // appointmentHoldKey
        serviceInfo.servicePrice // amount
      );
      
      return {
        reservationId,
        paymentUrl: paymentResult.paymentUrl,
        amount: serviceInfo.servicePrice,
        expiresAt: reservation.expiresAt
      };
      
    } catch (error) {
      console.error('Error reserving appointment:', error);
      throw new Error('Cannot reserve appointment: ' + error.message);
    }
  }
  
  async validateSlotsAvailable(slotIds) {
    for (const slotId of slotIds) {
      // 1️⃣ Check slot in DB via schedule-service (source of truth)
      const slot = await this.getSlotInfo(slotId);
      
      // Check if already booked
      if (slot.status === 'booked') {
        throw new Error('Slot ' + slotId + ' is already booked');
      }
      
      // Check if locked - but verify lock is still valid
      if (slot.status === 'locked') {
        // If slot is locked, check if the reservation still exists in Redis
        const lockedBy = slot.lockedBy; // reservationId
        if (lockedBy) {
          const reservationExists = await redisClient.exists('temp_reservation:' + lockedBy);
          if (reservationExists) {
            // Lock is still valid
            throw new Error('Slot ' + slotId + ' is currently locked (another user is booking)');
          } else {
            // Lock expired but DB not updated - unlock it now
            console.log(`⚠️ Slot ${slotId} has expired lock (${lockedBy}), unlocking...`);
            await this.unlockExpiredSlot(slotId);
          }
        } else {
          // Locked but no lockedBy - invalid state, unlock it
          console.log(`⚠️ Slot ${slotId} locked without reservationId, unlocking...`);
          await this.unlockExpiredSlot(slotId);
        }
      }
      
      // 2️⃣ Check temporary lock in Redis (for concurrent reservations)
      // This is backup check - DB should already have status='locked'
      const isLocked = await this.isSlotLocked(slotId);
      if (isLocked) {
        throw new Error('Slot ' + slotId + ' is currently locked by another reservation');
      }
    }
  }

  /**
   * Unlock an expired slot in DB (set status back to 'available')
   */
  async unlockExpiredSlot(slotId) {
    try {
      const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
        slotIds: [slotId],
        updates: {
          status: 'available',
          lockedAt: null,
          lockedBy: null
        }
      });
      console.log(`✅ Unlocked expired slot ${slotId}`);
    } catch (error) {
      console.error(`❌ Failed to unlock slot ${slotId}:`, error.message);
    }
  }
  
  async getServiceInfo(serviceId, serviceAddOnId) {
    try {
      const cached = await redisClient.get('services_cache');
      if (cached) {
        const services = JSON.parse(cached);
        const service = services.find(s => s._id.toString() === serviceId.toString());
        if (service) {
          const addOn = service.serviceAddOns.find(a => a._id.toString() === serviceAddOnId.toString());
          if (addOn) {
            return {
              serviceName: service.name,
              serviceType: service.type,
              serviceDuration: service.durationMinutes,
              serviceAddOnName: addOn.name,
              servicePrice: addOn.price
            };
          }
        }
      }
      
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
      const cached = await redisClient.get('users_cache');
      if (!cached) throw new Error('users_cache not found');
      
      const users = JSON.parse(cached);
      const dentist = users.find(u => u._id.toString() === dentistId.toString());
      
      if (!dentist) throw new Error('Dentist not found');
      return dentist;
    } catch (error) {
      throw new Error('Cannot get dentist info: ' + error.message);
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
        paymentId,
        totalAmount: reservation.servicePrice,
        status: 'confirmed',
        bookedAt: new Date(),
        bookedBy: reservation.bookedBy,
        bookedByRole: reservation.bookedByRole,
        bookingChannel: reservation.bookingChannel,
        notes: reservation.notes
      });
      
      await appointment.save();
      
      await serviceClient.bulkUpdateSlots(reservation.slotIds, {
        status: 'booked',
        appointmentId: appointment._id
      });
      
      await rpcClient.call('service-service', 'markServiceAddOnAsUsed', {
        serviceId: reservation.serviceId,
        serviceAddOnId: reservation.serviceAddOnId
      });
      
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
    
    if (!appointment.canCheckIn()) {
      throw new Error('Cannot check-in this appointment');
    }
    
    appointment.status = 'checked-in';
    appointment.checkedInAt = new Date();
    appointment.checkedInBy = userId;
    await appointment.save();
    
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
        dentistId, slotIds, date, notes, paymentMethod
      } = appointmentData;
      
      // Validate slots available
      await this.validateSlotsAvailable(slotIds);
      
      // Get service info
      const serviceInfo = await this.getServiceInfo(serviceId, serviceAddOnId);
      
      // Get dentist info
      const dentistInfo = await this.getDentistInfo(dentistId);
      
      // Get slot info
      const slots = await Promise.all(slotIds.map(id => this.getSlotInfo(id)));
      slots.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
      const firstSlot = slots[0];
      const startTime = this.formatTime(slots[0].startTime);
      const endTime = this.formatTime(slots[slots.length - 1].endTime);
      
      // Generate appointment code
      const appointmentDate = new Date(date);
      const appointmentCode = await Appointment.generateAppointmentCode(appointmentDate);
      
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
        roomId: firstSlot.roomId,
        roomName: firstSlot.roomName || '',
        paymentId: null, // Will be created later if needed
        totalAmount: serviceInfo.servicePrice,
        status: 'confirmed',
        bookedAt: new Date(),
        bookedBy: currentUser._id,
        bookedByRole: currentUser.role,
        bookingChannel: 'offline',
        notes: notes || ''
      });
      
      await appointment.save();
      
      // Update slots as booked
      await serviceClient.bulkUpdateSlots(slotIds, {
        status: 'booked',
        appointmentId: appointment._id
      });
      
      // Mark service as used
      await rpcClient.call('service-service', 'markServiceAddOnAsUsed', {
        serviceId,
        serviceAddOnId
      });
      
      // Publish event to create invoice
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
          appointmentDate: appointment.appointmentDate,
          startTime: appointment.startTime,
          endTime: appointment.endTime,
          paymentId: null,
          totalAmount: appointment.totalAmount,
          paymentMethod: paymentMethod || 'cash'
        }
      });
      
      console.log('Offline appointment created: ' + appointmentCode);
      return appointment;
      
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
        bookingChannel: reservation.bookingChannel,
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
      
      // Mark service as used (keep RPC for now)
      await rpcClient.call('service-service', 'markServiceAddOnAsUsed', {
        serviceId: reservation.serviceId,
        serviceAddOnId: reservation.serviceAddOnId
      });
      
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
}

module.exports = new AppointmentService();

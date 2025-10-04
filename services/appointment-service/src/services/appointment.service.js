const Appointment = require('../models/appointment.model');
const redisClient = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitmq.client');
const rpcClient = require('../utils/rpcClient');

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
        if (!slot.isBooked && slot.isActive) {
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
  
  async isSlotLocked(slotId) {
    try {
      const lock = await redisClient.get('temp_slot_lock:' + slotId);
      return lock !== null;
    } catch (error) {
      console.warn('Redis check failed:', error);
      return false;
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
      
      const ttl = 15 * 60;
      await redisClient.setex(
        'temp_reservation:' + reservationId,
        ttl,
        JSON.stringify(reservation)
      );
      
      for (const slotId of slotIds) {
        await redisClient.setex(
          'temp_slot_lock:' + slotId,
          ttl,
          JSON.stringify({ reservationId, lockedAt: new Date() })
        );
      }
      
      const paymentResult = await rpcClient.call('payment-service', 'createTempPayment', {
        reservationId,
        amount: serviceInfo.servicePrice,
        patientInfo: {
          name: patientInfo.name,
          phone: patientInfo.phone,
          email: patientInfo.email
        },
        description: 'Payment for appointment - ' + serviceInfo.serviceAddOnName
      });
      
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
      const isLocked = await this.isSlotLocked(slotId);
      if (isLocked) {
        throw new Error('Slot ' + slotId + ' is currently locked');
      }
      
      const slot = await this.getSlotInfo(slotId);
      if (slot.isBooked) {
        throw new Error('Slot ' + slotId + ' is already booked');
      }
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
  
  async getSlotInfo(slotId) {
    try {
      const slot = await rpcClient.call('schedule-service', 'getSlot', { slotId });
      return slot;
    } catch (error) {
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
      
      await rpcClient.call('schedule-service', 'updateSlotsBooked', {
        slotIds: reservation.slotIds,
        appointmentId: appointment._id,
        isBooked: true
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
    
    await rpcClient.call('schedule-service', 'updateSlotsBooked', {
      slotIds: appointment.slotIds,
      appointmentId: null,
      isBooked: false
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
      await rpcClient.call('schedule-service', 'updateSlotsBooked', {
        slotIds,
        appointmentId: appointment._id,
        isBooked: true
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
}

module.exports = new AppointmentService();
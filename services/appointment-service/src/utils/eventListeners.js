const { consumeQueue } = require('./rabbitmq.client');
const appointmentService = require('../services/appointment.service');
const Appointment = require('../models/appointment.model');
const { 
  handlePaymentCompleted, 
  handlePaymentFailed, 
  handlePaymentTimeout 
} = require('./paymentEventHandlers');

/**
 * Setup event listeners for Appointment Service
 */
async function setupEventListeners() {
  try {
    // Listen to payment events
    await consumeQueue('payment.completed', async (message) => {
      await handlePaymentCompleted(message.data);
    });
    
    await consumeQueue('payment.failed', async (message) => {
      await handlePaymentFailed(message.data);
    });
    
    await consumeQueue('payment.timeout', async (message) => {
      await handlePaymentTimeout(message.data);
    });
    
    // 🔥 Listen to record events
    await consumeQueue('appointment_queue', async (message) => {
      const { event, data } = message;
      
      switch (event) {
        case 'record.in-progress':
          await handleRecordInProgress(data);
          break;
          
        case 'record.completed':
          await handleRecordCompleted(data);
          break;
          
        case 'appointment.completed':
          // Already handled internally
          break;
          
        default:
          console.warn(`⚠️ Unknown event in appointment_queue: ${event}`);
      }
    });
    
    // Legacy: Listen to payment_success events for backward compatibility
    await consumeQueue('appointment_payment_queue', async (message) => {
      const { event, data } = message;
      
      switch (event) {
        case 'payment_success':
          await handlePaymentSuccess(data);
          break;
          
        case 'payment_expired':
          await handlePaymentExpired(data);
          break;
          
        default:
          console.warn(`⚠️ Unknown event: ${event}`);
      }
    });
    
    console.log('✅ Appointment event listeners setup complete');
    
  } catch (error) {
    console.error('❌ Failed to setup event listeners:', error);
    throw error;
  }
}

/**
 * Handle payment_success event
 * Create real appointment from reservation
 */
async function handlePaymentSuccess(data) {
  try {
    console.log('🎉 Payment success - Creating appointment:', data.reservationId);
    
    const appointment = await appointmentService.createAppointmentFromPayment(data);
    
    console.log(`✅ Appointment created: ${appointment.appointmentCode}`);
    
  } catch (error) {
    console.error('❌ Error handling payment success:', error);
    // Don't throw - let RabbitMQ ACK the message to avoid infinite retry
  }
}

/**
 * Handle payment_expired event
 * Clean up reservation and release slots
 */
async function handlePaymentExpired(data) {
  try {
    console.log('⏰ Payment expired - Cleaning up reservation:', data.reservationId);
    
    const redisClient = require('./redis.client');
    
    // Get reservation
    const reservationStr = await redisClient.get(`temp_reservation:${data.reservationId}`);
    if (reservationStr) {
      const reservation = JSON.parse(reservationStr);
      
      // Delete reservation
      await redisClient.del(`temp_reservation:${data.reservationId}`);
      
      // Delete slot locks
      for (const slotId of reservation.slotIds) {
        await redisClient.del(`temp_slot_lock:${slotId}`);
      }
      
      console.log(`✅ Reservation cleaned up: ${data.reservationId}`);
    }
    
  } catch (error) {
    console.error('❌ Error handling payment expired:', error);
  }
}

/**
 * Handle record.in-progress event
 * Update appointment status to 'in-progress'
 */
async function handleRecordInProgress(data) {
  try {
    console.log('🔄 Record in progress - Updating appointment:', data.appointmentId);
    
    if (!data.appointmentId) {
      console.warn('⚠️ No appointmentId provided in record.in-progress event');
      return;
    }
    
    const appointment = await Appointment.findById(data.appointmentId);
    if (!appointment) {
      console.warn(`⚠️ Appointment not found: ${data.appointmentId}`);
      return;
    }
    
    // Update appointment status to in-progress
    if (appointment.status !== 'in-progress') {
      appointment.status = 'in-progress';
      await appointment.save();
      console.log(`✅ Appointment ${appointment.appointmentCode} status updated to in-progress`);
    }
    
  } catch (error) {
    console.error('❌ Error handling record.in-progress:', error);
  }
}

/**
 * Handle record.completed event
 * Update appointment status to 'completed' and create payment
 */
async function handleRecordCompleted(data) {
  try {
    console.log('✅ Record completed - Updating appointment:', data.appointmentId);
    
    if (!data.appointmentId) {
      console.warn('⚠️ No appointmentId provided in record.completed event');
      return;
    }
    
    const appointment = await Appointment.findById(data.appointmentId);
    if (!appointment) {
      console.warn(`⚠️ Appointment not found: ${data.appointmentId}`);
      return;
    }
    
    // Update appointment status to completed
    if (appointment.status !== 'completed') {
      appointment.status = 'completed';
      appointment.completedAt = data.completedAt || new Date();
      await appointment.save();
      console.log(`✅ Appointment ${appointment.appointmentCode} status updated to completed`);
    }
    
    // 🔥 Create payment request
    try {
      const { publishToQueue } = require('./rabbitmq.client');
      
      // Calculate total amount (service price)
      let totalAmount = data.totalCost || appointment.servicePrice || 0;
      
      // Check if appointment was created by patient (online booking)
      // If yes, subtract deposit amount
      let depositToDeduct = 0;
      if (appointment.bookingChannel === 'online' && appointment.paymentId) {
        // Patient already paid deposit during online booking
        // Need to check payment service for deposit amount
        // For now, assume standard deposit amount
        const scheduleConfig = await appointmentService.getScheduleConfig ? appointmentService.getScheduleConfig() : null;
        const depositPerSlot = scheduleConfig?.depositAmount || 100000;
        const slotCount = appointment.slotIds ? appointment.slotIds.length : 1;
        depositToDeduct = depositPerSlot * slotCount;
        console.log(`💰 Deducting deposit: ${depositToDeduct} VND (${slotCount} slots × ${depositPerSlot})`);
      }
      
      const finalAmount = Math.max(0, totalAmount - depositToDeduct);
      
      // Publish payment.create event to payment-service
      await publishToQueue('payment_queue', {
        event: 'payment.create',
        data: {
          recordId: data.recordId,
          appointmentId: data.appointmentId,
          patientId: data.patientId,
          patientInfo: data.patientInfo,
          dentistId: data.dentistId,
          serviceId: data.serviceId,
          serviceName: data.serviceName,
          originalAmount: totalAmount,
          depositDeducted: depositToDeduct,
          finalAmount: finalAmount,
          createdBy: data.modifiedBy,
          completedAt: data.completedAt
        }
      });
      console.log(`✅ Published payment.create event for record ${data.recordCode}`);
      
    } catch (paymentError) {
      console.error('❌ Failed to create payment:', paymentError);
      // Don't throw - appointment completion already successful
    }
    
  } catch (error) {
    console.error('❌ Error handling record.completed:', error);
  }
}

module.exports = { setupEventListeners };

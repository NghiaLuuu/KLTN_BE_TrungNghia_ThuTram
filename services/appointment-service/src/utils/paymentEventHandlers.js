/**
 * @author: TrungNghia
 * Payment Event Handlers cho Appointment Service
 * Listen to payment.completed và payment.failed events
 */

const appointmentService = require('../services/appointment.service');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Handle payment.completed event
 * Tạo appointment thật từ reservation
 */
async function handlePaymentCompleted(data) {
  try {
    console.log('💰 Processing payment.completed event:', data);
    
    const { 
      reservationId, 
      paymentId, 
      transactionId,
      amount,
      paymentMethod 
    } = data;
    
    if (!reservationId) {
      console.error('❌ Missing reservationId in payment.completed event');
      return;
    }
    
    // Tạo appointment từ reservation
    const appointment = await appointmentService.createFromReservation(
      reservationId,
      {
        paymentId,
        transactionId,
        paymentMethod,
        paymentStatus: 'completed',
        paidAmount: amount
      }
    );
    
    console.log('✅ Created appointment from payment:', appointment.appointmentCode);
    
    // Publish appointment.created event to schedule-service
    await publishToQueue('schedule_queue', {
      event: 'appointment.created',
      timestamp: new Date(),
      data: {
        appointmentId: appointment._id,
        appointmentCode: appointment.appointmentCode,
        patientId: appointment.patientId,
        dentistId: appointment.dentistId,
        serviceId: appointment.serviceId,
        slotIds: appointment.slotIds,
        appointmentDate: appointment.appointmentDate,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        roomId: appointment.roomId,
        totalAmount: appointment.totalAmount,
        paymentId: appointment.paymentId,
        status: appointment.status
      }
    });
    
    console.log('📤 Published to schedule_queue: appointment.created');
    
    // Publish appointment.created event to invoice-service
    await publishToQueue('invoice_queue', {
      event: 'appointment.created',
      timestamp: new Date(),
      data: {
        appointmentId: appointment._id,
        paymentId: appointment.paymentId
      }
    });
    
    console.log('📤 Published to invoice_queue: appointment.created');
    
    // 🆕 Publish event to record-service to mark treatment indication as used
    if (appointment.patientId && appointment.serviceId) {
      try {
        await publishToQueue('record_queue', {
          event: 'appointment.service_booked',
          timestamp: new Date(),
          data: {
            appointmentId: appointment._id,
            patientId: appointment.patientId,
            serviceId: appointment.serviceId,
            serviceAddOnId: appointment.serviceAddOnId || null,
            appointmentDate: appointment.appointmentDate,
            reason: 'appointment_created_from_payment'
          }
        });
        console.log('✅ Published appointment.service_booked event to record-service');
      } catch (eventError) {
        console.error('⚠️ Failed to publish to record-service:', eventError.message);
        // Don't throw - appointment already created
      }
    }
    
  } catch (error) {
    console.error('❌ Error handling payment.completed:', error);
    
    // Publish error event for monitoring
    await publishToQueue('appointment_queue', {
      event: 'appointment.creation.failed',
      timestamp: new Date(),
      data: {
        error: error.message,
        ...data
      }
    });
  }
}

/**
 * Handle payment.failed event
 * Unlock slots và cleanup reservation
 */
async function handlePaymentFailed(data) {
  try {
    console.log('💳 Processing payment.failed event:', data);
    
    const { reservationId, reason } = data;
    
    if (!reservationId) {
      console.error('❌ Missing reservationId in payment.failed event');
      return;
    }
    
    // Cancel reservation và unlock slots
    await appointmentService.cancelReservation(reservationId, reason || 'Payment failed');
    
    console.log('✅ Cancelled reservation due to payment failure:', reservationId);
    
  } catch (error) {
    console.error('❌ Error handling payment.failed:', error);
  }
}

/**
 * Handle payment.timeout event
 * Tự động hủy reservation sau 15 phút
 */
async function handlePaymentTimeout(data) {
  try {
    console.log('⏰ Processing payment.timeout event:', data);
    
    const { reservationId } = data;
    
    if (!reservationId) {
      console.error('❌ Missing reservationId in payment.timeout event');
      return;
    }
    
    // Cancel reservation và unlock slots
    await appointmentService.cancelReservation(reservationId, 'Payment timeout');
    
    console.log('✅ Cancelled reservation due to timeout:', reservationId);
    
  } catch (error) {
    console.error('❌ Error handling payment.timeout:', error);
  }
}

module.exports = {
  handlePaymentCompleted,
  handlePaymentFailed,
  handlePaymentTimeout
};

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
    
    // Publish appointment.created event
    await publishToQueue('appointment.created', {
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
    
    console.log('✅ Published appointment.created event');
    
  } catch (error) {
    console.error('❌ Error handling payment.completed:', error);
    
    // Publish error event for monitoring
    await publishToQueue('appointment.error', {
      event: 'appointment.creation.failed',
      timestamp: new Date(),
      error: error.message,
      data: data
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

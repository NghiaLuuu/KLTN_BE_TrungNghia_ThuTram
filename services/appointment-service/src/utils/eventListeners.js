const { consumeQueue } = require('./rabbitmq.client');
const appointmentService = require('../services/appointment.service');

/**
 * Setup event listeners for Appointment Service
 */
async function setupEventListeners() {
  try {
    // Listen to payment_success events
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

module.exports = { setupEventListeners };

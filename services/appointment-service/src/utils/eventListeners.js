const { consumeQueue } = require('./rabbitmq.client');
const appointmentService = require('../services/appointment.service');
const Appointment = require('../models/appointment.model');
const { getIO } = require('../utils/socket');
const { 
  handlePaymentCompleted, 
  handlePaymentFailed, 
  handlePaymentTimeout 
} = require('./paymentEventHandlers');

const resolveBookingChannel = (bookedByRole) => (
  bookedByRole === 'patient' ? 'online' : 'offline'
);

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
      appointment.startedAt = data.startedAt || new Date();
      await appointment.save();
      console.log(`✅ Appointment ${appointment.appointmentCode} status updated to in-progress`);

      // Notify queue clients
      try {
        const io = getIO();
        if (io) {
          io.emit('queue_updated', {
            roomId: appointment.roomId?.toString(),
            timestamp: new Date()
          });
        }
      } catch (emitError) {
        console.warn('⚠️ Failed to emit queue update after record start:', emitError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error handling record.in-progress:', error);
  }
}

/**
 * Handle record.completed event
 * Update appointment status to 'completed' and create payment for treatment indications
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

      // Notify queue clients to refresh room info
      try {
        const io = getIO();
        if (io) {
          io.emit('queue_updated', {
            roomId: appointment.roomId?.toString(),
            timestamp: new Date()
          });
        }
      } catch (emitError) {
        console.warn('⚠️ Failed to emit queue update after record completion:', emitError.message);
      }
    }
    
    // 🔥 Create payment/invoice request
    try {
      const { publishToQueue } = require('./rabbitmq.client');
      const serviceClient = require('./serviceClient');
      
      // Calculate service amounts
      let services = [];
      let totalAmount = 0;
      
      // 1. Add main serviceAddOn (dịch vụ phụ được chọn khi đặt lịch)
      // Note: Service chính (exam/treatment) KHÔNG có giá, chỉ ServiceAddOn mới có giá
      if (appointment.serviceAddOnId && appointment.serviceAddOnName) {
        const mainServiceAddOnPrice = appointment.totalAmount || 0; // Giá đã lưu từ lúc booking
        services.push({
          serviceId: appointment.serviceId,
          serviceName: appointment.serviceName,
          serviceType: appointment.serviceType,
          serviceAddOnId: appointment.serviceAddOnId,
          serviceAddOnName: appointment.serviceAddOnName,
          price: mainServiceAddOnPrice,
          quantity: 1,
          type: 'main' // Dịch vụ chính khi đặt lịch
        });
        totalAmount += mainServiceAddOnPrice;
        console.log(`📋 Main ServiceAddOn: ${appointment.serviceAddOnName} - ${mainServiceAddOnPrice} VND`);
      } else {
        // Trường hợp không có serviceAddOn (có thể xảy ra với lịch offline)
        console.warn('⚠️ No serviceAddOn found in appointment - this may be an issue');
      }
      
      // 2. Add treatment indications (các serviceAddOn được thêm trong quá trình điều trị)
      if (data.treatmentIndications && data.treatmentIndications.length > 0) {
        for (const indication of data.treatmentIndications) {
          if (indication.used) {
            // ✅ Fetch giá từ service-service API
            let indicationPrice = 0;
            
            if (indication.serviceAddOnId) {
              try {
                const addOnData = await serviceClient.getServiceAddOnPrice(
                  indication.serviceId,
                  indication.serviceAddOnId
                );
                
                if (addOnData && addOnData.price !== undefined) {
                  indicationPrice = addOnData.price;
                  console.log(`✅ Fetched price for ${indication.serviceAddOnName}: ${indicationPrice} VND`);
                } else {
                  console.warn(`⚠️ No price found for ServiceAddOn: ${indication.serviceAddOnName}`);
                }
              } catch (fetchError) {
                console.error(`❌ Failed to fetch price for ${indication.serviceAddOnName}:`, fetchError.message);
              }
            }
            
            services.push({
              serviceId: indication.serviceId,
              serviceName: indication.serviceName,
              serviceAddOnId: indication.serviceAddOnId,
              serviceAddOnName: indication.serviceAddOnName,
              price: indicationPrice,
              quantity: 1,
              notes: indication.notes,
              type: 'treatment' // Dịch vụ được thêm trong điều trị
            });
            totalAmount += indicationPrice;
            console.log(`📋 Treatment indication: ${indication.serviceAddOnName || indication.serviceName} - ${indicationPrice} VND`);
          }
        }
      }
      
      // 3. Check if appointment was online booking (has deposit)
      let depositPaid = 0;
      let originalPaymentId = null;
      
      const bookingChannel = resolveBookingChannel(appointment.bookedByRole);

      if (bookingChannel === 'online' && appointment.paymentId) {
        // Patient paid deposit - need to fetch payment details
        originalPaymentId = appointment.paymentId;
        
        // TODO: Query payment-service to get exact deposit amount
        // For now, calculate from slot count
        const slotCount = appointment.slotIds ? appointment.slotIds.length : 1;
        const depositPerSlot = 100000; // Default from schedule config
        depositPaid = depositPerSlot * slotCount;
        
        console.log(`💰 Online booking - Deposit paid: ${depositPaid} VND (${slotCount} slots)`);
      }
      
      // 4. Calculate final amount (total services - deposit)
      const finalAmount = Math.max(0, totalAmount - depositPaid);
      
      console.log(`💵 Payment calculation:
        - Total services: ${totalAmount} VND
        - Deposit paid: ${depositPaid} VND
        - Final amount: ${finalAmount} VND
      `);
      
      // 5. Publish invoice.create event to invoice-service
      await publishToQueue('invoice_queue', {
        event: 'invoice.create_from_record',
        data: {
          recordId: data.recordId,
          recordCode: data.recordCode,
          appointmentId: data.appointmentId,
          appointmentCode: appointment.appointmentCode,
          patientId: data.patientId,
          patientInfo: data.patientInfo || appointment.patientInfo,
          dentistId: data.dentistId,
          dentistName: appointment.dentistName,
          roomId: appointment.roomId,
          roomName: appointment.roomName,
          subroomId: appointment.subroomId,
          subroomName: appointment.subroomName,
          services: services,
          totalAmount: totalAmount,
          depositPaid: depositPaid,
          originalPaymentId: originalPaymentId,
          finalAmount: finalAmount,
          bookingChannel,
          createdBy: data.modifiedBy,
          completedAt: data.completedAt
        }
      });
      console.log(`✅ Published invoice.create_from_record event for record ${data.recordCode}`);
      
    } catch (paymentError) {
      console.error('❌ Failed to create invoice:', paymentError);
      // Don't throw - appointment completion already successful
    }
    
  } catch (error) {
    console.error('❌ Error handling record.completed:', error);
  }
}

module.exports = { setupEventListeners };

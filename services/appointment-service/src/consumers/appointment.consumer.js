const rabbitmqClient = require('../utils/rabbitmq.client');
const appointmentRepository = require('../repositories/appointment.repository');

/**
 * Generate unique appointment code
 * Format: AP000001-DDMMYYYY
 */
async function generateAppointmentCode(date) {
  const dateStr = new Date(date).toISOString().split('T')[0].split('-').reverse().join('');
  const count = await appointmentRepository.countAppointmentsOnDate(date);
  const sequence = String(count + 1).padStart(6, '0');
  return `AP${sequence}-${dateStr}`;
}

/**
 * Start consuming messages from appointment_queue
 */
async function startConsumer() {
  try {
    await rabbitmqClient.consumeFromQueue('appointment_queue', async (message) => {
      console.log('📥 [Appointment Consumer] Received event:', {
        event: message.event,
        timestamp: new Date().toISOString()
      });

      if (message.event === 'payment.completed') {
        const { reservationId, paymentId, paymentCode, amount, appointmentData } = message.data;

        console.log('🔄 [Appointment Consumer] Processing payment.completed:', {
          reservationId,
          paymentId,
          paymentCode,
          amount
        });

        if (!appointmentData) {
          console.warn('⚠️ [Appointment Consumer] No appointmentData provided, skipping...');
          return;
        }

        try {
          // Generate appointment code
          const appointmentCode = await generateAppointmentCode(appointmentData.appointmentDate);

          // Build appointment document
          const appointmentDoc = {
            appointmentCode,
            
            // Patient info - MATCH MODEL SCHEMA
            patientId: appointmentData.patientId || null,
            patientInfo: {
              name: appointmentData.patientInfo?.fullName || appointmentData.patientInfo?.name || 'Patient',
              phone: appointmentData.patientInfo?.phone || '0000000000',
              email: appointmentData.patientInfo?.email || null,
              birthYear: appointmentData.patientInfo?.dateOfBirth 
                ? new Date(appointmentData.patientInfo.dateOfBirth).getFullYear() 
                : new Date().getFullYear() - 30 // Default to 30 years old
            },
            
            // Service info
            serviceId: appointmentData.serviceId,
            serviceName: appointmentData.serviceName,
            serviceType: appointmentData.serviceType || 'treatment',
            serviceAddOnId: appointmentData.serviceAddOnId || null, // ✅ Optional
            serviceAddOnName: appointmentData.serviceAddOnName || null, // ✅ Optional
            serviceDuration: appointmentData.serviceDuration || 15,
            servicePrice: appointmentData.servicePrice || amount, // ✅ Optional
            
            // Dentist info
            dentistId: appointmentData.dentistId,
            dentistName: appointmentData.dentistName || 'Dentist',
            
            // Slot & Schedule info
            slotIds: appointmentData.slotIds || [],
            appointmentDate: new Date(appointmentData.appointmentDate),
            startTime: appointmentData.startTime,
            endTime: appointmentData.endTime,
            roomId: appointmentData.roomId,
            roomName: appointmentData.roomName || '',
            
            // Payment info
            paymentId: paymentId,
            invoiceId: null, // Will be set by invoice-service
            totalAmount: amount,
            
            // Status
            status: 'confirmed',
            
            // Booking info
            bookedAt: new Date(),
            bookedBy: appointmentData.patientId || null,
            
            // Notes
            notes: appointmentData.notes || '',
            
            // Reservation tracking (for linking)
            reservationId: reservationId  // ✅ ADD THIS
          };

          console.log('📝 [Appointment Consumer] Creating appointment:', {
            appointmentCode,
            patientName: appointmentDoc.patientInfo.name,
            serviceName: appointmentDoc.serviceName,
            serviceAddOn: appointmentDoc.serviceAddOnName || 'None',
            slotCount: appointmentDoc.slotIds.length,
            date: appointmentDoc.appointmentDate
          });

          // Create appointment in database
          const appointment = await appointmentRepository.createAppointment(appointmentDoc);

          console.log('✅ [Appointment Consumer] Appointment created successfully:', {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointment.appointmentCode,
            reservationId
          });

          // 🔔 PUBLISH appointment.created EVENT for other services
          console.log('📤 [Appointment Consumer] Publishing appointment.created event...');
          
          // Notify schedule-service to update slots with appointmentId
          await rabbitmqClient.publishToQueue('schedule_queue', {
            event: 'appointment.created',
            data: {
              appointmentId: appointment._id.toString(),
              slotIds: appointment.slotIds,
              reservationId: appointment.reservationId,
              status: 'booked'
            }
          });
          console.log('✅ [Appointment Consumer] Published appointment.created to schedule queue');
          // Notify invoice-service to link invoice with appointmentId (using paymentId)
          await rabbitmqClient.publishToQueue('invoice_queue', {
            event: 'appointment.created',
            data: {
              appointmentId: appointment._id.toString(),
              paymentId: appointment.paymentId // ✅ Use paymentId instead of reservationId
            }
          });

          console.log('✅ [Appointment Consumer] Published appointment.created to schedule & invoice queues');

        } catch (error) {
          console.error('❌ [Appointment Consumer] Error creating appointment:', {
            error: error.message,
            reservationId,
            stack: error.stack
          });
          throw error; // Will trigger RabbitMQ retry
        }
      } else if (message.event === 'invoice.created') {
        // Handle invoice created event - update appointment with invoiceId
        const { invoiceId, paymentId, reservationId } = message.data;

        console.log('🔄 [Appointment Consumer] Processing invoice.created:', {
          invoiceId,
          paymentId,
          reservationId
        });

        if (!invoiceId || !paymentId) {
          console.warn('⚠️ [Appointment Consumer] Missing invoiceId or paymentId, skipping...');
          return;
        }

        try {
          // Find appointment by paymentId
          const appointment = await appointmentRepository.findOne({ paymentId });

          if (!appointment) {
            console.warn('⚠️ [Appointment Consumer] Appointment not found for paymentId:', paymentId);
            return;
          }

          console.log('📝 [Appointment Consumer] Updating appointment with invoiceId:', {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointment.appointmentCode,
            invoiceId
          });

          // Update appointment with invoiceId
          await appointmentRepository.updateInvoiceId(appointment._id, invoiceId);

          console.log('✅ [Appointment Consumer] Appointment linked to invoice successfully:', {
            appointmentId: appointment._id.toString(),
            invoiceId
          });

        } catch (error) {
          console.error('❌ [Appointment Consumer] Error linking appointment to invoice:', {
            error: error.message,
            invoiceId,
            paymentId,
            stack: error.stack
          });
          throw error; // Will trigger RabbitMQ retry
        }
      } else {
        console.log('ℹ️ [Appointment Consumer] Unhandled event type:', message.event);
      }
    });

    console.log('👂 [Appointment Consumer] Listening to appointment_queue...');
  } catch (error) {
    console.error('❌ [Appointment Consumer] Failed to start consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };


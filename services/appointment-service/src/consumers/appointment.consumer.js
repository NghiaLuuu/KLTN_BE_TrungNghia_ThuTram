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
          // Query invoice by paymentId to get invoiceId
          let invoiceId = null;
          
          try {
            const axios = require('axios');
            const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || 'http://localhost:3008';
            
            // Wait for invoice to be created (invoice creation happens first)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const invoiceResponse = await axios.get(
              `${INVOICE_SERVICE_URL}/api/invoice/by-payment/${paymentId}`,
              { timeout: 5000 }
            );
            
            if (invoiceResponse.data?.success && invoiceResponse.data?.data) {
              invoiceId = invoiceResponse.data.data._id;
              console.log('✅ Invoice found:', invoiceId);
            }
          } catch (error) {
            console.warn('⚠️ Invoice query failed:', error.message);
          }

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
            serviceAddOnId: appointmentData.serviceAddOnId || null,
            serviceAddOnName: appointmentData.serviceAddOnName || null,
            serviceDuration: appointmentData.serviceDuration || 15,
            servicePrice: appointmentData.servicePrice || amount,
            
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
            
            // Payment & Invoice info
            paymentId: paymentId,
            invoiceId: invoiceId, // ✅ Set from query result
            totalAmount: amount,
            
            // Status
            status: 'confirmed',
            
            // Booking info
            bookedAt: new Date(),
            bookedBy: appointmentData.patientId || null,
            
            // Notes
            notes: appointmentData.notes || '',
            
            // Reservation tracking
            reservationId: reservationId
          };

          // Create appointment in database
          const appointment = await appointmentRepository.createAppointment(appointmentDoc);

          console.log('✅ Appointment created:', {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointment.appointmentCode,
            paymentId: appointment.paymentId?.toString(),
            invoiceId: appointment.invoiceId?.toString() || null
          });

          // Notify schedule-service to update slots
          await rabbitmqClient.publishToQueue('schedule_queue', {
            event: 'appointment.created',
            data: {
              appointmentId: appointment._id.toString(),
              slotIds: appointment.slotIds,
              reservationId: appointment.reservationId,
              status: 'booked'
            }
          });

          // Notify invoice-service to link appointmentId
          if (appointment.paymentId) {
            await rabbitmqClient.publishToQueue('invoice_queue', {
              event: 'appointment.created',
              data: {
                appointmentId: appointment._id.toString(),
                paymentId: appointment.paymentId.toString()
              }
            });
          }

        } catch (error) {
          console.error('❌ Error creating appointment:', error.message);
          throw error;
        }
      }
    });

    console.log('👂 [Appointment Consumer] Listening to appointment_queue...');
  } catch (error) {
    console.error('❌ [Appointment Consumer] Failed to start consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };


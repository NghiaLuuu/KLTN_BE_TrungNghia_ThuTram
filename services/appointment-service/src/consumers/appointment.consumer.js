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
            subroomId: appointmentData.subroomId || null, // ✅ FIX: Add subroom ID
            subroomName: appointmentData.subroomName || null, // ✅ FIX: Add subroom name
            
            // Payment & Invoice info
            paymentId: paymentId,
            invoiceId: invoiceId, // ✅ Set from query result
            totalAmount: amount,
            
            // Status
            status: 'confirmed',
            
            // Booking info
            bookedAt: new Date(),
            bookedBy: appointmentData.patientId || null,
            bookedByRole: appointmentData.bookedByRole || 'patient', // ✅ FIX: Add bookedByRole
            
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

      // 🆕 Handle record.in-progress event
      if (message.event === 'record.in-progress') {
        console.log('🔥🔥🔥 [Appointment Consumer] RECEIVED record.in-progress event!');
        const { appointmentId, recordId, recordCode, startedAt } = message.data;

        console.log('🔄 [Appointment Consumer] Processing record.in-progress:', {
          appointmentId,
          recordId,
          recordCode,
          startedAt,
          fullMessageData: JSON.stringify(message.data, null, 2)
        });

        if (!appointmentId) {
          console.warn('⚠️⚠️⚠️ [Appointment Consumer] No appointmentId provided, skipping...');
          return;
        }

        try {
          console.log(`🔍 [Appointment Consumer] Fetching appointment ${appointmentId}...`);
          // Update appointment status to in-progress
          const appointment = await appointmentRepository.findById(appointmentId);
          if (appointment) {
            console.log(`📝 [Appointment Consumer] Current appointment status: ${appointment.status}`);
            console.log(`📝 [Appointment Consumer] Appointment data:`, {
              roomId: appointment.roomId,
              appointmentDate: appointment.appointmentDate,
              queueNumber: appointment.queueNumber,
              patientName: appointment.patientInfo?.name
            });
            
            await appointmentRepository.updateStatus(appointmentId, 'in-progress');
            console.log(`✅✅✅ Updated appointment ${appointmentId} status to in-progress`);
            
            // 🔥 PUBLISH TO RECORD SERVICE: Let record-service emit socket (port 3010)
            // FE connects to record-service socket, not appointment-service
            try {
              const { publishToQueue } = require('../utils/rabbitmq.client');
              const updatedAppointment = await appointmentRepository.findById(appointmentId);
              
              if (updatedAppointment) {
                await publishToQueue('record_queue', {
                  event: 'appointment.status_changed',
                  data: {
                    appointmentId: updatedAppointment._id.toString(),
                    appointmentCode: updatedAppointment.appointmentCode,
                    status: 'in-progress',
                    roomId: updatedAppointment.roomId?.toString(),
                    date: updatedAppointment.appointmentDate,
                    patientName: updatedAppointment.patientInfo?.name,
                    recordId: recordId,
                    message: `Lịch hẹn ${updatedAppointment.appointmentCode} đang khám`
                  }
                });
                console.log('📡 [Appointment Consumer] Published status change to record-service for socket emit');
              }
            } catch (publishError) {
              console.warn('⚠️ Failed to publish to record-service:', publishError.message);
            }
          } else {
            console.warn(`⚠️⚠️⚠️ Appointment ${appointmentId} not found`);
          }
        } catch (error) {
          console.error('❌❌❌ Error updating appointment status to in-progress:', error.message);
          console.error('❌ Error stack:', error.stack);
          // Don't throw - record already updated
        }
      }

      // 🆕 Handle record.completed event
      if (message.event === 'record.completed') {
        const { appointmentId, recordId, recordCode, completedAt } = message.data;

        console.log('🔄 [Appointment Consumer] Processing record.completed:', {
          appointmentId,
          recordId,
          recordCode,
          completedAt
        });

        if (!appointmentId) {
          console.warn('⚠️ [Appointment Consumer] No appointmentId provided, skipping...');
          return;
        }

        try {
          // Update appointment status to completed
          const appointment = await appointmentRepository.findById(appointmentId);
          if (appointment) {
            console.log(`📝 [Appointment Consumer] Appointment data for completed:`, {
              roomId: appointment.roomId,
              appointmentDate: appointment.appointmentDate,
              queueNumber: appointment.queueNumber
            });
            
            await appointmentRepository.updateStatus(appointmentId, 'completed');
            console.log(`✅ Updated appointment ${appointmentId} status to completed`);
            
            // 🔥 PUBLISH TO RECORD SERVICE: Let record-service emit socket
            try {
              const { publishToQueue } = require('../utils/rabbitmq.client');
              const updatedAppointment = await appointmentRepository.findById(appointmentId);
              
              if (updatedAppointment) {
                await publishToQueue('record_queue', {
                  event: 'appointment.status_changed',
                  data: {
                    appointmentId: updatedAppointment._id.toString(),
                    appointmentCode: updatedAppointment.appointmentCode,
                    status: 'completed',
                    roomId: updatedAppointment.roomId?.toString(),
                    date: updatedAppointment.appointmentDate,
                    patientName: updatedAppointment.patientInfo?.name,
                    recordId: recordId,
                    message: `Lịch hẹn ${updatedAppointment.appointmentCode} đã hoàn thành`
                  }
                });
                console.log('📡 [Appointment Consumer] Published completed status to record-service');
              }
            } catch (publishError) {
              console.warn('⚠️ Failed to publish to record-service:', publishError.message);
            }
          } else {
            console.warn(`⚠️ Appointment ${appointmentId} not found`);
          }
        } catch (error) {
          console.error('❌ Error updating appointment status to completed:', error.message);
          // Don't throw - record already updated
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


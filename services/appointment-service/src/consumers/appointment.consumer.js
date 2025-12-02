const rabbitmqClient = require('../utils/rabbitmq.client');
const appointmentRepository = require('../repositories/appointment.repository');
const { parseVNDate } = require('../utils/timezone.helper');

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
 * ✅ FIXED: Support both RPC requests (with replyTo) and event messages
 */
async function startConsumer() {
  try {
    const channel = rabbitmqClient.getChannel();
    await channel.assertQueue('appointment_queue', { durable: true });
    await channel.prefetch(1);
    
    console.log('👂 [Appointment Consumer] Listening to appointment_queue...');
    
    channel.consume('appointment_queue', async (msg) => {
      if (!msg) return;
      
      try {
        const message = JSON.parse(msg.content.toString());
        
        console.log('📥 [Appointment Consumer] Received message:', {
          event: message.event,
          action: message.action,
          hasReplyTo: !!msg.properties.replyTo,
          timestamp: new Date().toISOString()
        });

        let response = null;

        // ============ RPC REQUESTS ============
        // Handle RPC requests (action-based)
        if (message.action) {
          console.log('🔧 [RPC] Processing action:', message.action);

          try {
          if (message.action === 'getAppointmentStatusStats') {
            // Get appointment status statistics using aggregation (FAST!)
            const { startDate, endDate, dentistId, roomId, groupBy = 'day' } = message.payload || {};
            
            console.log('📊 [RPC] getAppointmentStatusStats:', { startDate, endDate, dentistId, roomId, groupBy });
            console.time('⏱️ [RPC] getAppointmentStatusStats query time');

            const Appointment = require('../models/appointment.model');
            
            // Build match filters
            const matchStage = {
              appointmentDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
              }
            };

            if (dentistId) matchStage.dentistId = dentistId;
            if (roomId) matchStage.roomId = roomId;

            // 1. Get status summary (count by status)
            const statusStats = await Appointment.aggregate([
              { $match: matchStage },
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 }
                }
              }
            ]);

            console.log('📊 Status stats:', statusStats);

            // 2. Get timeline data grouped by period
            let groupByDateFormat;
            if (groupBy === 'month') {
              groupByDateFormat = { $dateToString: { format: '%Y-%m', date: '$appointmentDate' } };
            } else if (groupBy === 'year') {
              groupByDateFormat = { $dateToString: { format: '%Y', date: '$appointmentDate' } };
            } else {
              groupByDateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$appointmentDate' } };
            }

            const timeline = await Appointment.aggregate([
              { $match: matchStage },
              {
                $group: {
                  _id: {
                    date: groupByDateFormat,
                    status: '$status'
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { '_id.date': 1 } }
            ]);

            // 3. Get stats by dentist
            const byDentist = await Appointment.aggregate([
              { 
                $match: { 
                  ...matchStage,
                  dentistId: { $exists: true, $ne: null }
                } 
              },
              {
                $group: {
                  _id: {
                    dentistId: '$dentistId',
                    dentistName: '$dentistName',
                    status: '$status'
                  },
                  count: { $sum: 1 }
                }
              },
              { $sort: { count: -1 } }
            ]);

            console.timeEnd('⏱️ [RPC] getAppointmentStatusStats query time');
            console.log(`✅ [RPC] Aggregated ${statusStats.length} status groups, ${timeline.length} timeline points, ${byDentist.length} dentist stats`);
            
            response = {
              success: true,
              data: {
                statusStats,
                timeline,
                byDentist
              }
            };
          }

          if (message.action === 'getAppointmentsInRange') {
            // Get appointments in date range for statistics
            const { startDate, endDate, dentistId, roomId } = message.payload || {};
            
            console.log('📊 [RPC] getAppointmentsInRange:', { startDate, endDate, dentistId, roomId });
            console.time('⏱️ [RPC] getAppointmentsInRange query time');

            const filters = {
              appointmentDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
              }
            };

            if (dentistId) filters.dentistId = dentistId;
            if (roomId) filters.roomId = roomId;

            // 🔥 OPTIMIZED: Use direct query with .select() to only get needed fields
            const Appointment = require('../models/appointment.model');
            const appointments = await Appointment.find(filters)
              .select('appointmentCode appointmentDate startTime endTime status dentistId dentistName roomId roomName patientInfo patientId serviceName totalAmount createdAt')
              .sort({ appointmentDate: 1 })
              .limit(10000)
              .lean()
              .exec();
            
            console.timeEnd('⏱️ [RPC] getAppointmentsInRange query time');
            console.log(`✅ [RPC] Returning ${appointments.length} appointments`);
            
            response = {
              success: true,
              data: appointments
            };
          }

          if (message.action === 'getStatistics') {
            // Existing statistics handler
            const { startDate, endDate } = message.payload || {};
            const filters = {
              appointmentDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
              }
            };
            // findAll returns { appointments, total, page, pages }
            const result = await appointmentRepository.findAll(filters, { limit: 10000 });
            const appointments = result.appointments || [];
            
            response = {
              success: true,
              data: {
                total: appointments.length,
                completed: appointments.filter(a => a.status === 'completed').length,
                cancelled: appointments.filter(a => a.status === 'cancelled').length,
                totalUniquePatients: new Set(appointments.map(a => a.patientId?.toString())).size
              }
            };
          }

          // Return error for unknown actions
          if (!response) {
            response = {
              success: false,
              error: `Unknown action: ${message.action}`
            };
          }
        } catch (rpcError) {
          console.error('❌ [RPC] Error:', rpcError);
          response = {
            success: false,
            error: rpcError.message
          };
        }
        
        // ✅ Send RPC response back to caller
        if (msg.properties.replyTo) {
          channel.sendToQueue(
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(response)),
            { correlationId: msg.properties.correlationId }
          );
          console.log('✅ [RPC] Response sent to:', msg.properties.replyTo);
        }
      }

      // ============ EVENT MESSAGES ============
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
            appointmentDate: parseVNDate(appointmentData.appointmentDate), // ✅ Parse as VN midnight
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

          // 🆕 Notify record-service to mark treatment indication as used
          if (appointment.patientId && appointment.serviceId) {
            try {
              await rabbitmqClient.publishToQueue('record_queue', {
                event: 'appointment.service_booked',
                timestamp: new Date(),
                data: {
                  appointmentId: appointment._id.toString(),
                  patientId: appointment.patientId.toString(),
                  serviceId: appointment.serviceId.toString(),
                  serviceAddOnId: appointment.serviceAddOnId ? appointment.serviceAddOnId.toString() : null,
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
      
      // ✅ Acknowledge message after processing
      channel.ack(msg);
      
    } catch (error) {
      console.error('❌ [Consumer] Error processing message:', error);
      channel.nack(msg, false, false); // Don't requeue
    }
    });

    console.log('👂 [Appointment Consumer] Listening to appointment_queue...');
  } catch (error) {
    console.error('❌ [Appointment Consumer] Failed to start consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };


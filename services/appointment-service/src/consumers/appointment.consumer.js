const rabbitmqClient = require('../utils/rabbitmq.client');
const appointmentRepository = require('../repositories/appointment.repository');
const { parseVNDate } = require('../utils/timezone.helper');

/**
 * Sinh mã phiếu khám duy nhất
 * Định dạng: AP000001-DDMMYYYY
 */
async function generateAppointmentCode(date) {
  const dateStr = new Date(date).toISOString().split('T')[0].split('-').reverse().join('');
  const count = await appointmentRepository.countAppointmentsOnDate(date);
  const sequence = String(count + 1).padStart(6, '0');
  return `AP${sequence}-${dateStr}`;
}

/**
 * Bắt đầu consumer lắng nghe messages từ appointment_queue
 * ✅ ĐÃ SỬA: Hỗ trợ cả RPC requests (có replyTo) và event messages
 */
async function startConsumer() {
  try {
    const channel = rabbitmqClient.getChannel();
    await channel.assertQueue('appointment_queue', { durable: true });
    await channel.prefetch(1);
    
    console.log('👂 [Appointment Consumer] Đang lắng nghe appointment_queue...');
    
    channel.consume('appointment_queue', async (msg) => {
      if (!msg) return;
      
      try {
        const message = JSON.parse(msg.content.toString());
        
        console.log('📥 [Appointment Consumer] Nhận message:', {
          event: message.event,
          action: message.action,
          hasReplyTo: !!msg.properties.replyTo,
          timestamp: new Date().toISOString()
        });

        let response = null;

        // ============ CÁC RPC REQUESTS ============
        // Xử lý RPC requests (dựa trên action)
        if (message.action) {
          console.log('🔧 [RPC] Đang xử lý action:', message.action);

          try {
          if (message.action === 'getAppointmentStatusStats') {
            // Lấy thống kê trạng thái lịch hẹn bằng aggregation (NHANH!)
            const { startDate, endDate, dentistId, roomId, groupBy = 'day' } = message.payload || {};
            
            console.log('📊 [RPC] getAppointmentStatusStats:', { startDate, endDate, dentistId, roomId, groupBy });
            console.time('⏱️ [RPC] Thời gian truy vấn getAppointmentStatusStats');

            const Appointment = require('../models/appointment.model');
            const DateUtils = require('../utils/dateUtils');
            
            // Parse ngày với múi giờ Việt Nam
            const dateRange = DateUtils.parseDateRange(startDate, endDate);
            
            // Xây dựng bộ lọc match
            const matchStage = {
              appointmentDate: {
                $gte: dateRange.startDate,
                $lte: dateRange.endDate
              }
            };

            if (dentistId) matchStage.dentistId = dentistId;
            if (roomId) matchStage.roomId = roomId;

            // 1. Lấy thống kê tổng hợp theo trạng thái (đếm theo status)
            const statusStats = await Appointment.aggregate([
              { $match: matchStage },
              {
                $group: {
                  _id: '$status',
                  count: { $sum: 1 }
                }
              }
            ]);

            console.log('📊 Thống kê theo trạng thái:', statusStats);

            // 2. Lấy dữ liệu timeline theo khoảng thời gian
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

            // 3. Lấy thống kê theo nha sĩ
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

            console.timeEnd('⏱️ [RPC] Thời gian truy vấn getAppointmentStatusStats');
            console.log(`✅ [RPC] Đã aggregate ${statusStats.length} nhóm trạng thái, ${timeline.length} điểm timeline, ${byDentist.length} thống kê nha sĩ`);
            
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
            // Lấy lịch hẹn trong khoảng thời gian cho thống kê
            const { startDate, endDate, dentistId, roomId } = message.payload || {};
            
            console.log('📊 [RPC] getAppointmentsInRange:', { startDate, endDate, dentistId, roomId });
            console.time('⏱️ [RPC] Thời gian truy vấn getAppointmentsInRange');

            const filters = {
              appointmentDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
              }
            };

            if (dentistId) filters.dentistId = dentistId;
            if (roomId) filters.roomId = roomId;

            // 🔥 ĐÃ TỐI ƯU: Dùng query trực tiếp với .select() để chỉ lấy các field cần thiết
            const Appointment = require('../models/appointment.model');
            const appointments = await Appointment.find(filters)
              .select('appointmentCode appointmentDate startTime endTime status dentistId dentistName roomId roomName patientInfo patientId serviceName totalAmount createdAt')
              .sort({ appointmentDate: 1 })
              .limit(10000)
              .lean()
              .exec();
            
            console.timeEnd('⏱️ [RPC] Thời gian truy vấn getAppointmentsInRange');
            console.log(`✅ [RPC] Trả về ${appointments.length} lịch hẹn`);
            
            response = {
              success: true,
              data: appointments
            };
          }

          if (message.action === 'getStatistics') {
            // Handler thống kê có sẵn
            const { startDate, endDate } = message.payload || {};
            const filters = {
              appointmentDate: {
                $gte: new Date(startDate),
                $lte: new Date(endDate)
              }
            };
            // findAll trả về { appointments, total, page, pages }
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

          // Trả về lỗi cho action không xác định
          if (!response) {
            response = {
              success: false,
              error: `Action không xác định: ${message.action}`
            };
          }
        } catch (rpcError) {
          console.error('❌ [RPC] Lỗi:', rpcError);
          response = {
            success: false,
            error: rpcError.message
          };
        }
        
        // ✅ Gửi RPC response về cho caller
        if (msg.properties.replyTo) {
          channel.sendToQueue(
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(response)),
            { correlationId: msg.properties.correlationId }
          );
          console.log('✅ [RPC] Đã gửi response đến:', msg.properties.replyTo);
        }
      }

      // ============ CÁC EVENT MESSAGES ============
      if (message.event === 'payment.completed') {
        const { reservationId, paymentId, paymentCode, amount, appointmentData } = message.data;

        console.log('🔄 [Appointment Consumer] Đang xử lý payment.completed:', {
          reservationId,
          paymentId,
          paymentCode,
          amount
        });

        if (!appointmentData) {
          console.warn('⚠️ [Appointment Consumer] Không có appointmentData, bỏ qua...');
          return;
        }

        try {
          // Query invoice theo paymentId để lấy invoiceId
          let invoiceId = null;
          
          try {
            const axios = require('axios');
            const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || 'http://localhost:3008';
            
            // Chờ invoice được tạo (tạo invoice xảy ra trước)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const invoiceResponse = await axios.get(
              `${INVOICE_SERVICE_URL}/api/invoice/by-payment/${paymentId}`,
              { timeout: 5000 }
            );
            
            if (invoiceResponse.data?.success && invoiceResponse.data?.data) {
              invoiceId = invoiceResponse.data.data._id;
              console.log('✅ Tìm thấy invoice:', invoiceId);
            }
          } catch (error) {
            console.warn('⚠️ Truy vấn invoice thất bại:', error.message);
          }

          // Sinh mã phiếu khám
          const appointmentCode = await generateAppointmentCode(appointmentData.appointmentDate);

          // Xây dựng document lịch hẹn
          const appointmentDoc = {
            appointmentCode,
            
            // Thông tin bệnh nhân - KHỚP VỚI MODEL SCHEMA
            patientId: appointmentData.patientId || null,
            patientInfo: {
              name: appointmentData.patientInfo?.fullName || appointmentData.patientInfo?.name || 'Bệnh nhân',
              phone: appointmentData.patientInfo?.phone || '0000000000',
              email: appointmentData.patientInfo?.email || null,
              birthYear: appointmentData.patientInfo?.dateOfBirth 
                ? new Date(appointmentData.patientInfo.dateOfBirth).getFullYear() 
                : new Date().getFullYear() - 30 // Mặc định 30 tuổi
            },
            
            // Thông tin dịch vụ
            serviceId: appointmentData.serviceId,
            serviceName: appointmentData.serviceName,
            serviceType: appointmentData.serviceType || 'treatment',
            serviceAddOnId: appointmentData.serviceAddOnId || null,
            serviceAddOnName: appointmentData.serviceAddOnName || null,
            serviceDuration: appointmentData.serviceDuration || 15,
            servicePrice: appointmentData.servicePrice || amount,
            
            // Thông tin nha sĩ
            dentistId: appointmentData.dentistId,
            dentistName: appointmentData.dentistName || 'Nha sĩ',
            
            // Thông tin slot & lịch
            slotIds: appointmentData.slotIds || [],
            appointmentDate: parseVNDate(appointmentData.appointmentDate), // ✅ Parse thành nửa đêm VN
            startTime: appointmentData.startTime,
            endTime: appointmentData.endTime,
            roomId: appointmentData.roomId,
            roomName: appointmentData.roomName || '',
            subroomId: appointmentData.subroomId || null, // ✅ FIX: Thêm subroom ID
            subroomName: appointmentData.subroomName || null, // ✅ FIX: Thêm subroom name
            
            // Thông tin thanh toán & hóa đơn
            paymentId: paymentId,
            invoiceId: invoiceId, // ✅ Đặt từ kết quả query
            totalAmount: amount,
            
            // Trạng thái
            status: 'confirmed',
            
            // Thông tin đặt hẹn
            bookedAt: new Date(),
            bookedBy: appointmentData.patientId || null,
            bookedByRole: appointmentData.bookedByRole || 'patient', // ✅ FIX: Thêm bookedByRole
            
            // Ghi chú
            notes: appointmentData.notes || '',
            
            // Theo dõi reservation
            reservationId: reservationId
          };

          // Tạo lịch hẹn trong database
          const appointment = await appointmentRepository.createAppointment(appointmentDoc);

          console.log('✅ Đã tạo lịch hẹn:', {
            appointmentId: appointment._id.toString(),
            appointmentCode: appointment.appointmentCode,
            paymentId: appointment.paymentId?.toString(),
            invoiceId: appointment.invoiceId?.toString() || null
          });

          // Thông báo schedule-service cập nhật slots
          await rabbitmqClient.publishToQueue('schedule_queue', {
            event: 'appointment.created',
            data: {
              appointmentId: appointment._id.toString(),
              slotIds: appointment.slotIds,
              reservationId: appointment.reservationId,
              status: 'booked'
            }
          });

          // Thông báo invoice-service liên kết appointmentId
          if (appointment.paymentId) {
            await rabbitmqClient.publishToQueue('invoice_queue', {
              event: 'appointment.created',
              data: {
                appointmentId: appointment._id.toString(),
                paymentId: appointment.paymentId.toString()
              }
            });
          }

          // 🆕 Thông báo record-service đánh dấu chỉ định điều trị đã sử dụng
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
              console.log('✅ Đã publish event appointment.service_booked đến record-service');
            } catch (eventError) {
              console.error('⚠️ Thất bại khi publish đến record-service:', eventError.message);
              // Không throw - lịch hẹn đã được tạo
            }
          }

        } catch (error) {
          console.error('❌ Lỗi khi tạo lịch hẹn:', error.message);
          throw error;
        }
      }

      // 🆕 Xử lý event record.in-progress
      if (message.event === 'record.in-progress') {
        console.log('🔥🔥🔥 [Appointment Consumer] NHẬN event record.in-progress!');
        const { appointmentId, recordId, recordCode, startedAt } = message.data;

        console.log('🔄 [Appointment Consumer] Đang xử lý record.in-progress:', {
          appointmentId,
          recordId,
          recordCode,
          startedAt,
          fullMessageData: JSON.stringify(message.data, null, 2)
        });

        if (!appointmentId) {
          console.warn('⚠️⚠️⚠️ [Appointment Consumer] Không có appointmentId, bỏ qua...');
          return;
        }

        try {
          console.log(`🔍 [Appointment Consumer] Đang lấy lịch hẹn ${appointmentId}...`);
          // Cập nhật trạng thái lịch hẹn thành in-progress
          const appointment = await appointmentRepository.findById(appointmentId);
          if (appointment) {
            console.log(`📝 [Appointment Consumer] Trạng thái hiện tại: ${appointment.status}`);
            console.log(`📝 [Appointment Consumer] Dữ liệu lịch hẹn:`, {
              roomId: appointment.roomId,
              appointmentDate: appointment.appointmentDate,
              queueNumber: appointment.queueNumber,
              patientName: appointment.patientInfo?.name
            });
            
            await appointmentRepository.updateStatus(appointmentId, 'in-progress');
            console.log(`✅✅✅ Đã cập nhật lịch hẹn ${appointmentId} thành in-progress`);
            
            // 🔥 PUBLISH ĐẾN RECORD SERVICE: Để record-service emit socket (port 3010)
            // FE kết nối đến socket của record-service, không phải appointment-service
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
                console.log('📡 [Appointment Consumer] Đã publish thay đổi trạng thái đến record-service để emit socket');
              }
            } catch (publishError) {
              console.warn('⚠️ Thất bại khi publish đến record-service:', publishError.message);
            }
          } else {
            console.warn(`⚠️⚠️⚠️ Không tìm thấy lịch hẹn ${appointmentId}`);
          }
        } catch (error) {
          console.error('❌❌❌ Lỗi khi cập nhật trạng thái lịch hẹn thành in-progress:', error.message);
          console.error('❌ Error stack:', error.stack);
          // Không throw - record đã được cập nhật
        }
      }

      // 🆕 Xử lý event record.completed
      if (message.event === 'record.completed') {
        const { appointmentId, recordId, recordCode, completedAt } = message.data;

        console.log('🔄 [Appointment Consumer] Đang xử lý record.completed:', {
          appointmentId,
          recordId,
          recordCode,
          completedAt
        });

        if (!appointmentId) {
          console.warn('⚠️ [Appointment Consumer] Không có appointmentId, bỏ qua...');
          return;
        }

        try {
          // Cập nhật trạng thái lịch hẹn thành completed
          const appointment = await appointmentRepository.findById(appointmentId);
          if (appointment) {
            console.log(`📝 [Appointment Consumer] Dữ liệu lịch hẹn cho completed:`, {
              roomId: appointment.roomId,
              appointmentDate: appointment.appointmentDate,
              queueNumber: appointment.queueNumber
            });
            
            await appointmentRepository.updateStatus(appointmentId, 'completed');
            console.log(`✅ Đã cập nhật lịch hẹn ${appointmentId} thành completed`);
            
            // 🔥 PUBLISH ĐẾN RECORD SERVICE: Để record-service emit socket
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
                console.log('📡 [Appointment Consumer] Đã publish trạng thái completed đến record-service');
              }
            } catch (publishError) {
              console.warn('⚠️ Thất bại khi publish đến record-service:', publishError.message);
            }
          } else {
            console.warn(`⚠️ Không tìm thấy lịch hẹn ${appointmentId}`);
          }
        } catch (error) {
          console.error('❌ Lỗi khi cập nhật trạng thái lịch hẹn thành completed:', error.message);
          // Không throw - record đã được cập nhật
        }
      }
      
      // ✅ Acknowledge message sau khi xử lý
      channel.ack(msg);
      
    } catch (error) {
      console.error('❌ [Consumer] Lỗi khi xử lý message:', error);
      channel.nack(msg, false, false); // Không requeue
    }
    });

    console.log('👂 [Appointment Consumer] Đang lắng nghe appointment_queue...');
  } catch (error) {
    console.error('❌ [Appointment Consumer] Thất bại khi khởi động consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };


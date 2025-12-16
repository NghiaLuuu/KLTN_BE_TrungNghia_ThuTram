const { consumeQueue } = require('./rabbitmq.client');
const appointmentService = require('../services/appointment.service');
const Appointment = require('../models/appointment.model');
const { getIO } = require('../utils/socket');
const { 
  handlePaymentCompleted, 
  handlePaymentFailed, 
  handlePaymentTimeout 
} = require('./paymentEventHandlers');

/**
 * Xác định kênh đặt lịch từ role người đặt
 * @param {string} bookedByRole - Role của người đặt (patient/dentist/receptionist)
 * @returns {string} Kênh đặt lịch (online/offline)
 */
const resolveBookingChannel = (bookedByRole) => (
  bookedByRole === 'patient' ? 'online' : 'offline'
);

/**
 * Thiết lập các event listener cho Appointment Service
 * Lắng nghe các sự kiện từ payment-service, record-service
 */
async function setupEventListeners() {
  try {
    // Lắng nghe các sự kiện thanh toán
    await consumeQueue('payment.completed', async (message) => {
      await handlePaymentCompleted(message.data);
    });
    
    await consumeQueue('payment.failed', async (message) => {
      await handlePaymentFailed(message.data);
    });
    
    await consumeQueue('payment.timeout', async (message) => {
      await handlePaymentTimeout(message.data);
    });
    
    // 🔥 Lắng nghe các sự kiện từ record-service
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
          // Đã được xử lý nội bộ
          break;
          
        default:
          console.warn(`⚠️ Sự kiện không xác định trong appointment_queue: ${event}`);
      }
    });
    
    // Legacy: Lắng nghe sự kiện payment_success để tương thích ngược
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
          console.warn(`⚠️ Sự kiện không xác định: ${event}`);
      }
    });
    
    console.log('✅ Thiết lập event listeners cho Appointment Service hoàn tất');
    
  } catch (error) {
    console.error('❌ Thiết lập event listeners thất bại:', error);
    throw error;
  }
}

/**
 * Xử lý sự kiện payment_success
 * Tạo lịch hẹn thật từ reservation
 */
async function handlePaymentSuccess(data) {
  try {
    console.log('🎉 Thanh toán thành công - Tạo lịch hẹn:', data.reservationId);
    
    const appointment = await appointmentService.createAppointmentFromPayment(data);
    
    console.log(`✅ Lịch hẹn đã tạo: ${appointment.appointmentCode}`);
    
  } catch (error) {
    console.error('❌ Lỗi xử lý thanh toán thành công:', error);
    // Không throw - để RabbitMQ ACK message tránh retry vô hạn
  }
}

/**
 * Xử lý sự kiện payment_expired
 * Dọn dẹp reservation và giải phóng slots
 */
async function handlePaymentExpired(data) {
  try {
    console.log('⏰ Thanh toán hết hạn - Dọn dẹp reservation:', data.reservationId);
    
    const redisClient = require('./redis.client');
    
    // Lấy thông tin reservation
    const reservationStr = await redisClient.get(`temp_reservation:${data.reservationId}`);
    if (reservationStr) {
      const reservation = JSON.parse(reservationStr);
      
      // Xóa reservation
      await redisClient.del(`temp_reservation:${data.reservationId}`);
      
      // Xóa khóa slot
      for (const slotId of reservation.slotIds) {
        await redisClient.del(`temp_slot_lock:${slotId}`);
      }
      
      console.log(`✅ Reservation đã được dọn dẹp: ${data.reservationId}`);
    }
    
  } catch (error) {
    console.error('❌ Lỗi xử lý thanh toán hết hạn:', error);
  }
}

/**
 * Xử lý sự kiện record.in-progress
 * Cập nhật trạng thái lịch hẹn thành 'in-progress'
 */
async function handleRecordInProgress(data) {
  try {
    console.log('🔄 Bệnh án đang xử lý - Cập nhật lịch hẹn:', data.appointmentId);
    
    if (!data.appointmentId) {
      console.warn('⚠️ Không có appointmentId trong sự kiện record.in-progress');
      return;
    }
    
    const appointment = await Appointment.findById(data.appointmentId);
    if (!appointment) {
      console.warn(`⚠️ Không tìm thấy lịch hẹn: ${data.appointmentId}`);
      return;
    }
    
    // Cập nhật trạng thái lịch hẹn thành in-progress
    if (appointment.status !== 'in-progress') {
      appointment.status = 'in-progress';
      appointment.startedAt = data.startedAt || new Date();
      await appointment.save();
      console.log(`✅ Lịch hẹn ${appointment.appointmentCode} đã cập nhật trạng thái thành in-progress`);

      // Thông báo cho các client về cập nhật hàng đợi
      try {
        const io = getIO();
        if (io) {
          io.emit('queue_updated', {
            roomId: appointment.roomId?.toString(),
            timestamp: new Date()
          });
        }
      } catch (emitError) {
        console.warn('⚠️ Không thể emit cập nhật hàng đợi sau khi bắt đầu bệnh án:', emitError.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Lỗi xử lý record.in-progress:', error);
  }
}

/**
 * Xử lý sự kiện record.completed
 * Cập nhật trạng thái lịch hẹn thành 'completed' và tạo hóa đơn
 */
async function handleRecordCompleted(data) {
  try {
    console.log('='.repeat(100));
    console.log('🔥🔥🔥 [Appointment Service] Nhận sự kiện record.completed');
    console.log('📋 Dữ liệu sự kiện đầy đủ:', JSON.stringify({
      recordId: data.recordId,
      recordCode: data.recordCode,
      appointmentId: data.appointmentId,
      patientId: data.patientId,
      totalCost: data.totalCost,
      bookingChannel: data.bookingChannel,
      type: data.type,
      additionalServicesCount: data.additionalServices?.length || 0
    }, null, 2));
    console.log('='.repeat(100));
    
    if (!data.appointmentId) {
      console.warn('⚠️⚠️⚠️ Không có appointmentId trong sự kiện record.completed - không thể cập nhật lịch hẹn!');
      console.warn('⚠️ Điều này có nghĩa bệnh án được tạo mà không có lịch hẹn (bệnh nhân walk-in)');
      return;
    }
    
    console.log(`🔍 [Appointment Service] Đang tìm kiếm lịch hẹn: ${data.appointmentId}`);
    const appointment = await Appointment.findById(data.appointmentId);
    if (!appointment) {
      console.warn(`❌❌❌ Không tìm thấy lịch hẹn: ${data.appointmentId}`);
      return;
    }
    
    console.log(`✅ [Appointment Service] Tìm thấy lịch hẹn: ${appointment.appointmentCode}`);
    console.log(`📊 Trạng thái hiện tại: ${appointment.status}`);
    console.log(`🏥 Phòng: ${appointment.roomName || appointment.roomId}`);
    
    // Cập nhật trạng thái lịch hẹn thành completed
    if (appointment.status !== 'completed') {
      const oldStatus = appointment.status;
      appointment.status = 'completed';
      appointment.completedAt = data.completedAt || new Date();
      await appointment.save();
      console.log(`✅✅✅ Lịch hẹn ${appointment.appointmentCode} trạng thái: ${oldStatus} → completed`);

      // Thông báo cho các client để làm mới thông tin phòng
      try {
        const io = getIO();
        if (io) {
          const eventData = {
            roomId: appointment.roomId?.toString(),
            timestamp: new Date()
          };
          io.emit('queue_updated', eventData);
          console.log('📡 [Socket.IO] Đã emit sự kiện queue_updated:', eventData);
          console.log('🔔 Frontend Queue Dashboard sẽ làm mới ngay!');
        } else {
          console.warn('⚠️ Socket.IO chưa khởi tạo - không thể emit sự kiện queue_updated');
        }
      } catch (emitError) {
        console.error('❌ Emit cập nhật hàng đợi sau hoàn thành bệnh án thất bại:', emitError.message);
      }
    } else {
      console.log(`⚠️ Lịch hẹn ${appointment.appointmentCode} đã completed, bỏ qua cập nhật trạng thái`);
    }
    
    // 🔥 Tạo yêu cầu hóa đơn
    try {
      const { publishToQueue } = require('./rabbitmq.client');
      const serviceClient = require('./serviceClient');
      
      // Tính toán số tiền dịch vụ
      let services = [];
      let totalAmount = 0;
      
      // 1. Thêm serviceAddOn chính (dịch vụ phụ được chọn khi đặt lịch)
      // Lưu ý: Service chính (khám/điều trị) KHÔNG có giá, chỉ ServiceAddOn mới có giá
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
        console.log(`📋 ServiceAddOn chính: ${appointment.serviceAddOnName} - ${mainServiceAddOnPrice} VND`);
      } else {
        // Trường hợp không có serviceAddOn (có thể xảy ra với lịch offline)
        console.warn('⚠️ Không tìm thấy serviceAddOn trong lịch hẹn - có thể có vấn đề');
      }
      
      // 2. Thêm các chỉ định điều trị (các serviceAddOn được thêm trong quá trình điều trị)
      if (data.treatmentIndications && data.treatmentIndications.length > 0) {
        for (const indication of data.treatmentIndications) {
          if (indication.used) {
            // ✅ Lấy giá từ service-service API
            let indicationPrice = 0;
            
            if (indication.serviceAddOnId) {
              try {
                const addOnData = await serviceClient.getServiceAddOnPrice(
                  indication.serviceId,
                  indication.serviceAddOnId
                );
                
                if (addOnData && addOnData.price !== undefined) {
                  indicationPrice = addOnData.price;
                  console.log(`✅ Đã lấy giá cho ${indication.serviceAddOnName}: ${indicationPrice} VND`);
                } else {
                  console.warn(`⚠️ Không tìm thấy giá cho ServiceAddOn: ${indication.serviceAddOnName}`);
                }
              } catch (fetchError) {
                console.error(`❌ Lấy giá cho ${indication.serviceAddOnName} thất bại:`, fetchError.message);
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
            console.log(`📋 Chỉ định điều trị: ${indication.serviceAddOnName || indication.serviceName} - ${indicationPrice} VND`);
          }
        }
      }
      
      // 3. Kiểm tra nếu lịch hẹn online (có đặt cọc)
      let depositPaid = 0;
      let originalPaymentId = null;
      
      const bookingChannel = resolveBookingChannel(appointment.bookedByRole);

      if (bookingChannel === 'online' && appointment.paymentId) {
        // Bệnh nhân đã đặt cọc - cần lấy chi tiết thanh toán
        originalPaymentId = appointment.paymentId;
        
        // TODO: Query payment-service để lấy số tiền đặt cọc chính xác
        // Tạm thời tính từ số slot
        const slotCount = appointment.slotIds ? appointment.slotIds.length : 1;
        const depositPerSlot = 100000; // Mặc định từ schedule config
        depositPaid = depositPerSlot * slotCount;
        
        console.log(`💰 Đặt lịch online - Đặt cọc đã trả: ${depositPaid} VND (${slotCount} slots)`);
      }
      
      // 4. Tính số tiền cuối cùng (tổng dịch vụ - đặt cọc)
      const finalAmount = Math.max(0, totalAmount - depositPaid);
      
      console.log(`💵 Tính toán thanh toán:
        - Tổng dịch vụ: ${totalAmount} VND
        - Đặt cọc đã trả: ${depositPaid} VND
        - Số tiền cuối: ${finalAmount} VND
      `);
      
      // 5. Publish sự kiện invoice.create đến invoice-service
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
      console.log(`✅ Đã publish sự kiện invoice.create_from_record cho bệnh án ${data.recordCode}`);
      
    } catch (paymentError) {
      console.error('❌ Tạo hóa đơn thất bại:', paymentError);
      // Không throw - hoàn thành lịch hẹn đã thành công
    }
    
  } catch (error) {
    console.error('❌ Lỗi xử lý record.completed:', error);
  }
}

module.exports = { setupEventListeners };

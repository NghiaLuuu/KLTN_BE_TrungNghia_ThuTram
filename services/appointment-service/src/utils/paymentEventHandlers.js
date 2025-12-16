/**
 * @author: TrungNghia
 * Payment Event Handlers cho Appointment Service
 * Lắng nghe các sự kiện payment.completed và payment.failed
 */

const appointmentService = require('../services/appointment.service');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Xử lý sự kiện payment.completed
 * Tạo lịch hẹn thật từ reservation
 * @param {Object} data - Dữ liệu thanh toán
 */
async function handlePaymentCompleted(data) {
  try {
    console.log('💰 Đang xử lý sự kiện payment.completed:', data);
    
    const { 
      reservationId, 
      paymentId, 
      transactionId,
      amount,
      paymentMethod 
    } = data;
    
    if (!reservationId) {
      console.error('❌ Thiếu reservationId trong sự kiện payment.completed');
      return;
    }
    
    // Tạo lịch hẹn từ reservation
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
    
    console.log('✅ Đã tạo lịch hẹn từ thanh toán:', appointment.appointmentCode);
    
    // Publish sự kiện appointment.created đến schedule-service
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
    
    console.log('📤 Đã publish đến schedule_queue: appointment.created');
    
    // Publish sự kiện appointment.created đến invoice-service
    await publishToQueue('invoice_queue', {
      event: 'appointment.created',
      timestamp: new Date(),
      data: {
        appointmentId: appointment._id,
        paymentId: appointment.paymentId
      }
    });
    
    console.log('📤 Đã publish đến invoice_queue: appointment.created');
    
    // 🆕 Publish sự kiện đến record-service để đánh dấu chỉ định điều trị đã được sử dụng
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
        console.log('✅ Đã publish sự kiện appointment.service_booked đến record-service');
      } catch (eventError) {
        console.error('⚠️ Publish đến record-service thất bại:', eventError.message);
        // Không throw - lịch hẹn đã được tạo
      }
    }
    
  } catch (error) {
    console.error('❌ Lỗi xử lý payment.completed:', error);
    
    // Publish sự kiện lỗi để monitoring
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
 * Xử lý sự kiện payment.failed
 * Mở khóa slots và dọn dẹp reservation
 * @param {Object} data - Dữ liệu thanh toán thất bại
 */
async function handlePaymentFailed(data) {
  try {
    console.log('💳 Đang xử lý sự kiện payment.failed:', data);
    
    const { reservationId, reason } = data;
    
    if (!reservationId) {
      console.error('❌ Thiếu reservationId trong sự kiện payment.failed');
      return;
    }
    
    // Hủy reservation và mở khóa slots
    await appointmentService.cancelReservation(reservationId, reason || 'Thanh toán thất bại');
    
    console.log('✅ Đã hủy reservation do thanh toán thất bại:', reservationId);
    
  } catch (error) {
    console.error('❌ Lỗi xử lý payment.failed:', error);
  }
}

/**
 * Xử lý sự kiện payment.timeout
 * Tự động hủy reservation sau 15 phút
 * @param {Object} data - Dữ liệu timeout
 */
async function handlePaymentTimeout(data) {
  try {
    console.log('⏰ Đang xử lý sự kiện payment.timeout:', data);
    
    const { reservationId } = data;
    
    if (!reservationId) {
      console.error('❌ Thiếu reservationId trong sự kiện payment.timeout');
      return;
    }
    
    // Hủy reservation và mở khóa slots
    await appointmentService.cancelReservation(reservationId, 'Thanh toán hết thời gian');
    
    console.log('✅ Đã hủy reservation do hết thời gian:', reservationId);
    
  } catch (error) {
    console.error('❌ Lỗi xử lý payment.timeout:', error);
  }
}

module.exports = {
  handlePaymentCompleted,
  handlePaymentFailed,
  handlePaymentTimeout
};

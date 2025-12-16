const { getChannel } = require('./rabbitmq.client');
const appointmentRepo = require('../repositories/appointment.repository');

const RPC_QUEUE = 'appointment-service_rpc_queue';

/**
 * Khởi động RPC Server cho Appointment Service
 * Xử lý các RPC request từ các service khác
 */
async function startRpcServer() {
  try {
    const channel = getChannel();
    if (!channel) {
      throw new Error('RabbitMQ channel không khả dụng');
    }

    // Làm mới queue trước khi assert
    try {
      await channel.deleteQueue(RPC_QUEUE);
      console.log(`♻️ Làm mới RabbitMQ queue ${RPC_QUEUE} trước khi assert`);
    } catch (err) {
      if (err?.code !== 404) {
        console.warn(`⚠️ Không thể xóa queue ${RPC_QUEUE}:`, err.message);
      }
    }

    await channel.assertQueue(RPC_QUEUE, { durable: true });
    await channel.prefetch(1);

    console.log(`✅ Appointment RPC Server đang lắng nghe: ${RPC_QUEUE}`);

    channel.consume(RPC_QUEUE, async (msg) => {
      if (!msg) return;

      const startTime = Date.now();
      let response = { success: false };

      try {
        const request = JSON.parse(msg.content.toString());
        const { method, params } = request;

        console.log(`🔍 [RPC Server] Nhận ${method}:`, params);

        switch (method) {
          case 'getAppointment':
          case 'getAppointmentById':
            if (!params.id) {
              response = { success: false, error: 'Thiếu ID lịch hẹn' };
              break;
            }
            const appointment = await appointmentRepo.findById(params.id);
            if (!appointment) {
              response = { success: false, error: 'Không tìm thấy lịch hẹn' };
            } else {
              response = { 
                success: true, 
                data: appointment.toObject ? appointment.toObject() : appointment 
              };
            }
            break;

          case 'getAppointmentByCode':
            if (!params.code) {
              response = { success: false, error: 'Thiếu mã lịch hẹn' };
              break;
            }
            const appointmentByCode = await appointmentRepo.findByCode(params.code);
            if (!appointmentByCode) {
              response = { success: false, error: 'Không tìm thấy lịch hẹn' };
            } else {
              response = { 
                success: true, 
                data: appointmentByCode.toObject ? appointmentByCode.toObject() : appointmentByCode 
              };
            }
            break;

          case 'updateInvoiceId':
            if (!params.appointmentId || !params.invoiceId) {
              response = { success: false, error: 'Thiếu appointmentId hoặc invoiceId' };
              break;
            }
            const updated = await appointmentRepo.updateInvoiceId(params.appointmentId, params.invoiceId);
            response = { success: true, data: updated };
            break;

          case 'updateStatus':
            if (!params.id || !params.status) {
              response = { success: false, error: 'Thiếu id hoặc status' };
              break;
            }
            const statusUpdated = await appointmentRepo.updateStatus(
              params.id, 
              params.status, 
              params.additionalData || {}
            );
            response = { success: true, data: statusUpdated };
            break;

          default:
            response = { success: false, error: `Method không xác định: ${method}` };
        }

        const duration = Date.now() - startTime;
        console.log(`✅ [RPC Server] ${method} hoàn thành trong ${duration}ms:`, 
          response.success ? 'Thành công' : response.error);

      } catch (error) {
        console.error('❌ [RPC Server] Lỗi:', error);
        response = { 
          success: false, 
          error: error.message || 'Lỗi server nội bộ' 
        };
      }

      // Gửi response
      channel.sendToQueue(
        msg.properties.replyTo,
        Buffer.from(JSON.stringify(response)),
        { correlationId: msg.properties.correlationId }
      );

      channel.ack(msg);
    });

    console.log('✅ Appointment RPC Server khởi động thành công');
  } catch (error) {
    console.error('❌ Khởi động Appointment RPC Server thất bại:', error);
    throw error;
  }
}

module.exports = startRpcServer;

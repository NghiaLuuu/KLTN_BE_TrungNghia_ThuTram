const { getChannel } = require('../utils/rabbitmq.client');
const appointmentService = require('../services/appointment.service');

/**
 * Thiết lập RPC listener cho Appointment Service
 * Lắng nghe các request từ payment-service
 */
async function setupAppointmentRPC() {
  const ch = getChannel();
  const queueName = 'appointment_queue';

  try {
    await ch.deleteQueue(queueName);
    console.log(`♻️ Làm mới RabbitMQ queue ${queueName} trước khi assert`);
  } catch (err) {
    if (err?.code !== 404) {
      console.warn(`⚠️ Không thể xóa queue ${queueName} khi làm mới:`, err.message || err);
    }
  }

  await ch.assertQueue(queueName, { durable: true });
  console.log(`📥 [Appointment Service] Đang lắng nghe RPC trên: ${queueName}`);

  ch.consume(queueName, async (msg) => {
    if (!msg) return;
    let response;

    try {
      const req = JSON.parse(msg.content.toString());
      switch (req.action) {
        case 'confirmAppointmentWithPayment':
          response = await appointmentService.confirm(req.payload);
          break;
        default:
          response = { error: `Action không xác định: ${req.action}` };
      }
    } catch (err) {
      console.error('❌ Lỗi Appointment RPC:', err);
      response = { error: err.message };
    }

    // Gửi lại kết quả cho payment-service
    ch.sendToQueue(
      msg.properties.replyTo,
      Buffer.from(JSON.stringify(response)),
      { correlationId: msg.properties.correlationId }
    );

    ch.ack(msg);
  });
}

module.exports = setupAppointmentRPC;

const { getChannel } = require('../utils/rabbitmq.client');
const appointmentService = require('../services/appointment.service');

async function setupAppointmentRPC() {
  const ch = getChannel();
  const queueName = 'appointment_queue';

  await ch.assertQueue(queueName, { durable: false });
  console.log(`📥 [Appointment Service] Listening RPC on: ${queueName}`);

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
          response = { error: `Unknown action: ${req.action}` };
      }
    } catch (err) {
      console.error('❌ Appointment RPC error:', err);
      response = { error: err.message };
    }

    // gửi lại kết quả cho payment-service
    ch.sendToQueue(
      msg.properties.replyTo,
      Buffer.from(JSON.stringify(response)),
      { correlationId: msg.properties.correlationId }
    );

    ch.ack(msg);
  });
}

module.exports = setupAppointmentRPC;

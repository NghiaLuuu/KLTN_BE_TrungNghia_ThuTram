// rpcServer.js (Payment Service)
const amqp = require('amqplib');
const paymentService = require('../services/payment.service'); // dùng service thay vì repo

async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'payment_rpc_queue'; // ✅ CHANGED: Use separate queue for RPC

  // ❌ REMOVED: Don't delete queue - causes message loss!
  // Messages sent before consumer starts will be lost
  
  await channel.assertQueue(queue, { durable: true });

  console.log(`✅ RPC server ready on: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const { action, payload } = JSON.parse(msg.content.toString());

      switch (action) {
        case 'createTemporaryPayment':
          try {
            response = await paymentService.createTemporaryPayment(payload);
          } catch (err) {
            console.error('Failed to createTemporaryPayment:', err);
            response = { error: err.message };
          }
          break;

        case 'confirmPayment':
          try {
            response = await paymentService.confirmPaymentRPC(payload);
          } catch (err) {
            console.error('Failed to confirmPayment:', err);
            response = { error: err.message };
          }
          break;

        case 'getPaymentById':
          try {
            if (!payload.id) {
              response = { error: 'paymentId is required' };
              break;
            }
            response = await paymentService.getPaymentByIdRPC(payload);
          } catch (err) {
            console.error('Failed to getPaymentById:', err);
            response = { error: err.message };
          }
          break;
          case 'createPayment':
            try {
              response = await paymentService.createPaymentStaff(payload);
            } catch (err) {
              console.error('Failed to createPayment:', err);
              response = { error: err.message };
            }
            break;
          case 'updateAppointmentCode':
            try {
              console.log('✅ RPC received updateAppointmentCode payload:', payload); // 🔹 Thêm log debug

              const { paymentId, appointmentCode } = payload; 
              if (!paymentId || !appointmentCode) {
                response = { error: 'paymentId và appointmentCode là bắt buộc' };
                break;
              }

              response = await paymentService.updateAppointmentCode(paymentId, appointmentCode);
              console.log('✅ AppointmentCode updated successfully for paymentId:', paymentId);

            } catch (err) {
              console.error('Failed to updateAppointmentCode:', err);
              response = { error: err.message };
            }
            break;


        default:
          response = { error: `Unknown action: ${action}` };
      }

    } catch (err) {
      console.error('RPC server error:', err);
      response = { error: err.message };
    }

    // Gửi trả an toàn
    try {
      if (msg.properties.replyTo) {
        const payloadToSend = response
          ? JSON.stringify(response)
          : JSON.stringify({ error: 'No response' });

        channel.sendToQueue(
          msg.properties.replyTo,
          Buffer.from(payloadToSend),
          { correlationId: msg.properties.correlationId }
        );
      } else {
        console.warn('RPC message has no replyTo, cannot send response');
      }
    } catch (err) {
      console.error('Failed to send RPC response:', err);
    }

    channel.ack(msg);
  });
}

module.exports = startRpcServer;

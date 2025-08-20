// rpcServer.js (Payment Service)
const amqp = require('amqplib');
const paymentService = require('../services/payment.service'); // dùng service thay vì repo

async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'payment_queue';
  await channel.assertQueue(queue, { durable: false });

  console.log(`✅ Payment RPC server listening on queue: ${queue}`);

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

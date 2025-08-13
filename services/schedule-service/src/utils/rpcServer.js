// rpcServer.js
const amqp = require('amqplib');
const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');

async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'schedule_queue';
  await channel.assertQueue(queue, { durable: false });

  console.log(`✅ Schedule RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const content = msg.content.toString();
      const { action, payload } = JSON.parse(content);

      switch (action) {
        case 'getSlotById':
          const slot = await slotRepo.getSlotById(payload.slotId);
          response = slot || null;
          break;

        case 'booked':
          const updated = await slotRepo.updateSlotStatus(payload.slotId, 'booked');
          response = updated;
          break;

        case 'releaseSlot':
          const released = await slotRepo.updateSlotStatus(payload.slotId, 'available');
          response = released;
          break;

        case 'getScheduleById':
          const schedule = await scheduleRepo.getScheduleById(payload.scheduleId);
          response = schedule || null;
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
        const payloadToSend = response ? JSON.stringify(response) : JSON.stringify({ error: 'No response' });
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

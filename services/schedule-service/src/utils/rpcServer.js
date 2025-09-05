// rpcServer.js
const amqp = require('amqplib');
const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const scheduleService = require('../services/schedule.service')

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
        // 👉 Event subRoomAdded
        case 'subRoomAdded':
          try {
            console.log(
              `📩 Nhận sự kiện subRoomAdded cho room ${payload.roomId}, subRooms: ${payload.subRoomIds.join(', ')}`
            );

            const schedules = await scheduleRepo.findByRoomId(payload.roomId);

            for (const schedule of schedules) {
              for (const subRoomId of payload.subRoomIds) {
                await scheduleService.createSlotsForSubRoom(schedule._id, subRoomId);
              }
            }
          } catch (err) {
            console.error('Failed to handle subRoomAdded:', err);
          }
          break;

        case 'getSlotById':
          try {
            const slot = await slotRepo.getSlotById(payload.slotId);
            response = slot || null;
          } catch (err) {
            console.error('Failed to getSlotById:', err);
            response = { error: err.message };
          }
          break;

        case 'confirmed':
          try {
            const updated = await slotRepo.updateSlotStatus(payload.slotId, 'confirmed');
            response = updated;
          } catch (err) {
            console.error('Failed to update slot status to confirmed:', err);
            response = { error: err.message };
          }
          break;

        case 'releaseSlot':
          try {
            const released = await slotRepo.updateSlotStatus(payload.slotId, 'available');
            response = released;
          } catch (err) {
            console.error('Failed to release slot:', err);
            response = { error: err.message };
          }
          break;

        case 'reserved':
          try {
            const released = await slotRepo.updateSlotStatus(payload.slotId, 'reserved');
            response = released;
          } catch (err) {
            console.error('Failed to reserved slot:', err);
            response = { error: err.message };
          }
          break;

        case 'getScheduleById':
          try {
            const schedule = await scheduleRepo.getScheduleById(payload.scheduleId);
            response = schedule || null;
          } catch (err) {
            console.error('Failed to getScheduleById:', err);
            response = { error: err.message };
          }
          break;

        case 'appointmentId':
          try {
            if (!payload.slotId || !payload.appointmentId) {
              response = { error: 'slotId and appointmentId are required' };
              break;
            }
            const updatedSlot = await slotRepo.updateAppointmentId(payload.slotId, payload.appointmentId);
            response = updatedSlot;
          } catch (err) {
            console.error('Failed to update appointmentId:', err);
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

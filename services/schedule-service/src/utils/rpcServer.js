// rpcServer.js
const amqp = require('amqplib');
const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const scheduleService = require('../services/schedule.service');
const slotService = require('../services/slot.service');
async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'schedule_queue';

  try {
    await channel.deleteQueue(queue);
    console.log(`♻️ Refreshing RabbitMQ queue ${queue} before asserting`);
  } catch (err) {
    if (err?.code !== 404) {
      console.warn(`⚠️ Could not delete queue ${queue} during refresh:`, err.message || err);
    }
  }

  await channel.assertQueue(queue, { durable: true });

  console.log(`✅ Schedule RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const content = msg.content.toString();
      const { action, payload } = JSON.parse(content);

      switch (action) {
        case 'validateSlotsForService':
          try {
            if (!payload.serviceId || !Array.isArray(payload.slotIds)) {
              response = { valid: false, reason: 'Thiếu serviceId hoặc slotIds' };
              break;
            }

            response = await slotService.validateSlotsForService({
              serviceId: payload.serviceId,
              preferredDentistId: payload.preferredDentistId,
              slotIds: payload.slotIds
            });
          } catch (err) {
            console.error('Failed to validate slots for service:', err);
            response = { valid: false, reason: err.message };
          }
          break;


        // 👉 Event subRoomAdded
        case 'subRoomAdded':
          try {
            console.log(
              `📩 Nhận sự kiện subRoomAdded cho room ${payload.roomId}, subRooms: ${payload.subRoomIds.join(', ')}`
            );

            // Sử dụng function mới để tạo lịch thông minh cho subrooms
            await scheduleService.createSchedulesForNewSubRooms(payload.roomId, payload.subRoomIds);
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
            if (!Array.isArray(payload.slotIds)) {
              response = { error: 'slotIds phải là mảng' };
              break;
            }
            const updated = await slotRepo.updateSlotsStatus(payload.slotIds, 'confirmed');
            response = updated;
          } catch (err) {
            console.error('Failed to update slots to confirmed:', err);
            response = { error: err.message };
          }
          break;

        case 'releaseSlot':
          try {
            if (!Array.isArray(payload.slotIds)) {
              response = { error: 'slotIds phải là mảng' };
              break;
            }
            const released = await slotRepo.updateSlotsStatus(payload.slotIds, 'available');
            response = released;
          } catch (err) {
            console.error('Failed to release slots:', err);
            response = { error: err.message };
          }
          break;

        case 'reserved':
          try {
            if (!Array.isArray(payload.slotIds)) {
              response = { error: 'slotIds phải là mảng' };
              break;
            }
            const reserved = await slotRepo.updateSlotsStatus(payload.slotIds, 'reserved');
            response = reserved;
          } catch (err) {
            console.error('Failed to reserve slots:', err);
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

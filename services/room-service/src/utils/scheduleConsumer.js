// utils/scheduleConsumer.js
const amqp = require('amqplib');
const roomService = require('../services/room.service');

let channel;
let connection;

async function connectRabbit() {
  if (!connection) {
    connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    channel = await connection.createChannel();
    console.log('✅ RabbitMQ connected for schedule consumer');
  }
  return channel;
}

async function startScheduleConsumer() {
  try {
    const ch = await connectRabbit();
    const roomScheduleQueue = 'room.schedule.updated';
    const subroomScheduleQueue = 'subroom.schedule.created';
    
    // Consumer 1: Room schedule updates
    await ch.assertQueue(roomScheduleQueue, { durable: true });
    
    console.log(`📡 Listening for messages on queue: ${roomScheduleQueue}`);
    
    ch.consume(roomScheduleQueue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          console.log('📥 Received schedule update:', data);
          
          const { roomId, lastScheduleGenerated, hasBeenUsed } = data;
          
          // Update room schedule info
          await roomService.updateRoomScheduleInfo(roomId, {
            lastScheduleGenerated,
            hasBeenUsed
          });
          
          console.log(`✅ Updated room ${roomId} schedule info`);
          
          ch.ack(msg);
        } catch (error) {
          console.error('❌ Error processing schedule update message:', error);
          ch.nack(msg, false, false); // Don't requeue failed messages
        }
      }
    }, { noAck: false });
    
    // Consumer 2: Subroom schedule creation (update hasBeenUsed)
    await ch.assertQueue(subroomScheduleQueue, { durable: true });
    
    console.log(`📡 Listening for messages on queue: ${subroomScheduleQueue}`);
    
    ch.consume(subroomScheduleQueue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          console.log('📥 Received subroom schedule created event:', data);
          
          const { roomId, subRoomIds } = data;
          
          if (!roomId || !subRoomIds || !Array.isArray(subRoomIds)) {
            console.error('❌ Invalid subroom event data:', data);
            ch.nack(msg, false, false);
            return;
          }
          
          // Update hasBeenUsed for all subrooms
          for (const subRoomId of subRoomIds) {
            await roomService.markSubRoomAsUsed(roomId, subRoomId);
            console.log(`✅ Marked subRoom ${subRoomId} as used`);
          }
          
          ch.ack(msg);
        } catch (error) {
          console.error('❌ Error processing subroom schedule created message:', error);
          ch.nack(msg, false, false);
        }
      }
    }, { noAck: false });
    
  } catch (error) {
    console.error('❌ Failed to start schedule consumer:', error);
    throw error;
  }
}

module.exports = { startScheduleConsumer };

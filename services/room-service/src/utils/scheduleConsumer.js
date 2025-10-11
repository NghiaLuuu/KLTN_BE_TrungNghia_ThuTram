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
    const queue = 'room.schedule.updated';
    
    await ch.assertQueue(queue, { durable: true });
    
    console.log(`📡 Listening for messages on queue: ${queue}`);
    
    ch.consume(queue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          console.log('📥 Received schedule update:', data);
          
          const { roomId, hasSchedule, scheduleStartDate, scheduleEndDate, lastScheduleGenerated, hasBeenUsed } = data;
          
          // Update room schedule info
          await roomService.updateRoomScheduleInfo(roomId, {
            hasSchedule,
            scheduleStartDate,
            scheduleEndDate,
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
    
  } catch (error) {
    console.error('❌ Failed to start schedule consumer:', error);
    throw error;
  }
}

module.exports = { startScheduleConsumer };

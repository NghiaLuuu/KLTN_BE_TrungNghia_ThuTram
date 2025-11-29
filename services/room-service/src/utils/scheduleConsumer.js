// utils/scheduleConsumer.js
const amqp = require('amqplib');
const roomService = require('../services/room.service');
const redisClient = require('./redis.client');

let channel;
let connection;

async function connectRabbit(retries = 10, delay = 2000) {
  if (!connection) {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`🔄 Attempting RabbitMQ connection (${i + 1}/${retries})...`);
        connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
        channel = await connection.createChannel();
        console.log('✅ RabbitMQ connected for schedule consumer');
        
        // Handle connection errors
        connection.on('error', (err) => {
          console.error('❌ RabbitMQ connection error:', err.message);
          connection = null;
          channel = null;
        });
        
        connection.on('close', () => {
          console.log('⚠️ RabbitMQ connection closed, will reconnect on next use');
          connection = null;
          channel = null;
        });
        
        return channel;
      } catch (error) {
        console.error(`❌ RabbitMQ connection attempt ${i + 1} failed:`, error.message);
        
        if (i < retries - 1) {
          const waitTime = delay * Math.pow(2, i); // Exponential backoff
          console.log(`⏳ Retrying in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw new Error(`Failed to connect to RabbitMQ after ${retries} attempts`);
        }
      }
    }
  }
  return channel;
}

async function startScheduleConsumer() {
  try {
    const ch = await connectRabbit();
    const roomScheduleQueue = 'room.schedule.updated';
    const subroomScheduleQueue = 'subroom.schedule.created';
    const cacheInvalidationQueue = 'room_cache_invalidation'; // 🆕 Cache invalidation queue
    
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
    
    // 🆕 Consumer 3: Room calendar cache invalidation
    await ch.assertQueue(cacheInvalidationQueue, { durable: true });
    
    console.log(`📡 Listening for cache invalidation messages on queue: ${cacheInvalidationQueue}`);
    
    ch.consume(cacheInvalidationQueue, async (msg) => {
      if (msg) {
        try {
          const data = JSON.parse(msg.content.toString());
          console.log('📥 Received cache invalidation message:', data);
          
          const { roomId, action, reason } = data;
          
          if (action !== 'invalidateRoomCache' || !roomId) {
            console.error('❌ Invalid cache invalidation data:', data);
            ch.nack(msg, false, false);
            return;
          }
          
          // Clear calendar cache for the specific room
          const pattern = `room_calendar:${roomId}:*`;
          console.log(`🔍 [Cache Invalidation] Searching for keys: ${pattern}`);
          
          const keys = await redisClient.keys(pattern);
          console.log(`🔍 [Cache Invalidation] Found ${keys.length} calendar cache keys`);
          
          if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`🗑️ [Cache Invalidation] Cleared ${keys.length} calendar cache keys for room ${roomId} (reason: ${reason})`);
          } else {
            console.log(`ℹ️ [Cache Invalidation] No calendar cache found for room ${roomId}`);
          }
          
          ch.ack(msg);
        } catch (error) {
          console.error('❌ Error processing cache invalidation message:', error);
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

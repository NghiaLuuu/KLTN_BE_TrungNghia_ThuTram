// rpcServer.js
const amqp = require('amqplib');
const roomRepo = require('../repositories/room.repository'); // repo để lấy room từ DB

async function startRpcServer(retries = 10, delay = 2000) {
  let connection;
  
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔄 Attempting RabbitMQ RPC server connection (${i + 1}/${retries})...`);
      connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      const channel = await connection.createChannel();

      const queue = 'room_queue';

      try {
        await channel.deleteQueue(queue);
        console.log(`♻️ Refreshing RabbitMQ queue ${queue} before asserting`);
      } catch (err) {
        if (err?.code !== 404) {
          console.warn(`⚠️ Could not delete queue ${queue} during refresh:`, err.message || err);
        }
      }

      await channel.assertQueue(queue, { durable: true });

      console.log(`✅ Room RPC server listening on queue: ${queue}`);
      
      // Handle connection errors
      connection.on('error', (err) => {
        console.error('❌ RabbitMQ RPC connection error:', err.message);
      });
      
      connection.on('close', () => {
        console.log('⚠️ RabbitMQ RPC connection closed');
      });

      channel.consume(queue, async (msg) => {
        if (!msg) {
          console.warn('⚠️ Room RPC received null message, consumer might be cancelled');
          return;
        }

        const { action, payload } = JSON.parse(msg.content.toString());
        let response;

        try {
          if (action === 'getRoomById') {
            const room = await roomRepo.findById(payload.roomId);
            response = { success: true, data: room };
          } else if (action === 'rebuildRoomCache') {
            // 🔄 Rebuild rooms_cache trong Redis
            const redis = require('./redis.client');
            const rooms = await roomRepo.getAllRooms();
            await redis.set('rooms_cache', JSON.stringify(rooms), { EX: 3600 }); // 1h TTL
            console.log(`✅ Đã rebuild rooms_cache: ${rooms.length} phòng`);
            response = { success: true, count: rooms.length };
          } else if (action === 'markRoomAsUsed') {
            console.log('📥 Received markRoomAsUsed payload:', JSON.stringify(payload));
            
            if (!payload || !payload.roomId) {
              throw new Error('Invalid payload: roomId is required');
            }
            
            const roomId = payload.roomId.toString();
            console.log('🔍 Processing roomId:', roomId);
            
            const updatedRoom = await roomRepo.markRoomAsUsed(roomId);
            response = { success: true, roomId: roomId, hasBeenUsed: true };
            console.log(`✅ Marked room ${roomId} as hasBeenUsed = true`);
          } else if (action === 'markSubRoomAsUsed') {
            console.log('📥 Received markSubRoomAsUsed payload:', JSON.stringify(payload));
            
            if (!payload || !payload.roomId || !payload.subRoomId) {
              throw new Error('Invalid payload: roomId and subRoomId are required');
            }
            
            const roomId = payload.roomId.toString();
            const subRoomId = payload.subRoomId.toString();
            console.log('🔍 Processing roomId:', roomId, 'subRoomId:', subRoomId);
            
            const updatedRoom = await roomRepo.markSubRoomAsUsed(roomId, subRoomId);
            response = { success: true, roomId: roomId, subRoomId: subRoomId, hasBeenUsed: true };
            console.log(`✅ Marked subRoom ${subRoomId} in room ${roomId} as hasBeenUsed = true`);
          }
          // có thể thêm các action khác sau này
        } catch (err) {
          console.error('❌ Room RPC error:', err);
          response = { error: err.message };
        }
        
        // Send response back (if replyTo is provided)
        if (msg.properties.replyTo) {
          channel.sendToQueue(
            msg.properties.replyTo,
            Buffer.from(JSON.stringify(response)),
            { correlationId: msg.properties.correlationId }
          );
        }

        channel.ack(msg);
      });
      
      return; // Success, exit retry loop
    } catch (error) {
      console.error(`❌ RabbitMQ RPC server connection attempt ${i + 1} failed:`, error.message);
      
      if (i < retries - 1) {
        const waitTime = delay * Math.pow(2, i); // Exponential backoff
        console.log(`⏳ Retrying RPC server in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw new Error(`Failed to start RabbitMQ RPC server after ${retries} attempts`);
      }
    }
  }
}

module.exports = startRpcServer;
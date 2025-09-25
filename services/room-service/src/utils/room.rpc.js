// rpcServer.js
const amqp = require('amqplib');
const roomRepo = require('../repositories/room.repository'); // repo để lấy room từ DB

async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  const channel = await connection.createChannel();

  const queue = 'room_queue';
  await channel.assertQueue(queue, { durable: false });

  console.log(`✅ Room RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    const { action, payload } = JSON.parse(msg.content.toString());
    let response;

    try {
      if (action === 'getRoomById') {
        const room = await roomRepo.findById(payload.roomId);
        response = room || null;
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
}

module.exports = startRpcServer;
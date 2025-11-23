// rpcServer.js
const amqp = require('amqplib');
const userRepo = require('../repositories/user.repository'); // repo để lấy user từ DB
const redis = require('../utils/redis.client');

async function startRpcServer() {
  console.log('🔍 Debug RabbitMQ URL:', process.env.RABBITMQ_URL);
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'auth_queue';

  // ⚠️ REMOVED deleteQueue() to avoid conflicts with multiple instances
  // Queue should be persistent, only consumers change
  await channel.assertQueue(queue, { durable: true });

  console.log(`✅ Auth RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) {
      console.warn('⚠️ Auth RPC received null message, consumer might have been cancelled');
      return;
    }

    const { action, payload } = JSON.parse(msg.content.toString());
    let response;

    try {
      if (action === 'getUserById') {
        const user = await userRepo.getUserById(payload.userId);
        response = user || null;
      } else if (action === 'getAllUsers') {
        // 🆕 Get all users from database
        console.log('📥 [Auth RPC] getAllUsers request');
        const users = await userRepo.listUsers();
        console.log(`✅ [Auth RPC] Found ${users?.length || 0} users`);
        response = { success: true, data: users || [] };
      } else if (action === 'rebuildUserCache') {
        // 🔄 Rebuild users_cache in Redis
        console.log('📥 [Auth RPC] Rebuilding users_cache...');
        const users = await userRepo.listUsers();
        await redis.set('users_cache', JSON.stringify(users), { EX: 3600 }); // 1h TTL
        console.log(`✅ [Auth RPC] Rebuilt users_cache: ${users.length} users`);
        response = { success: true, count: users.length };
      } else if (action === 'getUsersByIds') {
        // 🆕 Get multiple users by IDs
        const { userIds } = payload;
        console.log(`📥 [Auth RPC] getUsersByIds request for ${userIds?.length || 0} users:`, userIds);
        
        if (!userIds || !Array.isArray(userIds)) {
          response = { error: 'userIds must be an array' };
          console.error('❌ [Auth RPC] Invalid userIds:', userIds);
        } else {
          const users = await userRepo.findByIds(userIds);
          console.log(`✅ [Auth RPC] Found ${users?.length || 0} users`);
          response = users || [];
        }
      } else if (action === 'markUserAsUsed') {
        const updatedUser = await userRepo.markUserAsUsed(payload.userId);
        
        // 🔄 Refresh users cache to reflect the change
        try {
          const users = await userRepo.listUsers();
          await redis.set('users_cache', JSON.stringify(users), { EX: 3600 }); // 1h TTL
          console.log(`♻️ Refreshed users cache after marking user ${payload.userId} as used`);
        } catch (cacheErr) {
          console.warn('Failed to refresh users cache:', cacheErr.message);
        }
        
        response = { success: true, userId: payload.userId, hasBeenUsed: true };
        console.log(`✅ Marked user ${payload.userId} as hasBeenUsed = true`);
      }
      // có thể thêm các action khác sau này
    } catch (err) {
      console.error(err);
      response = { error: err.message };
    }
    
    channel.sendToQueue(
      msg.properties.replyTo,
      Buffer.from(JSON.stringify(response)),
      { correlationId: msg.properties.correlationId }
    );

    channel.ack(msg);
  });
}

module.exports = startRpcServer;

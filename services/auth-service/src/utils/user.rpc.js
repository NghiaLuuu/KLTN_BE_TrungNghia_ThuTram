// rpcServer.js
const amqp = require('amqplib');
const userRepo = require('../repositories/user.repository'); // repo để lấy user từ DB
const redis = require('../utils/redis.client');

async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'auth_queue';
  await channel.assertQueue(queue, { durable: false });

  console.log(`✅ Auth RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    const { action, payload } = JSON.parse(msg.content.toString());
    let response;

    try {
      if (action === 'getUserById') {
        const user = await userRepo.getUserById(payload.userId);
        response = user || null;
      } else if (action === 'markUserAsUsed') {
        const updatedUser = await userRepo.markUserAsUsed(payload.userId);
        
        // 🔄 Refresh users cache to reflect the change
        try {
          const users = await userRepo.listUsers();
          await redis.set('users_cache', JSON.stringify(users));
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

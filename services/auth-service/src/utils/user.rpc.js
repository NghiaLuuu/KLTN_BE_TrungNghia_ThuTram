// rpcServer.js
const amqp = require('amqplib');
const userRepo = require('../repositories/user.repository'); // repo để lấy user từ DB

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

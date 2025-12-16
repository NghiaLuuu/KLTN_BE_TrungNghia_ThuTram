// rpcClient.js
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

async function request(queue, message) {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const replyQueue = await channel.assertQueue('', { exclusive: true });
  const correlationId = randomUUID(); // ✅ sử dụng hàm có sẵn

  return new Promise((resolve, reject) => {
    channel.consume(
      replyQueue.queue,
      (msg) => {
        if (msg.properties.correlationId === correlationId) {
          resolve(JSON.parse(msg.content.toString()));
          setTimeout(() => {
            connection.close();
          }, 500);
        }
      },
      { noAck: true }
    );

    channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      correlationId,
      replyTo: replyQueue.queue,
    });
  });
}

module.exports = { request };

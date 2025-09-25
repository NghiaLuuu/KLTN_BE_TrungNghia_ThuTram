// utils/rabbitClient.js
const amqp = require('amqplib');

let channel;

async function connectRabbit() {
  if (!channel) {
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
    channel = await connection.createChannel();
  }
  return channel;
}

async function publishToQueue(queue, message) {
  const ch = await connectRabbit();
  await ch.assertQueue(queue, { durable: false });
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
}

module.exports = { publishToQueue };
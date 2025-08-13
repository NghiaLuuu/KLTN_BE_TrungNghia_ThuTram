const amqp = require('amqplib');
let connection = null;
let channel = null;

async function connectRabbitMQ(url) {
  if (channel) return channel; // đã kết nối
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  return channel;
}

function getChannel() {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}

module.exports = { connectRabbitMQ, getChannel };

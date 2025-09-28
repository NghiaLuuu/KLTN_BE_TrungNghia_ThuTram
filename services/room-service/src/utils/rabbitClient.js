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
  await ch.assertQueue(queue, { durable: true });
  ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true });
}

async function sendRpcRequest(queue, message, timeout = 30000) {
  const ch = await connectRabbit();
  
  return new Promise(async (resolve, reject) => {
    const correlationId = Math.random().toString(36) + Date.now().toString(36);
    
    // Tạo exclusive queue để nhận response
    const replyQueue = await ch.assertQueue('', { exclusive: true });
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      reject(new Error(`RPC timeout after ${timeout}ms`));
    }, timeout);
    
    // Listen for response
    ch.consume(replyQueue.queue, (msg) => {
      if (msg && msg.properties.correlationId === correlationId) {
        clearTimeout(timeoutId);
        try {
          const response = JSON.parse(msg.content.toString());
          resolve(response);
        } catch (err) {
          reject(new Error('Invalid response format'));
        }
        ch.ack(msg);
      }
    }, { noAck: false });
    
    // Send request
    await ch.assertQueue(queue, { durable: true });
    ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      replyTo: replyQueue.queue,
      correlationId: correlationId
    });
  });
}

module.exports = { publishToQueue, sendRpcRequest };

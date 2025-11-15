// utils/rabbitClient.js
const amqp = require('amqplib');

let channel;
let connection;

async function connectRabbit(retries = 10, delay = 2000) {
  if (!channel) {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`🔄 Attempting RabbitMQ client connection (${i + 1}/${retries})...`);
        connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
        channel = await connection.createChannel();
        console.log('✅ RabbitMQ client connected');
        
        // Handle connection errors
        connection.on('error', (err) => {
          console.error('❌ RabbitMQ client connection error:', err.message);
          connection = null;
          channel = null;
        });
        
        connection.on('close', () => {
          console.log('⚠️ RabbitMQ client connection closed');
          connection = null;
          channel = null;
        });
        
        return channel;
      } catch (error) {
        console.error(`❌ RabbitMQ client connection attempt ${i + 1} failed:`, error.message);
        
        if (i < retries - 1) {
          const waitTime = delay * Math.pow(2, i); // Exponential backoff
          console.log(`⏳ Retrying client connection in ${waitTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
          throw new Error(`Failed to connect RabbitMQ client after ${retries} attempts`);
        }
      }
    }
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

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

/**
 * Publish message to queue
 */
async function publishToQueue(queueName, message) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
      persistent: true
    });
    console.log(`📤 Published to ${queueName}:`, message.type || message.event || message.action || 'message');
  } catch (error) {
    console.error(`❌ Failed to publish to ${queueName}:`, error);
    throw error;
  }
}

/**
 * Consume messages from queue
 */
async function consumeQueue(queueName, handler) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    
    // ✅ Set prefetch to 1 - process one message at a time
    await ch.prefetch(1);
    
    console.log(`👂 Listening to ${queueName}...`);
    
    ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📥 Received from ${queueName}:`, content.type || content.event || content.action || 'message');
          
          await handler(content);
          
          ch.ack(msg);
        } catch (error) {
          console.error(`❌ Error processing message from ${queueName}:`, error);
          ch.nack(msg, false, false); // Don't requeue
        }
      }
    });
  } catch (error) {
    console.error(`❌ Failed to consume from ${queueName}:`, error);
    throw error;
  }
}

module.exports = { 
  connectRabbitMQ, 
  getChannel,
  publishToQueue,
  consumeQueue,
  consumeFromQueue: consumeQueue // Alias for compatibility
};

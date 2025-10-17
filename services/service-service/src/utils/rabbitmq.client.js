/**
 * RabbitMQ Client for Service Service
 */

const amqp = require('amqplib');
let connection = null;
let channel = null;

async function connectRabbitMQ(url) {
  if (channel) return channel;
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  
  console.log('🟢 Service Service connected to RabbitMQ');
  
  // Handle connection errors
  connection.on('error', (error) => {
    console.error('❌ RabbitMQ connection error:', error);
  });
  
  connection.on('close', () => {
    console.log('🔴 RabbitMQ connection closed');
    setTimeout(() => connectRabbitMQ(url), 5000);
  });
  
  return channel;
}

function getChannel() {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}

/**
 * Consume messages from queue
 */
async function consumeFromQueue(queueName, handler) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    
    // ✅ Set prefetch to 1 - process one message at a time
    await ch.prefetch(1);
    
    console.log(`👂 [RabbitMQ] Listening to ${queueName}...`);
    
    ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📥 [RabbitMQ] Received from ${queueName}:`, content.event || content.type);
          
          await handler(content);
          
          ch.ack(msg);
          console.log('✅ [RabbitMQ] Message acknowledged');
        } catch (error) {
          console.error(`❌ [RabbitMQ] Error processing message from ${queueName}:`, error);
          ch.nack(msg, false, false); // Don't requeue - will go to dead letter if configured
        }
      }
    });
  } catch (error) {
    console.error(`❌ [RabbitMQ] Failed to consume from ${queueName}:`, error);
    throw error;
  }
}

module.exports = { 
  connectRabbitMQ, 
  getChannel,
  consumeFromQueue
};

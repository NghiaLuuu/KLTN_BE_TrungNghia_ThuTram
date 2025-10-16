/**
 * @author: TrungNghia
 * RabbitMQ Client for Payment Service
 */

const amqp = require('amqplib');
let connection = null;
let channel = null;

async function connectRabbitMQ(url) {
  if (channel) return channel;
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  
  console.log('🟢 Payment Service connected to RabbitMQ');
  
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
 * Publish message to queue
 */
async function publishToQueue(queueName, message) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
      persistent: true
    });
    console.log(`📤 Published to ${queueName}:`, message.event || message.type);
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
    
    console.log(`👂 Listening to ${queueName}...`);
    
    ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📥 Received from ${queueName}:`, content.event || content.type);
          
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

/**
 * Publish event to exchange (for event-driven architecture)
 */
async function publishEvent(exchange, routingKey, event) {
  try {
    const ch = getChannel();
    await ch.assertExchange(exchange, 'topic', { durable: true });
    ch.publish(
      exchange,
      routingKey,
      Buffer.from(JSON.stringify(event)),
      { persistent: true }
    );
    console.log(`📤 Published event to ${exchange}/${routingKey}:`, event.event);
  } catch (error) {
    console.error(`❌ Failed to publish event:`, error);
    throw error;
  }
}

module.exports = { 
  connectRabbitMQ, 
  getChannel,
  publishToQueue,
  consumeQueue,
  publishEvent
};

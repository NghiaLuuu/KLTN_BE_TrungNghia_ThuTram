const amqp = require('amqplib');
let connection = null;
let channel = null;

async function connectRabbitMQ(url) {
  try {
    if (connection && channel) {
      console.log('✅ RabbitMQ already connected');
      return channel;
    }
    
    connection = await amqp.connect(url);
    channel = await connection.createChannel();
    
    // Handle connection errors
    connection.on('error', (err) => {
      console.error('❌ RabbitMQ connection error:', err.message);
    });
    
    connection.on('close', () => {
      console.warn('⚠️  RabbitMQ connection closed');
      channel = null;
      connection = null;
    });
    
    // Handle channel errors - Recreate channel on error
    channel.on('error', async (err) => {
      console.error('❌ RabbitMQ channel error:', err.message);
      console.log('🔄 Recreating channel...');
      try {
        channel = await connection.createChannel();
        console.log('✅ Channel recreated');
      } catch (error) {
        console.error('❌ Failed to recreate channel:', error.message);
      }
    });
    
    channel.on('close', () => {
      console.warn('⚠️  RabbitMQ channel closed');
      // Don't set channel = null here, let error handler recreate it
    });
    
    console.log('✅ record-service: RabbitMQ connected');
    return channel;
  } catch (error) {
    console.error('❌ Failed to connect to RabbitMQ:', error.message);
    throw error;
  }
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
    console.log(`📤 [record-service] Published to ${queueName}:`, message.event || message.action);
  } catch (error) {
    console.error(`❌ [record-service] Failed to publish to ${queueName}:`, error);
    throw error;
  }
}

/**
 * Consume messages from queue
 */
async function consumeQueue(queueName, handler) {
  try {
    const ch = getChannel();
    
    // Create queue if it doesn't exist
    console.log(`📋 [record-service] Ensuring queue exists: ${queueName}`);
    await ch.assertQueue(queueName, { durable: true });
    
    // Set prefetch to 1 - process one message at a time
    await ch.prefetch(1);
    
    console.log(`👂 [record-service] Listening to ${queueName}...`);
    
    ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📥 [record-service] Received from ${queueName}:`, content.event || content.action);
          
          await handler(content);
          
          ch.ack(msg);
          console.log(`✅ [record-service] Message processed from ${queueName}`);
        } catch (error) {
          console.error(`❌ [record-service] Error processing message from ${queueName}:`, error);
          ch.nack(msg, false, false); // Don't requeue
        }
      }
    });
    
    console.log(`✅ [record-service] Consumer registered for ${queueName}`);
  } catch (error) {
    console.error(`❌ [record-service] Failed to consume from ${queueName}:`, error.message);
    throw error;
  }
}

module.exports = { 
  connectRabbitMQ, 
  getChannel,
  publishToQueue,
  consumeQueue
};

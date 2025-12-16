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
    
    // Xử lý lỗi kết nối
    connection.on('error', (err) => {
      console.error('❌ RabbitMQ connection error:', err.message);
    });
    
    connection.on('close', () => {
      console.warn('⚠️  RabbitMQ connection closed');
      channel = null;
      connection = null;
    });
    
    // Xử lý lỗi kênh - Tạo lại kênh khi có lỗi
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
      // Không đặt channel = null ở đây, để bộ xử lý lỗi tạo lại
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
 * Phát message đến queue
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
 * Tiêu thụ message từ queue
 */
async function consumeQueue(queueName, handler) {
  try {
    const ch = getChannel();
    
    // Tạo queue nếu chưa tồn tại
    console.log(`📋 [record-service] Đảm bảo queue tồn tại: ${queueName}`);
    await ch.assertQueue(queueName, { durable: true });
    
    // Đặt prefetch là 1 - xử lý từng message một
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

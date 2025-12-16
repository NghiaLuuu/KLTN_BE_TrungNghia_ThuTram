/**
 * @author: TrungNghia
 * RabbitMQ Client cho Payment Service
 * Xử lý kết nối và giao tiếp message queue
 */

const amqp = require('amqplib');
let connection = null;
let channel = null;

async function connectRabbitMQ(url) {
  if (channel) return channel;
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  
  // ✅ Đã gỡ log kết nối - sẽ log trong index.js
  
  // Xử lý lỗi kết nối
  connection.on('error', (error) => {
    console.error('❌ Lỗi kết nối RabbitMQ:', error);
  });
  
  connection.on('close', () => {
    console.log('🔴 Kết nối RabbitMQ đã đóng');
    setTimeout(() => connectRabbitMQ(url), 5000);
  });
  
  return channel;
}

function getChannel() {
  if (!channel) throw new Error('RabbitMQ channel not initialized');
  return channel;
}

/**
 * Gửi tin nhắn đến queue
 */
async function publishToQueue(queueName, message) {
  try {
    // Kiểm tra channel đã được khởi tạo chưa
    if (!channel) {
      console.warn(`⚠️ Channel RabbitMQ chưa khởi tạo, bỏ qua gửi đến ${queueName}`);
      return;
    }

    const ch = getChannel();
    
    // ✅ ĐÃ SỬA: Không xóa queue - chỉ kiểm tra tồn tại
    // Xóa queue sẽ loại bỏ tất cả consumer đang lắng nghe!
    await ch.assertQueue(queueName, { durable: true });
    
    ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
      persistent: true
    });
    console.log(`📤 Đã gửi sự kiện đến ${queueName}`);
  } catch (error) {
    console.error(`❌ Gửi đến ${queueName} thất bại:`, error.message);
    // Không throw - để caller xử lý
  }
}

/**
 * Tiêu thụ tin nhắn từ queue
 */
async function consumeQueue(queueName, handler) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    
    console.log(`👂 Đang lắng nghe ${queueName}...`);
    
    ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📥 Nhận từ ${queueName}:`, content.event || content.type);
          
          await handler(content);
          
          ch.ack(msg);
        } catch (error) {
          console.error(`❌ Lỗi xử lý tin nhắn từ ${queueName}:`, error);
          ch.nack(msg, false, false); // Không requeue
        }
      }
    });
  } catch (error) {
    console.error(`❌ Không thể tiêu thụ từ ${queueName}:`, error);
    throw error;
  }
}

/**
 * Phát sự kiện đến exchange (cho kiến trúc event-driven)
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
    console.log(`📤 Đã phát sự kiện đến ${exchange}/${routingKey}:`, event.event);
  } catch (error) {
    console.error(`❌ Phát sự kiện thất bại:`, error);
    throw error;
  }
}

module.exports = { 
  connectRabbitMQ, 
  getChannel,
  publishToQueue,
  consumeQueue,
  consumeFromQueue: consumeQueue, // Alias để tương thích
  publishEvent
};

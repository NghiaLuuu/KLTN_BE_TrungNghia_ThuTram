const amqp = require('amqplib');
let connection = null;
let channel = null;

/**
 * Kết nối đến RabbitMQ server
 * @param {string} url - URL kết nối RabbitMQ
 * @returns {Object} Channel đã được khởi tạo
 */
async function connectRabbitMQ(url) {
  if (channel) return channel; // đã kết nối
  connection = await amqp.connect(url);
  channel = await connection.createChannel();
  return channel;
}

/**
 * Lấy channel RabbitMQ đã được khởi tạo
 * @returns {Object} Channel hiện tại
 * @throws {Error} Nếu channel chưa được khởi tạo
 */
function getChannel() {
  if (!channel) throw new Error('RabbitMQ channel chưa được khởi tạo');
  return channel;
}

/**
 * Gửi message đến queue
 * @param {string} queueName - Tên queue
 * @param {Object} message - Nội dung message
 */
async function publishToQueue(queueName, message) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
      persistent: true
    });
    // Không log để tránh spam
  } catch (error) {
    console.error(`❌ Gửi message đến ${queueName} thất bại:`, error);
    throw error;
  }
}

/**
 * Lắng nghe và xử lý message từ queue
 * @param {string} queueName - Tên queue cần lắng nghe
 * @param {Function} handler - Hàm xử lý message
 */
async function consumeQueue(queueName, handler) {
  try {
    const ch = getChannel();
    await ch.assertQueue(queueName, { durable: true });
    
    // ✅ Đặt prefetch = 1 - xử lý từng message một
    await ch.prefetch(1);
    
    console.log(`👂 Đang lắng nghe ${queueName}...`);
    
    ch.consume(queueName, async (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          console.log(`📥 Nhận từ ${queueName}:`, content.type || content.event || content.action || 'message');
          
          await handler(content);
          
          ch.ack(msg);
        } catch (error) {
          console.error(`❌ Lỗi xử lý message từ ${queueName}:`, error);
          ch.nack(msg, false, false); // Không requeue
        }
      }
    });
  } catch (error) {
    console.error(`❌ Lắng nghe ${queueName} thất bại:`, error);
    throw error;
  }
}

/**
 * Gửi RPC request và đợi response
 * @param {string} queueName - Tên queue RPC (vd: 'rpc.auth-service')
 * @param {object} message - Payload request
 * @param {number} timeout - Thời gian chờ tối đa (ms), mặc định: 20000
 * @returns {Promise<object>} Response từ RPC server
 */
async function sendRpcRequest(queueName, message, timeout = 20000) {
  return new Promise(async (resolve, reject) => {
    try {
      const ch = getChannel();
      
      // Tạo queue reply riêng biệt (exclusive)
      const { queue: replyQueue } = await ch.assertQueue('', { exclusive: true });
      
      // Tạo correlation ID duy nhất
      const correlationId = `${Date.now()}-${Math.random()}`;
      
      // Đặt timeout
      const timer = setTimeout(() => {
        reject(new Error(`RPC timeout sau ${timeout}ms: ${queueName}`));
      }, timeout);
      
      // Lắng nghe response
      ch.consume(replyQueue, (msg) => {
        if (msg && msg.properties.correlationId === correlationId) {
          clearTimeout(timer);
          const response = JSON.parse(msg.content.toString());
          resolve(response);
        }
      }, { noAck: true });
      
      // Gửi request
      ch.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
        correlationId,
        replyTo: replyQueue
      });
      
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { 
  connectRabbitMQ, 
  getChannel,
  publishToQueue,
  consumeQueue,
  consumeFromQueue: consumeQueue, // Alias để tương thích
  sendRpcRequest
};

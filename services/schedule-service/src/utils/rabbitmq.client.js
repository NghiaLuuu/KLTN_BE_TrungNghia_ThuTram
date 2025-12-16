const amqp = require('amqplib');

class RabbitMQClient {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.reconnectTimeout = null;
    this.reconnectDelay = 5000; // 5 seconds
  }

  async connect(url = process.env.RABBITMQ_URL || 'amqp://localhost:5672') {
    try {
      if (this.connection) {
        return; // ✅ Đã kết nối - không cần log
      }

      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // ✅ Log trong index.js chỉ

      // Xử lý lỗi kết nối
      this.connection.on('error', (err) => {
        console.error('[Schedule RabbitMQ] Lỗi kết nối:', err);
        this.handleDisconnect();
      });

      this.connection.on('close', () => {
        console.log('[Schedule RabbitMQ] Kết nối đã đóng');
        this.handleDisconnect();
      });

      return this.channel;
    } catch (error) {
      console.error('[Schedule RabbitMQ] Kết nối thất bại:', error.message);
      this.handleDisconnect();
      throw error;
    }
  }

  handleDisconnect() {
    this.connection = null;
    this.channel = null;

    // Kết nối lại sau một khoảng thời gian
    if (!this.reconnectTimeout) {
      console.log(`[Schedule RabbitMQ] Đang kết nối lại sau ${this.reconnectDelay / 1000} giây...`);
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.connect();
      }, this.reconnectDelay);
    }
  }

  async getChannel() {
    if (!this.channel) {
      await this.connect();
    }
    return this.channel;
  }

  /**
   * Gửi message tới một queue
   */
  async publishToQueue(queueName, message) {
    try {
      const channel = await this.getChannel();
      
      // Đảm bảo queue tồn tại
      await channel.assertQueue(queueName, { durable: true });
      
      // Gửi message
      const messageBuffer = Buffer.from(JSON.stringify(message));
      channel.sendToQueue(queueName, messageBuffer, { persistent: true });
      
      console.log(`📤 Sự kiện đã gửi tới ${queueName}`);
      return true;
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Lỗi khi gửi tới queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Tiêu thụ message từ một queue
   */
  async consumeQueue(queueName, handler) {
    try {
      const channel = await this.getChannel();
      
      // Đảm bảo queue tồn tại
      await channel.assertQueue(queueName, { durable: true });
      
      // ✅ Đặt prefetch = 1 - xử lý một message mỗi lần
      await channel.prefetch(1);
      
      // Tiêu thụ messages
      channel.consume(queueName, async (msg) => {
        if (msg) {
          try {
            const data = JSON.parse(msg.content.toString());
            console.log(`📥 Nhận từ ${queueName}`);
            
            // Xử lý message - handler trả về true để ack, false để requeue
            const shouldAck = await handler(data, msg);
            
            if (shouldAck !== false) {
              // Xác nhận message (hành vi mặc định)
              channel.ack(msg);
            } else {
              // Requeue message cho consumer khác xử lý
              console.log(`🔄 Đang requeue message cho consumer khác`);
              channel.nack(msg, false, true); // requeue = true
            }
          } catch (error) {
            console.error(`❌ Lỗi khi xử lý ${queueName}:`, error.message);
            
            // Từ chối và không requeue khi lỗi (gửi tới DLQ)
            channel.nack(msg, false, false);
          }
        }
      });
      
      // ✅ Log đã xóa - sẽ hiển thị trong consumer chỉ
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Lỗi khi consume queue ${queueName}:`, error);
      throw error;
    }
  }

  // Bí danh để tương thích
  async consumeFromQueue(queueName, handler) {
    return this.consumeQueue(queueName, handler);
  }

  // Bí danh để tương thích
  async connectRabbitMQ(url) {
    return this.connect(url);
  }

  /**
   * Phát sự kiện tới một exchange
   */
  async publishEvent(exchange, routingKey, event) {
    try {
      const channel = await this.getChannel();
      
      // Đảm bảo exchange tồn tại
      await channel.assertExchange(exchange, 'topic', { durable: true });
      
      // Phát sự kiện
      const messageBuffer = Buffer.from(JSON.stringify(event));
      channel.publish(exchange, routingKey, messageBuffer, { persistent: true });
      
      console.log(`[Schedule RabbitMQ] Đã phát sự kiện ${routingKey} tới ${exchange}`);
      return true;
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Lỗi khi phát sự kiện:`, error);
      throw error;
    }
  }

  /**
   * Gửi yêu cầu RPC và chờ phản hồi
   * @param {String} queueName - Tên queue đích
   * @param {Object} message - Message yêu cầu
   * @param {Number} timeout - Thời gian chờ tối đa tính bằng mili giây (mặc định: 5000)
   * @returns {Promise<Object>} - Phản hồi từ consumer
   */
  async sendRpcRequest(queueName, message, timeout = 5000) {
    try {
      const channel = await this.getChannel();
      
      // Tạo queue phản hồi riêng
      const { queue: replyQueue } = await channel.assertQueue('', { exclusive: true });
      const correlationId = this.generateUuid();
      
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new Error(`Yêu cầu RPC tới ${queueName} đã hết thời gian chờ sau ${timeout}ms`));
        }, timeout);
        
        // Tiêu thụ phản hồi
        channel.consume(replyQueue, (msg) => {
          if (msg && msg.properties.correlationId === correlationId) {
            clearTimeout(timeoutHandle);
            const response = JSON.parse(msg.content.toString());
            resolve(response);
            channel.cancel(msg.fields.consumerTag);
          }
        }, { noAck: true });
        
        // Gửi yêu cầu
        const messageBuffer = Buffer.from(JSON.stringify(message));
        channel.sendToQueue(queueName, messageBuffer, {
          correlationId,
          replyTo: replyQueue,
          persistent: true
        });
        
        console.log(`📤 Yêu cầu RPC đã gửi tới ${queueName} (correlationId: ${correlationId})`);
      });
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Lỗi khi gửi yêu cầu RPC tới ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Tạo UUID cho correlation ID
   */
  generateUuid() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15) + 
           Date.now().toString(36);
  }

  async close() {
    try {
      if (this.reconnectTimeout) {
        clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = null;
      }

      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      console.log('[Schedule RabbitMQ] Đã đóng thành công');
    } catch (error) {
      console.error('[Schedule RabbitMQ] Lỗi khi đóng:', error);
    }
  }
}

// Xuất instance singleton
const rabbitmqClient = new RabbitMQClient();

// Xuất cả instance và helper sendRpcRequest (bind để tránh đệ quy vô hạn)
const boundSendRpcRequest = rabbitmqClient.sendRpcRequest.bind(rabbitmqClient);
module.exports = rabbitmqClient;
module.exports.sendRpcRequest = boundSendRpcRequest;

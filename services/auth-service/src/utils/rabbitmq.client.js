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
        return; // Already connected
      }

      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      console.log('✅ [Auth RabbitMQ] Connected');

      // Handle connection errors
      this.connection.on('error', (err) => {
        console.error('[Auth RabbitMQ] Connection error:', err);
        this.handleDisconnect();
      });

      this.connection.on('close', () => {
        console.log('[Auth RabbitMQ] Connection closed');
        this.handleDisconnect();
      });

      return this.channel;
    } catch (error) {
      console.error('[Auth RabbitMQ] Connection failed:', error.message);
      this.handleDisconnect();
      throw error;
    }
  }

  handleDisconnect() {
    this.connection = null;
    this.channel = null;

    // Reconnect after delay
    if (!this.reconnectTimeout) {
      console.log(`[Auth RabbitMQ] Reconnecting in ${this.reconnectDelay / 1000}s...`);
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
   * Consume messages from a queue
   */
  async consumeQueue(queueName, handler) {
    try {
      const channel = await this.getChannel();
      
      // Assert queue exists
      await channel.assertQueue(queueName, { durable: true });
      
      // Set prefetch to 1 - process one message at a time
      await channel.prefetch(1);
      
      console.log(`📥 [Auth RabbitMQ] Listening for messages on queue: ${queueName}`);
      
      // Consume messages
      channel.consume(queueName, async (msg) => {
        if (msg) {
          try {
            const data = JSON.parse(msg.content.toString());
            console.log(`📬 [Auth RabbitMQ] Received message from ${queueName}`);
            
            // Process message
            await handler(data);
            
            // Acknowledge message
            channel.ack(msg);
            console.log(`✅ [Auth RabbitMQ] Message processed and acknowledged`);
          } catch (error) {
            console.error(`❌ [Auth RabbitMQ] Error processing ${queueName}:`, error.message);
            
            // Reject and don't requeue (send to DLQ if configured)
            channel.nack(msg, false, false);
          }
        }
      });
    } catch (error) {
      console.error(`[Auth RabbitMQ] Error consuming queue ${queueName}:`, error);
      throw error;
    }
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

      console.log('[Auth RabbitMQ] Closed successfully');
    } catch (error) {
      console.error('[Auth RabbitMQ] Error closing:', error);
    }
  }
}

// Export singleton instance
const rabbitmqClient = new RabbitMQClient();
module.exports = rabbitmqClient;

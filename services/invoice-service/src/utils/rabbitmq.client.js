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
        console.log('[Invoice RabbitMQ] Already connected');
        return;
      }

      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      console.log('[Invoice RabbitMQ] Connected successfully');

      // Handle connection errors
      this.connection.on('error', (err) => {
        console.error('[Invoice RabbitMQ] Connection error:', err);
        this.handleDisconnect();
      });

      this.connection.on('close', () => {
        console.log('[Invoice RabbitMQ] Connection closed');
        this.handleDisconnect();
      });

      return this.channel;
    } catch (error) {
      console.error('[Invoice RabbitMQ] Connection failed:', error.message);
      this.handleDisconnect();
      throw error;
    }
  }

  handleDisconnect() {
    this.connection = null;
    this.channel = null;

    // Reconnect after delay
    if (!this.reconnectTimeout) {
      console.log(`[Invoice RabbitMQ] Reconnecting in ${this.reconnectDelay / 1000}s...`);
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
   * Publish message to a queue
   */
  async publishToQueue(queueName, message) {
    try {
      const channel = await this.getChannel();
      
      // Assert queue exists
      await channel.assertQueue(queueName, { durable: true });
      
      // Publish message
      const messageBuffer = Buffer.from(JSON.stringify(message));
      channel.sendToQueue(queueName, messageBuffer, { persistent: true });
      
      console.log(`[Invoice RabbitMQ] Published to queue ${queueName}:`, message);
      return true;
    } catch (error) {
      console.error(`[Invoice RabbitMQ] Error publishing to queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Consume messages from a queue
   */
  async consumeQueue(queueName, handler) {
    try {
      const channel = await this.getChannel();
      
      // Assert queue exists
      await channel.assertQueue(queueName, { durable: true });
      
      // Consume messages
      channel.consume(queueName, async (msg) => {
        if (msg) {
          try {
            const data = JSON.parse(msg.content.toString());
            console.log(`[Invoice RabbitMQ] Received from ${queueName}:`, data);
            
            // Process message
            await handler(data);
            
            // Acknowledge message
            channel.ack(msg);
          } catch (error) {
            console.error(`[Invoice RabbitMQ] Error processing message from ${queueName}:`, error);
            
            // Reject and requeue message (or send to dead letter queue)
            channel.nack(msg, false, false);
          }
        }
      });
      
      console.log(`[Invoice RabbitMQ] Consuming queue: ${queueName}`);
    } catch (error) {
      console.error(`[Invoice RabbitMQ] Error consuming queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Publish event to an exchange
   */
  async publishEvent(exchange, routingKey, event) {
    try {
      const channel = await this.getChannel();
      
      // Assert exchange exists
      await channel.assertExchange(exchange, 'topic', { durable: true });
      
      // Publish event
      const messageBuffer = Buffer.from(JSON.stringify(event));
      channel.publish(exchange, routingKey, messageBuffer, { persistent: true });
      
      console.log(`[Invoice RabbitMQ] Published event ${routingKey} to ${exchange}`);
      return true;
    } catch (error) {
      console.error(`[Invoice RabbitMQ] Error publishing event:`, error);
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

      console.log('[Invoice RabbitMQ] Closed successfully');
    } catch (error) {
      console.error('[Invoice RabbitMQ] Error closing:', error);
    }
  }
}

// Export singleton instance
const rabbitmqClient = new RabbitMQClient();
module.exports = rabbitmqClient;

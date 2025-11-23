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
        return; // ✅ Already connected - no log needed
      }

      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

      // ✅ Log in index.js only

      // Handle connection errors
      this.connection.on('error', (err) => {
        console.error('[Schedule RabbitMQ] Connection error:', err);
        this.handleDisconnect();
      });

      this.connection.on('close', () => {
        console.log('[Schedule RabbitMQ] Connection closed');
        this.handleDisconnect();
      });

      return this.channel;
    } catch (error) {
      console.error('[Schedule RabbitMQ] Connection failed:', error.message);
      this.handleDisconnect();
      throw error;
    }
  }

  handleDisconnect() {
    this.connection = null;
    this.channel = null;

    // Reconnect after delay
    if (!this.reconnectTimeout) {
      console.log(`[Schedule RabbitMQ] Reconnecting in ${this.reconnectDelay / 1000}s...`);
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
      
      console.log(`📤 Event sent to ${queueName}`);
      return true;
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Error publishing to queue ${queueName}:`, error);
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
      
      // ✅ Set prefetch to 1 - process one message at a time
      await channel.prefetch(1);
      
      // Consume messages
      channel.consume(queueName, async (msg) => {
        if (msg) {
          try {
            const data = JSON.parse(msg.content.toString());
            console.log(`📥 Received from ${queueName}`);
            
            // Process message - handler should return true to ack, false to requeue
            const shouldAck = await handler(data, msg);
            
            if (shouldAck !== false) {
              // Acknowledge message (default behavior)
              channel.ack(msg);
            } else {
              // Requeue message for another consumer to handle
              console.log(`🔄 Requeuing message for another consumer`);
              channel.nack(msg, false, true); // requeue = true
            }
          } catch (error) {
            console.error(`❌ Error processing ${queueName}:`, error.message);
            
            // Reject and don't requeue on error (send to DLQ)
            channel.nack(msg, false, false);
          }
        }
      });
      
      // ✅ Log removed - will show in consumer only
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Error consuming queue ${queueName}:`, error);
      throw error;
    }
  }

  // Alias for compatibility
  async consumeFromQueue(queueName, handler) {
    return this.consumeQueue(queueName, handler);
  }

  // Alias for compatibility
  async connectRabbitMQ(url) {
    return this.connect(url);
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
      
      console.log(`[Schedule RabbitMQ] Published event ${routingKey} to ${exchange}`);
      return true;
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Error publishing event:`, error);
      throw error;
    }
  }

  /**
   * Send RPC request and wait for response
   * @param {String} queueName - Target queue name
   * @param {Object} message - Request message
   * @param {Number} timeout - Timeout in milliseconds (default: 5000)
   * @returns {Promise<Object>} - Response from consumer
   */
  async sendRpcRequest(queueName, message, timeout = 5000) {
    try {
      const channel = await this.getChannel();
      
      // Create exclusive response queue
      const { queue: replyQueue } = await channel.assertQueue('', { exclusive: true });
      const correlationId = this.generateUuid();
      
      return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          reject(new Error(`RPC request to ${queueName} timed out after ${timeout}ms`));
        }, timeout);
        
        // Consume response
        channel.consume(replyQueue, (msg) => {
          if (msg && msg.properties.correlationId === correlationId) {
            clearTimeout(timeoutHandle);
            const response = JSON.parse(msg.content.toString());
            resolve(response);
            channel.cancel(msg.fields.consumerTag);
          }
        }, { noAck: true });
        
        // Send request
        const messageBuffer = Buffer.from(JSON.stringify(message));
        channel.sendToQueue(queueName, messageBuffer, {
          correlationId,
          replyTo: replyQueue,
          persistent: true
        });
        
        console.log(`📤 RPC request sent to ${queueName} (correlationId: ${correlationId})`);
      });
    } catch (error) {
      console.error(`[Schedule RabbitMQ] Error sending RPC request to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Generate UUID for correlation ID
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

      console.log('[Schedule RabbitMQ] Closed successfully');
    } catch (error) {
      console.error('[Schedule RabbitMQ] Error closing:', error);
    }
  }
}

// Export singleton instance
const rabbitmqClient = new RabbitMQClient();

// Export both instance and sendRpcRequest helper (bind để tránh đệ quy vô hạn)
const boundSendRpcRequest = rabbitmqClient.sendRpcRequest.bind(rabbitmqClient);
module.exports = rabbitmqClient;
module.exports.sendRpcRequest = boundSendRpcRequest;

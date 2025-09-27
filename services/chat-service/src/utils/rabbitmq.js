const amqp = require('amqplib');
const chatService = require('../services/chat.service');

class RabbitMQListener {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect(process.env.RABBITMQ_URL);
      this.channel = await this.connection.createChannel();

      console.log('🟢 Connected to RabbitMQ');

      // Setup exchange and queue for record completion events
      await this.setupRecordCompletionListener();

      // Handle connection errors
      this.connection.on('error', (error) => {
        console.error('❌ RabbitMQ connection error:', error);
      });

      this.connection.on('close', () => {
        console.log('🔴 RabbitMQ connection closed');
        // Implement reconnection logic if needed
        setTimeout(() => this.connect(), 5000);
      });

    } catch (error) {
      console.error('❌ Failed to connect to RabbitMQ:', error);
      // Retry connection after delay
      setTimeout(() => this.connect(), 5000);
    }
  }

  async setupRecordCompletionListener() {
    try {
      const exchange = 'record_events';
      const queue = 'chat_service_record_completion';
      const routingKey = 'record.completed';

      // Refresh exchange to ensure durability settings take effect
      try {
        await this.channel.deleteExchange(exchange);
        console.log(`♻️ Refreshing RabbitMQ exchange ${exchange} before asserting`);
      } catch (err) {
        if (err?.code !== 404) {
          console.warn(`⚠️ Could not delete exchange ${exchange} during refresh:`, err.message || err);
        }
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });

      // Ensure queue is recreated with latest durability config
      try {
        await this.channel.deleteQueue(queue);
        console.log(`♻️ Refreshing RabbitMQ queue ${queue} before asserting`);
      } catch (err) {
        if (err?.code !== 404) {
          console.warn(`⚠️ Could not delete queue ${queue} during refresh:`, err.message || err);
        }
      }

      await this.channel.assertQueue(queue, { durable: true });

      // Bind queue to exchange
      await this.channel.bindQueue(queue, exchange, routingKey);

      // Consume messages
      await this.channel.consume(queue, async (message) => {
        if (message) {
          try {
            const recordData = JSON.parse(message.content.toString());
            console.log('📨 Received record completion event:', recordData);

            // Create conversation from completed record
            await this.handleRecordCompletion(recordData);

            // Acknowledge message
            this.channel.ack(message);
          } catch (error) {
            console.error('❌ Error processing record completion:', error);
            // Reject message and requeue
            this.channel.nack(message, false, true);
          }
        }
      }, { noAck: false });

      console.log('🎧 Listening for record completion events...');
    } catch (error) {
      console.error('❌ Error setting up record completion listener:', error);
    }
  }

  async handleRecordCompletion(recordData) {
    try {
      // Validate required fields
      if (!recordData.recordId || !recordData.doctorId || !recordData.patientId) {
        console.error('❌ Invalid record data for conversation creation:', recordData);
        return;
      }

      // Create conversation
      const conversation = await chatService.createConversationFromRecord(recordData);

      console.log(`✅ Conversation created/found for record ${recordData.recordId}`);

      // TODO: Notify users via Socket.IO if they are online
      // This would require access to the SocketHandler instance
      
      return conversation;
    } catch (error) {
      console.error('❌ Error handling record completion:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      console.log('🔴 Disconnected from RabbitMQ');
    } catch (error) {
      console.error('❌ Error disconnecting from RabbitMQ:', error);
    }
  }

  // Method to publish messages if needed
  async publishMessage(exchange, routingKey, message) {
    try {
      if (!this.channel) {
        throw new Error('RabbitMQ channel not available');
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      
      const messageBuffer = Buffer.from(JSON.stringify(message));
      
      this.channel.publish(exchange, routingKey, messageBuffer, {
        persistent: true,
        timestamp: Date.now()
      });

      console.log(`📤 Published message to ${exchange}/${routingKey}`);
    } catch (error) {
      console.error('❌ Error publishing message:', error);
      throw error;
    }
  }
}

module.exports = new RabbitMQListener();
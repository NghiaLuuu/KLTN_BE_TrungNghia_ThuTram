const amqp = require('amqplib');

class RabbitMQClient {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect() {
    try {
      this.connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
      this.channel = await this.connection.createChannel();
      
      console.log('✅ RabbitMQ connected successfully');
      
      // Setup queues for communication
      await this.setupQueues();
      
      return this.channel;
    } catch (error) {
      console.error('❌ RabbitMQ connection failed:', error);
      throw error;
    }
  }

  async setupQueues() {
    const queues = [
      'appointment_queue',
      'invoice_queue', 
      'payment_queue',
      'schedule_queue',
      'auth_queue',
      'statistic_queue'
    ];

    for (const queue of queues) {
      // ✅ DON'T delete queues - other services may be consuming them
      // Just assert to ensure they exist
      await this.channel.assertQueue(queue, { durable: true });
    }
  }

  async request(queue, message, timeout = 30000) {
    return new Promise(async (resolve, reject) => {
      let timeoutHandle;
      let consumerTag;
      
      try {
        const correlationId = this.generateUuid();
        const replyQueue = await this.channel.assertQueue('', { exclusive: true });

        // Setup timeout
        timeoutHandle = setTimeout(() => {
          // Cleanup consumer if timeout occurs
          if (consumerTag) {
            this.channel.cancel(consumerTag).catch(err => {
              console.error('Failed to cancel consumer:', err.message);
            });
          }
          reject(new Error('RPC request timeout'));
        }, timeout);

        // Consume response
        const consumer = await this.channel.consume(replyQueue.queue, (msg) => {
          if (msg && msg.properties.correlationId === correlationId) {
            clearTimeout(timeoutHandle);
            
            try {
              const response = JSON.parse(msg.content.toString());
              this.channel.ack(msg);
              
              // Cancel consumer after receiving response
              if (consumerTag) {
                this.channel.cancel(consumerTag).catch(err => {
                  console.error('Failed to cancel consumer:', err.message);
                });
              }
              
              resolve(response);
            } catch (error) {
              reject(new Error('Failed to parse RPC response: ' + error.message));
            }
          }
        }, { noAck: false });
        
        consumerTag = consumer.consumerTag;

        // Send request
        this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
          correlationId: correlationId,
          replyTo: replyQueue.queue,
          expiration: timeout.toString()
        });

      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      }
    });
  }

  generateUuid() {
    return Math.random().toString(36) + Date.now().toString(36);
  }

  async close() {
    if (this.connection) {
      await this.connection.close();
    }
  }
}

const rabbitClient = new RabbitMQClient();

// Auto connect on startup
rabbitClient.connect().catch(console.error);

module.exports = rabbitClient;
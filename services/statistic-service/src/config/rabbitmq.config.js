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
      try {
        await this.channel.deleteQueue(queue);
        console.log(`♻️ Refreshing RabbitMQ queue ${queue} before asserting`);
      } catch (err) {
        if (err?.code !== 404) {
          console.warn(`⚠️ Could not delete queue ${queue} during refresh:`, err.message || err);
        }
      }

      await this.channel.assertQueue(queue, { durable: true });
    }
  }

  async request(queue, message, timeout = 30000) {
    return new Promise(async (resolve, reject) => {
      try {
        const correlationId = this.generateUuid();
        const replyQueue = await this.channel.assertQueue('', { exclusive: true });

        this.channel.consume(replyQueue.queue, (msg) => {
          if (msg.properties.correlationId === correlationId) {
            resolve(JSON.parse(msg.content.toString()));
            this.channel.ack(msg);
          }
        }, { noAck: false });

        this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
          correlationId: correlationId,
          replyTo: replyQueue.queue,
          expiration: timeout.toString()
        });

        setTimeout(() => {
          reject(new Error('RPC request timeout'));
        }, timeout);

      } catch (error) {
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
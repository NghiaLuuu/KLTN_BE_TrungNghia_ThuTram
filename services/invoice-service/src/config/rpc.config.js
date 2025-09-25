const amqp = require('amqplib');

class RPCClient {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.isConnected = false;
    this.responseQueue = null;
    this.correlationId = 0;
    this.pendingRequests = new Map();
  }

  async connect() {
    try {
      const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
      
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();
      
      // Create exclusive queue for responses
      const q = await this.channel.assertQueue('', { exclusive: true });
      this.responseQueue = q.queue;

      // Consume responses
      await this.channel.consume(this.responseQueue, (msg) => {
        if (msg) {
          const correlationId = msg.properties.correlationId;
          const response = JSON.parse(msg.content.toString());
          
          const request = this.pendingRequests.get(correlationId);
          if (request) {
            this.pendingRequests.delete(correlationId);
            if (response.error) {
              request.reject(new Error(response.error));
            } else {
              request.resolve(response.result);
            }
          }
        }
      }, { noAck: true });

      this.connection.on('error', (err) => {
        console.error('❌ RPC connection error:', err.message);
        this.isConnected = false;
      });

      this.connection.on('close', () => {
        console.log('🔌 RPC connection closed');
        this.isConnected = false;
      });

      this.isConnected = true;
      console.log('🔗 RPC Client connected to RabbitMQ');
      return true;
    } catch (error) {
      console.error('❌ RPC Client connection failed:', error.message);
      this.isConnected = false;
      return false;
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
      console.log('✅ RPC Client disconnected gracefully');
    } catch (error) {
      console.error('❌ Error disconnecting RPC Client:', error.message);
    }
  }

  async call(serviceName, methodName, params = {}, timeout = 30000) {
    if (!this.isConnected) {
      throw new Error('RPC Client not connected');
    }

    return new Promise((resolve, reject) => {
      const correlationId = `${++this.correlationId}`;
      const queueName = `${serviceName}_rpc_queue`;

      // Set timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`RPC call timeout: ${serviceName}.${methodName}`));
      }, timeout);

      // Store request
      this.pendingRequests.set(correlationId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      // Send request
      const message = JSON.stringify({
        method: methodName,
        params: params,
        timestamp: new Date().toISOString()
      });

      this.channel.sendToQueue(queueName, Buffer.from(message), {
        correlationId: correlationId,
        replyTo: this.responseQueue,
        timestamp: Date.now()
      });

      console.log(`📤 RPC call sent: ${serviceName}.${methodName}`);
    });
  }

  // Specific service call methods
  async callPaymentService(method, params) {
    try {
      return await this.call('payment-service', method, params);
    } catch (error) {
      console.error(`❌ Payment service call failed: ${method}`, error.message);
      throw error;
    }
  }

  async callAppointmentService(method, params) {
    try {
      return await this.call('appointment-service', method, params);
    } catch (error) {
      console.error(`❌ Appointment service call failed: ${method}`, error.message);
      throw error;
    }
  }

  async callServiceService(method, params) {
    try {
      return await this.call('service-service', method, params);
    } catch (error) {
      console.error(`❌ Service service call failed: ${method}`, error.message);
      throw error;
    }
  }

  async callNotificationService(method, params) {
    try {
      return await this.call('notification-service', method, params);
    } catch (error) {
      console.warn(`⚠️ Notification service call failed: ${method}`, error.message);
      // Don't throw for notifications as they're not critical
      return null;
    }
  }

  // Health check for RPC connection
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return { status: 'disconnected', message: 'RPC Client not connected' };
      }

      // Try a simple ping to a known service
      const start = Date.now();
      try {
        await this.call('health-service', 'ping', {}, 5000);
        const latency = Date.now() - start;
        return { status: 'connected', latency: `${latency}ms` };
      } catch (error) {
        return { status: 'connected', message: 'RPC working but health service unavailable' };
      }
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }

  getStatus() {
    return {
      connected: this.isConnected,
      pendingRequests: this.pendingRequests.size,
      responseQueue: this.responseQueue
    };
  }

  // Batch calls for multiple services
  async batchCall(calls) {
    try {
      const promises = calls.map(({ service, method, params }) => 
        this.call(service, method, params).catch(err => ({ error: err.message }))
      );
      
      return await Promise.all(promises);
    } catch (error) {
      console.error('❌ Batch RPC call failed:', error.message);
      throw error;
    }
  }

  // Safe call with fallback
  async safeCall(serviceName, methodName, params = {}, fallback = null) {
    try {
      return await this.call(serviceName, methodName, params);
    } catch (error) {
      console.warn(`⚠️ RPC call fallback for ${serviceName}.${methodName}:`, error.message);
      return fallback;
    }
  }
}

// Create singleton instance
const rpcClient = new RPCClient();

module.exports = rpcClient;
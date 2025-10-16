const { randomUUID } = require('crypto');
const { getChannel } = require('./rabbitmq.client');

class RPCClient {
  /**
   * Make RPC call to another service
   * @param {string} serviceName - Target service name (e.g., 'schedule-service')
   * @param {string} method - Method name to call
   * @param {object} params - Parameters to pass
   * @param {object} options - Options (timeoutMs)
   * @returns {Promise<any>} Response from service
   */
  async call(serviceName, method, params, options = {}) {
    const timeoutMs = options.timeoutMs || 20000;
    const queueName = `rpc.${serviceName}`;
    const payload = { method, params };

    try {
      const ch = getChannel(); // Get RabbitMQ channel
      if (!ch) {
        throw new Error('RabbitMQ channel not available');
      }

      const { queue: replyTo } = await ch.assertQueue('', { exclusive: true });
      const correlationId = randomUUID();

      return new Promise((resolve, reject) => {
        let timer;
        let consumerTag;

        ch.consume(replyTo, (msg) => {
          if (!msg) return;
          if (msg.properties.correlationId !== correlationId) return;

          clearTimeout(timer);
          ch.cancel(consumerTag).catch(() => {});
          
          try {
            const data = JSON.parse(msg.content.toString());
            
            // Check if response contains error
            if (data.error) {
              reject(new Error(data.error));
            } else {
              resolve(data.result || data);
            }
          } catch (err) {
            reject(err);
          }
        }, { noAck: true })
          .then(({ consumerTag: tag }) => {
            consumerTag = tag;

            ch.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), {
              correlationId,
              replyTo,
              contentType: 'application/json',
            });

            timer = setTimeout(() => {
              ch.cancel(consumerTag).catch(() => {});
              reject(new Error(`RPC timeout after ${timeoutMs}ms: ${serviceName}.${method}`));
            }, timeoutMs);
          })
          .catch(reject);
      });
    } catch (error) {
      console.error(`[RPC Client] Error calling ${serviceName}.${method}:`, error.message);
      throw error;
    }
  }

  /**
   * Legacy request method for backward compatibility
   */
  async request(queueName, payload, options = {}) {
    const timeoutMs = options.timeoutMs || 20000;

    try {
      const ch = getChannel();
      if (!ch) {
        throw new Error('RabbitMQ channel not available');
      }

      const { queue: replyTo } = await ch.assertQueue('', { exclusive: true });
      const correlationId = randomUUID();

      return new Promise((resolve, reject) => {
        let timer;
        let consumerTag;

        ch.consume(replyTo, (msg) => {
          if (!msg) return;
          if (msg.properties.correlationId !== correlationId) return;

          clearTimeout(timer);
          ch.cancel(consumerTag).catch(() => {});
          try {
            const data = JSON.parse(msg.content.toString());
            resolve(data);
          } catch (err) {
            reject(err);
          }
        }, { noAck: true })
          .then(({ consumerTag: tag }) => {
            consumerTag = tag;

            ch.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), {
              correlationId,
              replyTo,
              contentType: 'application/json',
            });

            timer = setTimeout(() => {
              ch.cancel(consumerTag).catch(() => {});
              reject(new Error(`RPC timeout after ${timeoutMs}ms: ${queueName}`));
            }, timeoutMs);
          })
          .catch(reject);
      });
    } catch (error) {
      console.error(`[RPC Client] Error in request to ${queueName}:`, error.message);
      throw error;
    }
  }
}

// Export singleton instance
const rpcClient = new RPCClient();
module.exports = rpcClient;
module.exports.RPCClient = RPCClient;

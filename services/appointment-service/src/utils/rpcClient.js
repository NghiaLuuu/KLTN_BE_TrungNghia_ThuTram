const { randomUUID } = require('crypto');
const { getChannel } = require('./rabbitmq.client');

class RPCClient {
  /**
   * Thực hiện RPC call đến service khác
   * @param {string} serviceName - Tên service đích (vd: 'schedule-service')
   * @param {string} method - Tên method cần gọi
   * @param {object} params - Tham số truyền vào
   * @param {object} options - Tùy chọn (timeoutMs)
   * @returns {Promise<any>} Response từ service
   */
  async call(serviceName, method, params, options = {}) {
    const timeoutMs = options.timeoutMs || 20000;
    const queueName = `rpc.${serviceName}`;
    const payload = { method, params };

    try {
      const ch = getChannel(); // Lấy channel RabbitMQ
      if (!ch) {
        throw new Error('RabbitMQ channel không khả dụng');
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
            
            // Kiểm tra response có lỗi không
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
              reject(new Error(`RPC timeout sau ${timeoutMs}ms: ${serviceName}.${method}`));
            }, timeoutMs);
          })
          .catch(reject);
      });
    } catch (error) {
      console.error(`[RPC Client] Lỗi khi gọi ${serviceName}.${method}:`, error.message);
      throw error;
    }
  }

  /**
   * Phương thức request cũ để tương thích ngược
   * @param {string} queueName - Tên queue RPC
   * @param {object} payload - Dữ liệu request
   * @param {object} options - Tùy chọn (timeoutMs)
   * @returns {Promise<object>} Response từ server
   */
  async request(queueName, payload, options = {}) {
    const timeoutMs = options.timeoutMs || 20000;

    try {
      const ch = getChannel();
      if (!ch) {
        throw new Error('RabbitMQ channel không khả dụng');
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
              reject(new Error(`RPC timeout sau ${timeoutMs}ms: ${queueName}`));
            }, timeoutMs);
          })
          .catch(reject);
      });
    } catch (error) {
      console.error(`[RPC Client] Lỗi trong request đến ${queueName}:`, error.message);
      throw error;
    }
  }
}

// Export singleton instance
const rpcClient = new RPCClient();
module.exports = rpcClient;
module.exports.RPCClient = RPCClient;

const { randomUUID } = require('crypto');
const { getChannel } = require('./rabbitmq.client');

async function request(queueName, payload, { timeoutMs = 5000 } = {}) {
  const ch = getChannel(); // nếu chưa connect, sẽ throw lỗi

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
}

module.exports = { request };

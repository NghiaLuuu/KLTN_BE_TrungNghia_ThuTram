const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

client.on('connect', () => {
  console.log('✅ Redis Client Connected');
});

// Connect to Redis
(async () => {
  try {
    await client.connect();
  } catch (err) {
    console.error('❌ Redis connection failed:', err);
  }
})();

module.exports = client;
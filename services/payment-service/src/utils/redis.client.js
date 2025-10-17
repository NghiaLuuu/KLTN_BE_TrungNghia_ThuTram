const redis = require('redis');

// Use REDIS_URL if available, otherwise fallback to host/port with password
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
};

// Add password if provided
if (process.env.REDIS_PASSWORD) {
  redisConfig.password = process.env.REDIS_PASSWORD;
}

const redisClient = redis.createClient(redisConfig);


redisClient.on('connect', () => {
  // ✅ Log will be in index.js only
});

redisClient.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

// Kết nối ngay khi import
redisClient.connect().catch((err) => {
  console.error('❌ Redis initial connection failed:', err);
});

module.exports = redisClient;

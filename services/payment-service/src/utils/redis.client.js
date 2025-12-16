const redis = require('redis');

// Sử dụng REDIS_URL nếu có, nếu không fallback về host/port với password
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
};

// Thêm password nếu được cung cấp
if (process.env.REDIS_PASSWORD) {
  redisConfig.password = process.env.REDIS_PASSWORD;
}

const redisClient = redis.createClient(redisConfig);


redisClient.on('connect', () => {
  // ✅ Log sẽ ở index.js
});

redisClient.on('error', (err) => {
  console.error('❌ Lỗi kết nối Redis:', err);
});

// Kết nối ngay khi import
redisClient.connect().catch((err) => {
  console.error('❌ Kết nối Redis ban đầu thất bại:', err);
});

module.exports = redisClient;

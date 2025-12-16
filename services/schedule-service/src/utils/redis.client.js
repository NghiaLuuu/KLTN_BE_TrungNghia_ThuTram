const redis = require('redis');

// Debug biến môi trường
console.log('🔍 Debug Redis Env:');
console.log('   REDIS_URL:', process.env.REDIS_URL);
console.log('   REDIS_HOST:', process.env.REDIS_HOST);
console.log('   REDIS_PORT:', process.env.REDIS_PORT);
console.log('   REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***' : 'NOT SET');

// Sử dụng REDIS_URL nếu có, nếu không thì fallback sang host/port với password
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
};

// Thêm password nếu có
if (process.env.REDIS_PASSWORD) {
  redisConfig.password = process.env.REDIS_PASSWORD;
}

console.log('🔧 schedule-service - Redis Config:', {
  url: redisConfig.url,
  hasPassword: !!redisConfig.password
});

const redisClient = redis.createClient(redisConfig);


redisClient.on('connect', () => {
  console.log('✅ Redis connected');
});

redisClient.on('error', (err) => {
  console.error('❌ Redis connection error:', err);
});

// Kết nối ngay khi import
redisClient.connect().catch((err) => {
  console.error('❌ Redis initial connection failed:', err);
});

module.exports = redisClient;

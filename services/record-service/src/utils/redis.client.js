const redis = require('redis');

// Debug các biến môi trường
console.log('🔍 Debug Redis Env:');
console.log('   REDIS_URL:', process.env.REDIS_URL);
console.log('   REDIS_HOST:', process.env.REDIS_HOST);
console.log('   REDIS_PORT:', process.env.REDIS_PORT);
console.log('   REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***' : 'NOT SET');

// Sử dụng REDIS_URL nếu có, nếu không thì dùng host/port với password
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
};

// Thêm password nếu được cung cấp
if (process.env.REDIS_PASSWORD) {
  redisConfig.password = process.env.REDIS_PASSWORD;
}

console.log('🔧 record-service - Redis Config:', {
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

// Hàm hỗ trợ để xóa các key theo pattern
redisClient.delPattern = async function(pattern) {
  let cursor = '0';
  let deletedCount = 0;
  
  do {
    const reply = await this.scan(cursor, {
      MATCH: pattern,
      COUNT: 100
    });
    
    cursor = reply.cursor;
    const keys = reply.keys;
    
    if (keys.length > 0) {
      await this.del(keys);
      deletedCount += keys.length;
    }
  } while (cursor !== '0');
  
  console.log(`🗑️ Deleted ${deletedCount} keys matching pattern: ${pattern}`);
  return deletedCount;
};

module.exports = redisClient;

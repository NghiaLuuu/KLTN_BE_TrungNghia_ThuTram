const redis = require('redis');

// Debug environment variables
console.log('🔍 Debug Redis Env:');
console.log('   REDIS_URL:', process.env.REDIS_URL);
console.log('   REDIS_HOST:', process.env.REDIS_HOST);
console.log('   REDIS_PORT:', process.env.REDIS_PORT);
console.log('   REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***' : 'NOT SET');

// Use REDIS_URL if available, otherwise fallback to host/port with password
const redisConfig = {
  url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
};

// Add password if provided
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

// Helper function to delete keys by pattern
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

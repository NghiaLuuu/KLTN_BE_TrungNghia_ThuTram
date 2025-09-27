const redis = require('redis');

// Singleton Redis client
let clientInstance = null;

function createRedisClient() {
  if (clientInstance) {
    return clientInstance;
  }

  // Debug environment variables (only show once)
  console.log('🔍 Debug Redis Env:');
  console.log('   REDIS_URL:', process.env.REDIS_URL);
  console.log('   REDIS_HOST:', process.env.REDIS_HOST);
  console.log('   REDIS_PORT:', process.env.REDIS_PORT);
  console.log('   REDIS_PASSWORD:', process.env.REDIS_PASSWORD ? '***' : 'NOT SET');

  // Use simple Redis URL without password
  const redisConfig = {
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
  };

  console.log('🔧 auth-service - Redis Config:', {
    url: redisConfig.url,
    hasPassword: false
  });

  clientInstance = redis.createClient(redisConfig);
  
  return clientInstance;
}

const redisClient = createRedisClient();


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

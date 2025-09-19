const redis = require('redis');

let client;

const connectRedis = async () => {
  try {
    client = redis.createClient({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: process.env.REDIS_PORT || 6379,
    });

    client.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    client.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    await client.connect();
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    // Don't exit process, continue without cache
  }
};

const getRedisClient = () => {
  return client;
};

// Helper functions
const get = async (key) => {
  try {
    if (!client || !client.isOpen) return null;
    return await client.get(key);
  } catch (error) {
    console.error('❌ Redis GET error:', error);
    return null;
  }
};

const set = async (key, value, ...args) => {
  try {
    if (!client || !client.isOpen) return false;
    return await client.set(key, value, ...args);
  } catch (error) {
    console.error('❌ Redis SET error:', error);
    return false;
  }
};

const del = async (key) => {
  try {
    if (!client || !client.isOpen) return false;
    return await client.del(key);
  } catch (error) {
    console.error('❌ Redis DEL error:', error);
    return false;
  }
};

// Initialize Redis connection
connectRedis();

module.exports = {
  getRedisClient,
  get,
  set,
  del
};

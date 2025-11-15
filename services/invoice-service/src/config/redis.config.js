const redis = require('redis');

class RedisClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Support both REDIS_URL (production) and REDIS_HOST/PORT (development)
      const redisConfig = process.env.REDIS_URL 
        ? { url: process.env.REDIS_URL }
        : {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || undefined,
            db: process.env.REDIS_DB || 0,
          };

      this.client = redis.createClient({
        ...redisConfig,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            console.log('Redis server refused connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.client.on('connect', () => {
        console.log('🔗 Redis client connected');
        this.isConnected = true;
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis client error:', err.message);
        this.isConnected = false;
      });

      this.client.on('end', () => {
        console.log('🔌 Redis connection closed');
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error('❌ Redis connection failed:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.quit();
        console.log('✅ Redis disconnected gracefully');
      }
    } catch (error) {
      console.error('❌ Error disconnecting Redis:', error.message);
    }
  }

  // Get value by key
  async get(key) {
    try {
      if (!this.isConnected) return null;
      return await this.client.get(key);
    } catch (error) {
      console.error('❌ Redis GET error:', error.message);
      return null;
    }
  }

  // Set value with optional expiration
  async set(key, value, ttl = null) {
    try {
      if (!this.isConnected) return false;
      
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch (error) {
      console.error('❌ Redis SET error:', error.message);
      return false;
    }
  }

  // Set value with expiration in seconds
  async setex(key, seconds, value) {
    try {
      if (!this.isConnected) return false;
      await this.client.setEx(key, seconds, value);
      return true;
    } catch (error) {
      console.error('❌ Redis SETEX error:', error.message);
      return false;
    }
  }

  // Delete key(s)
  async del(...keys) {
    try {
      if (!this.isConnected) return 0;
      return await this.client.del(keys);
    } catch (error) {
      console.error('❌ Redis DEL error:', error.message);
      return 0;
    }
  }

  // Check if key exists
  async exists(key) {
    try {
      if (!this.isConnected) return false;
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('❌ Redis EXISTS error:', error.message);
      return false;
    }
  }

  // Get keys matching pattern
  async keys(pattern) {
    try {
      if (!this.isConnected) return [];
      return await this.client.keys(pattern);
    } catch (error) {
      console.error('❌ Redis KEYS error:', error.message);
      return [];
    }
  }

  // Set expiration on existing key
  async expire(key, seconds) {
    try {
      if (!this.isConnected) return false;
      const result = await this.client.expire(key, seconds);
      return result === 1;
    } catch (error) {
      console.error('❌ Redis EXPIRE error:', error.message);
      return false;
    }
  }

  // Increment value
  async incr(key) {
    try {
      if (!this.isConnected) return 0;
      return await this.client.incr(key);
    } catch (error) {
      console.error('❌ Redis INCR error:', error.message);
      return 0;
    }
  }

  // Hash operations
  async hget(key, field) {
    try {
      if (!this.isConnected) return null;
      return await this.client.hGet(key, field);
    } catch (error) {
      console.error('❌ Redis HGET error:', error.message);
      return null;
    }
  }

  async hset(key, field, value) {
    try {
      if (!this.isConnected) return false;
      await this.client.hSet(key, field, value);
      return true;
    } catch (error) {
      console.error('❌ Redis HSET error:', error.message);
      return false;
    }
  }

  async hgetall(key) {
    try {
      if (!this.isConnected) return {};
      return await this.client.hGetAll(key);
    } catch (error) {
      console.error('❌ Redis HGETALL error:', error.message);
      return {};
    }
  }

  // List operations
  async lpush(key, ...values) {
    try {
      if (!this.isConnected) return 0;
      return await this.client.lPush(key, values);
    } catch (error) {
      console.error('❌ Redis LPUSH error:', error.message);
      return 0;
    }
  }

  async rpop(key) {
    try {
      if (!this.isConnected) return null;
      return await this.client.rPop(key);
    } catch (error) {
      console.error('❌ Redis RPOP error:', error.message);
      return null;
    }
  }

  // Clear all cache (use with caution)
  async flushall() {
    try {
      if (!this.isConnected) return false;
      await this.client.flushAll();
      console.log('🧹 Redis cache cleared');
      return true;
    } catch (error) {
      console.error('❌ Redis FLUSHALL error:', error.message);
      return false;
    }
  }

  // Get connection status
  getStatus() {
    return {
      connected: this.isConnected,
      ready: this.client?.ready || false
    };
  }

  // Graceful cache operations with fallback
  async safeGet(key, fallback = null) {
    try {
      const value = await this.get(key);
      return value !== null ? value : fallback;
    } catch (error) {
      console.warn(`⚠️ Redis GET fallback for key ${key}:`, error.message);
      return fallback;
    }
  }

  async safeSet(key, value, ttl = null) {
    try {
      return await this.set(key, value, ttl);
    } catch (error) {
      console.warn(`⚠️ Redis SET failed for key ${key}:`, error.message);
      return false;
    }
  }
}

// Create singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;
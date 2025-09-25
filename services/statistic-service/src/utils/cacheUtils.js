const redisClient = require('../config/redis.config');

class CacheUtils {
  /**
   * Generate cache key for statistics
   */
  static generateKey(type, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('|');
    
    return `stats:${type}:${sortedParams}`;
  }

  /**
   * Get cached statistics
   */
  static async get(key) {
    try {
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set cached statistics
   */
  static async set(key, data, ttl = 3600) {
    try {
      await redisClient.setEx(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete cached statistics
   */
  static async del(pattern) {
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Clear all statistics cache
   */
  static async clearStatsCache() {
    return this.del('stats:*');
  }

  /**
   * Get or set cached data
   */
  static async getOrSet(key, fetchFunction, ttl = 3600) {
    let data = await this.get(key);
    
    if (!data) {
      data = await fetchFunction();
      await this.set(key, data, ttl);
    }
    
    return data;
  }
}

module.exports = CacheUtils;
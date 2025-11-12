/**
 * Rate Limiter Middleware - Chặn spam off-topic messages
 * Nếu user hỏi quá 3 lần nội dung không liên quan → chặn 1 phút
 */

const redis = require('redis');

// Create Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('❌ Redis connection failed after 10 retries');
        return new Error('Redis connection failed');
      }
      return Math.min(retries * 100, 3000);
    }
  }
});

// Connect to Redis
let isRedisConnected = false;
redisClient.connect()
  .then(() => {
    console.log('✅ Redis connected for rate limiting');
    isRedisConnected = true;
  })
  .catch(err => {
    console.error('❌ Redis connection error:', err);
    console.warn('⚠️  Rate limiting will be disabled');
  });

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
  isRedisConnected = false;
});

redisClient.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});

redisClient.on('ready', () => {
  console.log('✅ Redis ready');
  isRedisConnected = true;
});

/**
 * Check if user is blocked due to too many off-topic messages
 * @param {String} userId - User ID
 * @returns {Promise<Object>} { isBlocked: boolean, remainingTime: number }
 */
async function checkIfBlocked(userId) {
  if (!isRedisConnected) {
    return { isBlocked: false, remainingTime: 0 };
  }

  try {
    const blockKey = `offtopic_block:${userId}`;
    const ttl = await redisClient.ttl(blockKey);
    
    if (ttl > 0) {
      return { isBlocked: true, remainingTime: ttl };
    }
    
    return { isBlocked: false, remainingTime: 0 };
  } catch (error) {
    console.error('❌ Redis checkIfBlocked error:', error);
    return { isBlocked: false, remainingTime: 0 };
  }
}

/**
 * Increment off-topic count and block if exceeds limit
 * @param {String} userId - User ID
 * @returns {Promise<Object>} { count: number, isBlocked: boolean, remainingTime: number }
 */
async function incrementOffTopicCount(userId) {
  if (!isRedisConnected) {
    return { count: 0, isBlocked: false, remainingTime: 0 };
  }

  try {
    const countKey = `offtopic_count:${userId}`;
    const blockKey = `offtopic_block:${userId}`;
    
    // Increment count
    const count = await redisClient.incr(countKey);
    
    // Set expiry for count key (5 minutes window)
    if (count === 1) {
      await redisClient.expire(countKey, 300); // 5 phút
    }
    
    console.log(`📊 User ${userId} off-topic count: ${count}/3`);
    
    // Check if exceeds limit (3 times)
    if (count >= 3) {
      // Block for 1 minute
      await redisClient.setEx(blockKey, 60, 'blocked');
      // Reset count
      await redisClient.del(countKey);
      
      console.log(`🚫 User ${userId} blocked for 60 seconds due to 3 off-topic messages`);
      
      return { count, isBlocked: true, remainingTime: 60 };
    }
    
    return { count, isBlocked: false, remainingTime: 0 };
  } catch (error) {
    console.error('❌ Redis incrementOffTopicCount error:', error);
    return { count: 0, isBlocked: false, remainingTime: 0 };
  }
}

/**
 * Reset off-topic count (when user sends a valid dental-related message)
 * @param {String} userId - User ID
 */
async function resetOffTopicCount(userId) {
  if (!isRedisConnected) {
    return;
  }

  try {
    const countKey = `offtopic_count:${userId}`;
    await redisClient.del(countKey);
    console.log(`✅ User ${userId} off-topic count reset`);
  } catch (error) {
    console.error('❌ Redis resetOffTopicCount error:', error);
  }
}

/**
 * Express middleware to check rate limit before processing request
 */
async function rateLimiterMiddleware(req, res, next) {
  try {
    const userId = req.user?.userId || req.user?._id || 'anonymous';
    
    // Check if user is currently blocked
    const blockStatus = await checkIfBlocked(userId);
    
    if (blockStatus.isBlocked) {
      return res.status(429).json({
        success: false,
        message: `Bạn đã hỏi quá nhiều nội dung không liên quan đến nha khoa. Vui lòng chờ ${blockStatus.remainingTime} giây.`,
        isBlocked: true,
        remainingTime: blockStatus.remainingTime,
        timestamp: new Date().toISOString()
      });
    }
    
    // Attach helper functions to request
    req.rateLimit = {
      checkIfBlocked,
      incrementOffTopicCount,
      resetOffTopicCount
    };
    
    next();
  } catch (error) {
    console.error('❌ Rate limiter middleware error:', error);
    // Fail open - allow request if rate limiter fails
    next();
  }
}

module.exports = {
  rateLimiterMiddleware,
  checkIfBlocked,
  incrementOffTopicCount,
  resetOffTopicCount,
  redisClient
};

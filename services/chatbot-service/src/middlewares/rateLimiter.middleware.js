/**
 * Middleware giới hạn tọn suất - Chặn spam tin nhắn off-topic
 * Nếu user hỏi quá 3 lần nội dung không liên quan → chặn 1 phút
 */

const redis = require('redis');

// Tạo Redis client
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

// Kết nối đến Redis
let isRedisConnected = false;
redisClient.connect()
  .then(() => {
    console.log('✅ Đã kết nối Redis cho giới hạn tọn suất');
    isRedisConnected = true;
  })
  .catch(err => {
    console.error('❌ Lỗi kết nối Redis:', err);
    console.warn('⚠️  Giới hạn tọn suất sẽ bị vô hiệu hóa');
  });

redisClient.on('error', (err) => {
  console.error('Lỗi Redis Client:', err);
  isRedisConnected = false;
});

redisClient.on('reconnecting', () => {
  console.log('🔄 Đang kết nối lại Redis...');
});

redisClient.on('ready', () => {
  console.log('✅ Redis sẵn sàng');
  isRedisConnected = true;
});

/**
 * Kiểm tra xem user có bị chặn do gửi quá nhiều tin nhắn off-topic không
 * @param {String} userId - ID người dùng
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
 * Tăng số lần off-topic và chặn nếu vượt giới hạn
 * @param {String} userId - ID người dùng
 * @returns {Promise<Object>} { count: number, isBlocked: boolean, remainingTime: number }
 */
async function incrementOffTopicCount(userId) {
  if (!isRedisConnected) {
    return { count: 0, isBlocked: false, remainingTime: 0 };
  }

  try {
    const countKey = `offtopic_count:${userId}`;
    const blockKey = `offtopic_block:${userId}`;
    
    // Tăng số đếm
    const count = await redisClient.incr(countKey);
    
    // Đặt thời gian hết hạn cho key số đếm (cửa sổ 5 phút)
    if (count === 1) {
      await redisClient.expire(countKey, 300); // 5 phút
    }
    
    console.log(`📊 User ${userId} số lần off-topic: ${count}/3`);
    
    // Kiểm tra xem có vượt giới hạn (3 lần) không
    if (count >= 3) {
      // Chặn trong 1 phút
      await redisClient.setEx(blockKey, 60, 'blocked');
      // Reset số đếm
      await redisClient.del(countKey);
      
      console.log(`🚫 User ${userId} bị chặn 60 giây do 3 tin nhắn off-topic`);
      
      return { count, isBlocked: true, remainingTime: 60 };
    }
    
    return { count, isBlocked: false, remainingTime: 0 };
  } catch (error) {
    console.error('❌ Redis incrementOffTopicCount error:', error);
    return { count: 0, isBlocked: false, remainingTime: 0 };
  }
}

/**
 * Reset số lần off-topic (khi user gửi tin nhắn liên quan đến nha khoa hợp lệ)
 * @param {String} userId - ID người dùng
 */
async function resetOffTopicCount(userId) {
  if (!isRedisConnected) {
    return;
  }

  try {
    const countKey = `offtopic_count:${userId}`;
    await redisClient.del(countKey);
    console.log(`✅ Đã reset số lần off-topic của user ${userId}`);
  } catch (error) {
    console.error('❌ Redis resetOffTopicCount error:', error);
  }
}

/**
 * Middleware Express để kiểm tra giới hạn tọn suất trước khi xử lý request
 */
async function rateLimiterMiddleware(req, res, next) {
  try {
    const userId = req.user?.userId || req.user?._id || 'anonymous';
    
    // Kiểm tra xem user hiện tại có bị chặn không
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
    
    // Gắn các hàm hỗ trợ vào request
    req.rateLimit = {
      checkIfBlocked,
      incrementOffTopicCount,
      resetOffTopicCount
    };
    
    next();
  } catch (error) {
    console.error('❌ Lỗi middleware giới hạn tọn suất:', error);
    // Fail open - cho phép request nếu rate limiter lỗi
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

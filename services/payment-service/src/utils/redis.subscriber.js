/**
 * @author: TrungNghia & ThuTram
 * Redis Keyspace Notifications Subscriber
 * Lắng nghe các key hết hạn để mở khóa slot khi thanh toán tạm hết hạn
 */

const redis = require('redis');
const rabbitmqClient = require('./rabbitmq.client');

class RedisSubscriber {
  constructor() {
    this.subscriber = null;
    this.isConnected = false;
  }

  async start() {
    try {
      // Tạo Redis client riêng để subscribe (chế độ pub/sub)
      const redisConfig = {
        url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      };

      if (process.env.REDIS_PASSWORD) {
        redisConfig.password = process.env.REDIS_PASSWORD;
      }

      this.subscriber = redis.createClient(redisConfig);

      this.subscriber.on('error', (err) => {
        console.error('❌ Lỗi Redis Subscriber:', err);
      });

      this.subscriber.on('connect', () => {
        console.log('✅ Redis Subscriber đã kết nối');
        this.isConnected = true;
      });

      await this.subscriber.connect();

      // Bật keyspace notifications cho các sự kiện hết hạn (Ex = expire events)
      await this.subscriber.configSet('notify-keyspace-events', 'Ex');
      console.log('✅ Đã bật Redis keyspace notifications (Ex)');

      // Subscribe các sự kiện key hết hạn cho database 0
      // Pattern: __keyevent@0__:expired
      await this.subscriber.pSubscribe('__keyevent@0__:expired', async (message, channel) => {
        console.log('='.repeat(60));
        console.log('🔔 [Sự Kiện Redis Hết Hạn] Key hết hạn:', message);
        console.log('='.repeat(60));

        // Kiểm tra key hết hạn có phải thanh toán tạm không
        if (message.startsWith('payment:temp:')) {
          await this.handlePaymentTemporaryExpired(message);
        }
      });

      console.log('👂 Redis Subscriber đang lắng nghe các key hết hạn...');
    } catch (error) {
      console.error('❌ Khởi động Redis subscriber thất bại:', error);
      throw error;
    }
  }

  /**
   * Xử lý thanh toán tạm hết hạn
   * @param {string} expiredKey - Key Redis hết hạn (ví dụ: "payment:temp:RSV123456")
   */
  async handlePaymentTemporaryExpired(expiredKey) {
    try {
      // Trích xuất reservation ID từ key: payment:temp:RSV123456 → RSV123456
      const reservationId = expiredKey.replace('payment:temp:', '');

      console.log('💳 [Thanh Toán Tạm Hết Hạn]');
      console.log('   → Reservation ID:', reservationId);
      console.log('   → Key Hết Hạn:', expiredKey);

      // Kiểm tra reservation còn tồn tại không
      const reservationKey = reservationId; // Có thể chỉ là "RSV123456" hoặc có prefix
      const possibleKeys = [
        reservationKey,
        `appointment_hold:${reservationKey}`,
        `reservation:${reservationKey}`,
        `temp_reservation:${reservationKey}`
      ];

      let reservationData = null;
      let foundKey = null;

      // Thử tìm dữ liệu reservation
      const redisClient = require('./redis.client');
      for (const key of possibleKeys) {
        try {
          const data = await redisClient.get(key);
          if (data) {
            reservationData = JSON.parse(data);
            foundKey = key;
            console.log('✅ Tìm thấy dữ liệu reservation trong Redis:', foundKey);
            break;
          }
        } catch (err) {
          // Tiếp tục với key tiếp theo
        }
      }

      if (!reservationData) {
        console.log('⚠️  Không tìm thấy dữ liệu reservation trong Redis (có thể đã xử lý)');
        // Vẫn cố gắng mở khóa slots bằng reservationId
      }

      // Lấy slot IDs từ dữ liệu reservation
      let slotIds = [];
      if (reservationData && reservationData.slotIds) {
        slotIds = reservationData.slotIds;
      }

      console.log('🔓 [Đang Mở Khóa Slots]');
      console.log('   → Slot IDs:', slotIds);
      console.log('   → Số lượng:', slotIds.length);

      // Phát sự kiện đến schedule-service để mở khóa slots
      const unlockEvent = {
        event: 'reservation.expired',
        data: {
          reservationId: reservationId,
          slotIds: slotIds,
          expiredAt: new Date().toISOString(),
          reason: 'Thanh toán tạm hết hạn (timeout 3 phút)'
        }
      };

      console.log('📤 [Đang Phát Sự Kiện] reservation.expired');
      console.log('   → Queue đích: schedule_queue');
      console.log('   → Payload:', unlockEvent);

      await rabbitmqClient.publishToQueue('schedule_queue', unlockEvent);

      console.log('✅ [Thành công] Đã phát sự kiện mở khóa');
      console.log('='.repeat(60));

      // Dọn dẹp dữ liệu reservation từ Redis
      if (foundKey) {
        await redisClient.del(foundKey);
        console.log('🧹 Đã dọn dẹp dữ liệu reservation:', foundKey);
      }

    } catch (error) {
      console.error('❌ Lỗi xử lý thanh toán tạm hết hạn:', error);
      console.error('   Stack:', error.stack);
    }
  }

  async stop() {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.isConnected = false;
      console.log('👋 Redis Subscriber đã dừng');
    }
  }
}

// Tạo singleton instance
const redisSubscriber = new RedisSubscriber();

module.exports = redisSubscriber;

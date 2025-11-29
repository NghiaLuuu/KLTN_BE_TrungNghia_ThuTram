/**
 * @author: TrungNghia & ThuTram
 * Redis Keyspace Notifications Subscriber
 * Listen for expired keys to unlock slots when payment temporary expires
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
      // Create separate Redis client for subscribing (pub/sub mode)
      const redisConfig = {
        url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`,
      };

      if (process.env.REDIS_PASSWORD) {
        redisConfig.password = process.env.REDIS_PASSWORD;
      }

      this.subscriber = redis.createClient(redisConfig);

      this.subscriber.on('error', (err) => {
        console.error('❌ Redis Subscriber error:', err);
      });

      this.subscriber.on('connect', () => {
        console.log('✅ Redis Subscriber connected');
        this.isConnected = true;
      });

      await this.subscriber.connect();

      // Enable keyspace notifications for expired events (Ex = expire events)
      await this.subscriber.configSet('notify-keyspace-events', 'Ex');
      console.log('✅ Redis keyspace notifications enabled (Ex)');

      // Subscribe to expired key events for database 0
      // Pattern: __keyevent@0__:expired
      await this.subscriber.pSubscribe('__keyevent@0__:expired', async (message, channel) => {
        console.log('='.repeat(60));
        console.log('🔔 [Redis Expired Event] Key expired:', message);
        console.log('='.repeat(60));

        // Check if expired key is a temporary payment
        if (message.startsWith('payment:temp:')) {
          await this.handlePaymentTemporaryExpired(message);
        }
      });

      console.log('👂 Redis Subscriber listening for expired keys...');
    } catch (error) {
      console.error('❌ Failed to start Redis subscriber:', error);
      throw error;
    }
  }

  /**
   * Handle payment temporary expiration
   * @param {string} expiredKey - The expired Redis key (e.g., "payment:temp:RSV123456")
   */
  async handlePaymentTemporaryExpired(expiredKey) {
    try {
      // Extract reservation ID from key: payment:temp:RSV123456 → RSV123456
      const reservationId = expiredKey.replace('payment:temp:', '');

      console.log('💳 [Payment Temporary Expired]');
      console.log('   → Reservation ID:', reservationId);
      console.log('   → Expired Key:', expiredKey);

      // Check if reservation still exists
      const reservationKey = reservationId; // Could be just "RSV123456" or with prefix
      const possibleKeys = [
        reservationKey,
        `appointment_hold:${reservationKey}`,
        `reservation:${reservationKey}`,
        `temp_reservation:${reservationKey}`
      ];

      let reservationData = null;
      let foundKey = null;

      // Try to find reservation data
      const redisClient = require('./redis.client');
      for (const key of possibleKeys) {
        try {
          const data = await redisClient.get(key);
          if (data) {
            reservationData = JSON.parse(data);
            foundKey = key;
            console.log('✅ Found reservation data in Redis:', foundKey);
            break;
          }
        } catch (err) {
          // Continue to next key
        }
      }

      if (!reservationData) {
        console.log('⚠️  Reservation data not found in Redis (might be already processed)');
        // Still try to unlock slots by reservationId
      }

      // Get slot IDs from reservation data
      let slotIds = [];
      if (reservationData && reservationData.slotIds) {
        slotIds = reservationData.slotIds;
      }

      console.log('🔓 [Unlocking Slots]');
      console.log('   → Slot IDs:', slotIds);
      console.log('   → Count:', slotIds.length);

      // Publish event to schedule-service to unlock slots
      const unlockEvent = {
        event: 'reservation.expired',
        data: {
          reservationId: reservationId,
          slotIds: slotIds,
          expiredAt: new Date().toISOString(),
          reason: 'Payment temporary expired (3 minutes timeout)'
        }
      };

      console.log('📤 [Publishing Event] reservation.expired');
      console.log('   → Target Queue: schedule_queue');
      console.log('   → Payload:', unlockEvent);

      await rabbitmqClient.publishToQueue('schedule_queue', unlockEvent);

      console.log('✅ [Success] Unlock event published');
      console.log('='.repeat(60));

      // Cleanup reservation data from Redis
      if (foundKey) {
        await redisClient.del(foundKey);
        console.log('🧹 Cleaned up reservation data:', foundKey);
      }

    } catch (error) {
      console.error('❌ Error handling payment temporary expiration:', error);
      console.error('   Stack:', error.stack);
    }
  }

  async stop() {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.isConnected = false;
      console.log('👋 Redis Subscriber stopped');
    }
  }
}

// Create singleton instance
const redisSubscriber = new RedisSubscriber();

module.exports = redisSubscriber;

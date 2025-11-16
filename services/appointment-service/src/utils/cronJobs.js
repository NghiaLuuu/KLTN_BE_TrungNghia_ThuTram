const cron = require('node-cron');
const Appointment = require('../models/appointment.model');
const axios = require('axios');
// const Record = require('../models/record.model'); // If needed

/**
 * ❌ REMOVED: Auto-progress cron (replaced by Socket.IO event on check-in)
 * Reason: Event-driven is more efficient and real-time
 */

/**
 * ❌ REMOVED: Auto-complete cron (replaced by Socket.IO event on doctor complete)
 * Reason: Event-driven is more efficient and real-time
 */

/**
 * Cleanup expired slot locks (locked > 15 minutes)
 * Runs every 5 minutes
 */
function startCleanupExpiredLocksCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

      // console.log('🔍 [Cron] Checking for expired slot locks...');

      // Call schedule-service to get all locked slots
      const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      const response = await axios.get(`${scheduleServiceUrl}/api/slot/locked`);

      if (!response.data || !response.data.success || !response.data.slots) {
        console.log('⚠️ [Cron] No locked slots found or API error');
        return;
      }

      const lockedSlots = response.data.slots;

      // Filter expired slots (locked > 15 minutes ago)
      const expiredSlots = lockedSlots.filter(slot => {
        return slot.lockedAt && new Date(slot.lockedAt) < fifteenMinutesAgo;
      });

      if (expiredSlots.length === 0) {
        // console.log('✅ [Cron] No expired slot locks found');
        return;
      }

      console.log(`⚠️ [Cron] Found ${expiredSlots.length} expired slot locks`);

      // Unlock expired slots
      const slotIds = expiredSlots.map(slot => slot._id);
      await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
        slotIds,
        updates: {
          status: 'available',
          lockedAt: null,
          lockedBy: null
        }
      });

      console.log(`✅ [Cron] Unlocked ${expiredSlots.length} expired slots:`, slotIds);

    } catch (error) {
      console.error('❌ [Cron] Error in cleanup expired locks job:', error.message);
    }
  });

  console.log('⏰ Cron job started: Cleanup expired slot locks (15 min)');
}

/**
 * Start essential cron jobs only
 * Note: Auto-progress and auto-complete removed (replaced by Socket.IO)
 */
function startAllCronJobs() {
  startCleanupExpiredLocksCron();
  console.log('✅ Essential cron jobs started (cleanup only)');
  console.log('ℹ️  Auto-progress and auto-complete now handled by Socket.IO events');
}

module.exports = {
  startAllCronJobs,
  startCleanupExpiredLocksCron
};

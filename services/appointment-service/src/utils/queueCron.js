const cron = require('node-cron');
const queueService = require('../services/queue.service');

/**
 * Setup cron jobs for queue management
 */
function setupQueueCronJobs() {
  // Run every minute to check if appointments should start
  cron.schedule('* * * * *', async () => {
    try {
      await queueService.autoStartAppointments();
    } catch (error) {
      console.error('❌ [Cron] Auto-start failed:', error);
    }
  });

  console.log('⏰ Queue cron jobs started (auto-start every minute)');
}

module.exports = {
  setupQueueCronJobs
};

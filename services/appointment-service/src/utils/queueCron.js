const cron = require('node-cron');
const queueService = require('../services/queue.service');

/**
 * Setup cron jobs for queue management
 */
function setupQueueCronJobs() {
  // ✅ KHÔNG CẦN AUTO-START NỮA
  // Tất cả appointment đã có status 'in-progress' ngay khi check-in
  // Cron job này có thể dùng cho các tasks khác trong tương lai
  
  // Run every minute for future queue management tasks
  cron.schedule('* * * * *', async () => {
    try {
      // Placeholder for future queue management tasks
      // Example: Check for overdue appointments, send reminders, etc.
      // console.log('⏰ [Cron] Queue check running...');
    } catch (error) {
      console.error('❌ [Cron] Queue check failed:', error);
    }
  });

  console.log('⏰ Queue cron jobs started');
}

module.exports = {
  setupQueueCronJobs
};

const cron = require('node-cron');
const queueService = require('../services/queue.service');

/**
 * Thiết lập các cron jobs cho quản lý hàng đợi
 * Chạy các tác vụ định kỳ liên quan đến hàng đợi phòng khám
 */
function setupQueueCronJobs() {
  // ✅ KHÔNG CẦN AUTO-START NỮA
  // Tất cả appointment đã có status 'in-progress' ngay khi check-in
  // Cron job này có thể dùng cho các tasks khác trong tương lai
  
  // Chạy mỗi phút cho các tác vụ quản lý hàng đợi tương lai
  cron.schedule('* * * * *', async () => {
    try {
      // Placeholder cho các tác vụ quản lý hàng đợi tương lai
      // Ví dụ: Kiểm tra lịch hẹn quá hạn, gửi nhắc nhở, v.v.
      // console.log('⏰ [Cron] Đang kiểm tra hàng đợi...');
    } catch (error) {
      console.error('❌ [Cron] Kiểm tra hàng đợi thất bại:', error);
    }
  });

  console.log('⏰ Các cron jobs hàng đợi đã khởi động');
}

module.exports = {
  setupQueueCronJobs
};

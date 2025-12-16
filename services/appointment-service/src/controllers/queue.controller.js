const queueService = require('../services/queue.service');

class QueueController {
  /**
   * GET /api/appointment/queue
   * Lấy hàng đợi cho tất cả phòng hoặc phòng cụ thể
   */
  async getQueue(req, res) {
    try {
      const { roomId } = req.query;
      
      const queue = await queueService.getQueue(roomId);
      
      res.json({
        success: true,
        data: queue
      });
    } catch (error) {
      console.error('❌ [QueueController] Lỗi getQueue:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * GET /api/appointment/queue/stats
   * Lấy thống kê hàng đợi
   */
  async getQueueStats(req, res) {
    try {
      const stats = await queueService.getQueueStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('❌ [QueueController] Lỗi getQueueStats:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * POST /api/appointment/queue/auto-start
   * Kích hoạt kiểm tra auto-start thủ công (cho testing)
   */
  async triggerAutoStart(req, res) {
    try {
      if (typeof queueService.autoStartAppointments !== 'function') {
        return res.json({
          success: true,
          message: 'Logic auto-start bị vô hiệu hóa. Hàng đợi cập nhật dựa trên thay đổi trạng thái record.'
        });
      }

      const activated = await queueService.autoStartAppointments();
      
      res.json({
        success: true,
        message: `Đã auto-start ${activated.length} lịch hẹn`,
        data: activated.map(apt => ({
          appointmentCode: apt.appointmentCode,
          patientName: apt.patientInfo.name,
          roomName: apt.roomName,
          startTime: apt.startTime
        }))
      });
    } catch (error) {
      console.error('❌ [QueueController] Lỗi triggerAutoStart:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new QueueController();

const queueService = require('../services/queue.service');

class QueueController {
  /**
   * GET /api/appointment/queue
   * Get queue for all rooms or specific room
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
      console.error('❌ [QueueController] getQueue error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * GET /api/appointment/queue/stats
   * Get queue statistics
   */
  async getQueueStats(req, res) {
    try {
      const stats = await queueService.getQueueStats();
      
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      console.error('❌ [QueueController] getQueueStats error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  /**
   * POST /api/appointment/queue/auto-start
   * Manually trigger auto-start check (for testing)
   */
  async triggerAutoStart(req, res) {
    try {
      const activated = await queueService.autoStartAppointments();
      
      res.json({
        success: true,
        message: `Auto-started ${activated.length} appointments`,
        data: activated.map(apt => ({
          appointmentCode: apt.appointmentCode,
          patientName: apt.patientInfo.name,
          roomName: apt.roomName,
          startTime: apt.startTime
        }))
      });
    } catch (error) {
      console.error('❌ [QueueController] triggerAutoStart error:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

module.exports = new QueueController();

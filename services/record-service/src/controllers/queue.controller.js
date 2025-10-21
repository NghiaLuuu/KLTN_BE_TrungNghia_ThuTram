const queueService = require('../services/queue.service');

class QueueController {
  /**
   * Get next queue number for a room
   * GET /api/record/queue/next-number?date=YYYY-MM-DD&roomId=xxx&subroomId=xxx
   */
  async getNextQueueNumber(req, res) {
    try {
      const { date, roomId, subroomId } = req.query;

      if (!date || !roomId) {
        return res.status(400).json({
          success: false,
          message: 'date and roomId are required'
        });
      }

      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format'
        });
      }

      const nextNumber = await queueService.getNextQueueNumber(dateObj, roomId, subroomId);

      return res.status(200).json({
        success: true,
        data: {
          nextQueueNumber: nextNumber,
          date: dateObj,
          roomId,
          subroomId: subroomId || null
        }
      });
    } catch (error) {
      console.error('Error getting next queue number:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get next queue number'
      });
    }
  }

  /**
   * Call a record - assign queue number and update status to in_progress
   * POST /api/record/:recordId/call
   */
  async callRecord(req, res) {
    try {
      const { recordId } = req.params;
      const userId = req.user?.userId || req.user?._id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const record = await queueService.callRecord(recordId, userId);

      return res.status(200).json({
        success: true,
        message: 'Record called successfully',
        data: record
      });
    } catch (error) {
      console.error('Error calling record:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to call record'
      });
    }
  }

  /**
   * Complete a record - update status to completed and return payment data
   * POST /api/record/:recordId/complete
   */
  async completeRecord(req, res) {
    try {
      const { recordId } = req.params;
      const userId = req.user?.userId || req.user?._id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const result = await queueService.completeRecord(recordId, userId);

      return res.status(200).json({
        success: true,
        message: 'Record completed successfully',
        data: result
      });
    } catch (error) {
      console.error('Error completing record:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to complete record'
      });
    }
  }

  /**
   * Cancel a record - update status to cancelled
   * POST /api/record/:recordId/cancel
   * Body: { reason: string }
   */
  async cancelRecord(req, res) {
    try {
      const { recordId } = req.params;
      const { reason } = req.body;
      const userId = req.user?.userId || req.user?._id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      if (!reason || reason.trim() === '') {
        return res.status(400).json({
          success: false,
          message: 'Cancellation reason is required'
        });
      }

      const record = await queueService.cancelRecord(recordId, userId, reason);

      return res.status(200).json({
        success: true,
        message: 'Record cancelled successfully',
        data: record
      });
    } catch (error) {
      console.error('Error cancelling record:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to cancel record'
      });
    }
  }

  /**
   * Get queue status for a room
   * GET /api/record/queue/status?date=YYYY-MM-DD&roomId=xxx&subroomId=xxx
   */
  async getQueueStatus(req, res) {
    try {
      const { date, roomId, subroomId } = req.query;

      if (!date || !roomId) {
        return res.status(400).json({
          success: false,
          message: 'date and roomId are required'
        });
      }

      const dateObj = new Date(date);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format'
        });
      }

      const queueStatus = await queueService.getQueueStatus(dateObj, roomId, subroomId);

      return res.status(200).json({
        success: true,
        data: queueStatus
      });
    } catch (error) {
      console.error('Error getting queue status:', error);
      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to get queue status'
      });
    }
  }
}

module.exports = new QueueController();

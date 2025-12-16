const cashPaymentService = require('../services/cashPayment.service');

class CashPaymentController {
  /**
   * Xác nhận thanh toán tiền mặt
   * POST /api/payment/:paymentId/confirm-cash
   */
  async confirmCashPayment(req, res) {
    try {
      const { paymentId } = req.params;
      const userId = req.user?.userId || req.user?._id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized'
        });
      }

      const result = await cashPaymentService.confirmCashPayment(paymentId, userId);

      return res.status(200).json({
        success: true,
        message: result.message,
        data: result.payment
      });
    } catch (error) {
      console.error('Error confirming cash payment:', error);
      
      if (error.name === 'NotFoundError') {
        return res.status(404).json({
          success: false,
          message: error.message
        });
      }

      if (error.name === 'BadRequestError') {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }

      return res.status(500).json({
        success: false,
        message: error.message || 'Failed to confirm cash payment'
      });
    }
  }
}

module.exports = new CashPaymentController();

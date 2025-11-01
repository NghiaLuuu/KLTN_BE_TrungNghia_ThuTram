const paymentRepository = require('../repositories/payment.repository');
const { PaymentMethod, PaymentStatus } = require('../models/payment.model');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const rabbitmqClient = require('../utils/rabbitmq.client');

class CashPaymentService {
  /**
   * Confirm cash payment and trigger invoice creation
   * @param {String} paymentId - Payment ID
   * @param {String} confirmedBy - User ID who confirms the payment
   * @returns {Object} { payment, message }
   */
  async confirmCashPayment(paymentId, confirmedBy) {
    try {
      // Get payment
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new NotFoundError('Không tìm thấy thanh toán');
      }

      // Validate payment status
      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestError(`Thanh toán đang ở trạng thái ${payment.status}, không thể xác nhận`);
      }

      // Validate payment method is cash
      if (payment.method !== PaymentMethod.CASH) {
        throw new BadRequestError('Chỉ có thể xác nhận thanh toán tiền mặt');
      }

      // Update payment status to completed
      const updatedPayment = await paymentRepository.updateStatus(paymentId, PaymentStatus.COMPLETED, {
        completedAt: new Date(),
        verifiedBy: confirmedBy,
        verifiedAt: new Date(),
        isVerified: true
      });

      // Publish event to invoice queue to create invoice
      await rabbitmqClient.publishToQueue('invoice_queue', {
        event: 'payment.completed.cash',
        data: {
          paymentId: payment._id.toString(),
          paymentCode: payment.paymentCode,
          amount: payment.finalAmount,
          method: payment.method,
          patientId: payment.patientId,
          patientInfo: payment.patientInfo,
          appointmentId: payment.appointmentId,
          recordId: payment.recordId,
          type: payment.type,
          confirmedBy: confirmedBy
        }
      });

      return {
        payment: updatedPayment,
        message: 'Thanh toán tiền mặt đã được xác nhận. Hóa đơn đang được tạo.'
      };
    } catch (error) {
      console.error('Error confirming cash payment:', error);
      throw error;
    }
  }
}

module.exports = new CashPaymentService();

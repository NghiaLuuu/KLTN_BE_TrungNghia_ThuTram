const paymentRepository = require('../repositories/payment.repository');
const { PaymentMethod, PaymentStatus } = require('../models/payment.model');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const rabbitmqClient = require('../utils/rabbitmq.client');

class CashPaymentService {
  /**
   * Xác nhận thanh toán tiền mặt và kích hoạt tạo hóa đơn
   * @param {String} paymentId - Mã thanh toán
   * @param {String} confirmedBy - Mã người dùng xác nhận thanh toán
   * @returns {Object} { payment, message }
   */
  async confirmCashPayment(paymentId, confirmedBy) {
    try {
      // Lấy thông tin thanh toán
      const payment = await paymentRepository.findById(paymentId);
      if (!payment) {
        throw new NotFoundError('Không tìm thấy thanh toán');
      }

      // Kiểm tra trạng thái thanh toán
      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestError(`Thanh toán đang ở trạng thái ${payment.status}, không thể xác nhận`);
      }

      // Kiểm tra phương thức thanh toán là tiền mặt
      if (payment.method !== PaymentMethod.CASH) {
        throw new BadRequestError('Chỉ có thể xác nhận thanh toán tiền mặt');
      }

      // Cập nhật trạng thái thanh toán thành completed
      const updatedPayment = await paymentRepository.updateStatus(paymentId, PaymentStatus.COMPLETED, {
        completedAt: new Date(),
        verifiedBy: confirmedBy,
        verifiedAt: new Date(),
        isVerified: true
      });

      // Publish sự kiện đến invoice queue để tạo hóa đơn
      await rabbitmqClient.publishToQueue('invoice_queue', {
        event: 'payment.completed.cash',
        data: {
          paymentId: payment._id.toString(),
          paymentCode: payment.paymentCode,
          amount: payment.finalAmount, // ✅ Đây là số tiền cần thanh toán (sau khi trừ đặt cọc)
          originalAmount: payment.originalAmount, // ✅ Số tiền dịch vụ gốc
          discountAmount: payment.discountAmount, // ✅ Số tiền đặt cọc (đã được trừ)
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

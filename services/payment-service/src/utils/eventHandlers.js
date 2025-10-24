const { Payment, PaymentStatus, PaymentType, PaymentMethod } = require('../models/payment.model');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Handle payment.create event from record-service
 * Auto-create payment request when record is completed
 */
async function handlePaymentCreate(eventData) {
  try {
    const { data } = eventData;
    
    console.log(`🔄 [handlePaymentCreate] Creating payment for record ${data.recordId}`);
    
    // Check if payment already exists for this record
    const existingPayment = await Payment.findOne({ recordId: data.recordId });
    if (existingPayment) {
      console.log(`⚠️ [handlePaymentCreate] Payment already exists for record ${data.recordId}: ${existingPayment.paymentCode}`);
      return;
    }
    
    // Prepare payment data
    const paymentData = {
      recordId: data.recordId,
      appointmentId: data.appointmentId || null,
      patientId: data.patientId || null,
      patientInfo: {
        name: data.patientInfo?.name || 'Unknown Patient',
        phone: data.patientInfo?.phone || '0000000000',
        email: data.patientInfo?.email || null,
        address: data.patientInfo?.address || null
      },
      type: PaymentType.PAYMENT,
      method: PaymentMethod.CASH, // Default to cash, can be changed later
      status: PaymentStatus.PENDING,
      originalAmount: data.originalAmount || 0,
      discountAmount: data.depositDeducted || 0, // Deposit treated as discount
      finalAmount: data.finalAmount || 0,
      paidAmount: 0,
      processedBy: data.createdBy,
      processedByName: 'System',
      description: `Thanh toán cho dịch vụ: ${data.serviceName || 'Unknown'}`,
      notes: data.depositDeducted > 0 
        ? `Đã trừ tiền cọc: ${data.depositDeducted.toLocaleString('vi-VN')} VND`
        : null
    };
    
    // Create payment
    const payment = new Payment(paymentData);
    await payment.save();
    
    console.log(`✅ [handlePaymentCreate] Payment created: ${payment.paymentCode} for record ${data.recordId}`);
    
    // Publish payment.created event
    try {
      await publishToQueue('payment_created_queue', {
        event: 'payment.created',
        data: {
          paymentId: payment._id.toString(),
          paymentCode: payment.paymentCode,
          recordId: data.recordId,
          appointmentId: data.appointmentId,
          finalAmount: payment.finalAmount,
          status: payment.status,
          createdAt: payment.createdAt
        }
      });
      console.log(`✅ Published payment.created event for ${payment.paymentCode}`);
    } catch (publishError) {
      console.error('❌ Failed to publish payment.created event:', publishError);
    }
    
    return payment;
    
  } catch (error) {
    console.error('❌ [handlePaymentCreate] Error:', error);
    throw error;
  }
}

/**
 * Handle payment.cash_confirm event
 * Confirm cash payment and emit payment.success
 */
async function handleCashPaymentConfirm(eventData) {
  try {
    const { data } = eventData;
    const { paymentId, paidAmount, processedBy, processedByName } = data;
    
    console.log(`🔄 [handleCashPaymentConfirm] Confirming payment ${paymentId}`);
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }
    
    if (payment.status === PaymentStatus.COMPLETED) {
      console.log(`⚠️ Payment ${payment.paymentCode} already completed`);
      return payment;
    }
    
    // Update payment
    payment.status = PaymentStatus.COMPLETED;
    payment.paidAmount = paidAmount || payment.finalAmount;
    payment.changeAmount = Math.max(0, payment.paidAmount - payment.finalAmount);
    payment.processedBy = processedBy;
    payment.processedByName = processedByName || 'Staff';
    payment.completedAt = new Date();
    
    await payment.save();
    
    console.log(`✅ [handleCashPaymentConfirm] Payment ${payment.paymentCode} completed`);
    
    // Publish payment.success event
    await publishPaymentSuccess(payment);
    
    return payment;
    
  } catch (error) {
    console.error('❌ [handleCashPaymentConfirm] Error:', error);
    throw error;
  }
}

/**
 * Publish payment.success event to trigger invoice creation
 */
async function publishPaymentSuccess(payment) {
  try {
    await publishToQueue('invoice_queue', {
      event: 'payment.success',
      data: {
        paymentId: payment._id.toString(),
        paymentCode: payment.paymentCode,
        recordId: payment.recordId ? payment.recordId.toString() : null,
        appointmentId: payment.appointmentId ? payment.appointmentId.toString() : null,
        patientId: payment.patientId ? payment.patientId.toString() : null,
        patientInfo: payment.patientInfo,
        method: payment.method,
        originalAmount: payment.originalAmount,
        discountAmount: payment.discountAmount,
        finalAmount: payment.finalAmount,
        paidAmount: payment.paidAmount,
        changeAmount: payment.changeAmount,
        completedAt: payment.completedAt,
        processedBy: payment.processedBy ? payment.processedBy.toString() : null,
        processedByName: payment.processedByName
      }
    });
    
    console.log(`✅ Published payment.success event for ${payment.paymentCode}`);
  } catch (error) {
    console.error('❌ Failed to publish payment.success:', error);
    throw error;
  }
}

module.exports = {
  handlePaymentCreate,
  handleCashPaymentConfirm,
  publishPaymentSuccess
};

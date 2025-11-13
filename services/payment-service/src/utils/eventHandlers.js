const { Payment, PaymentStatus, PaymentType, PaymentMethod } = require('../models/payment.model');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Handle payment.create event from record-service
 * Auto-create payment request when record is completed
 */
async function handlePaymentCreate(eventData) {
  try {
    const { data } = eventData;
    const timestamp = new Date().toISOString();
    
    console.log(`\n🔔🔔🔔 [${timestamp}] [handlePaymentCreate] RECEIVED payment.create event`);
    console.log(`📝 Creating payment for record ${data.recordId} (${data.recordCode})`);
    
    // Check if payment already exists for this record
    const existingPayment = await Payment.findOne({ recordId: data.recordId });
    if (existingPayment) {
      console.log(`⚠️⚠️⚠️ [handlePaymentCreate] DUPLICATE DETECTED - Payment already exists for record ${data.recordId}: ${existingPayment.paymentCode}`);
      console.log(`⏭️ Skipping payment creation (duplicate prevention)`);
      return;
    }
    
    console.log('✅ No existing payment found - proceeding with creation');
    console.log('📋 Payment data:', JSON.stringify(data, null, 2));
    
    // 🆕 Fetch deposit from invoice-service (if appointment has invoiceId)
    let depositAmount = 0;
    let bookingChannel = 'offline';
    let invoiceNumber = null;
    
    if (data.appointmentId) {
      try {
        const axios = require('axios');
        
        // Step 1: Get appointment to check if it has invoiceId
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
        const appointmentResponse = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`, {
          params: { ids: data.appointmentId }
        });
        
        if (appointmentResponse.data.success && appointmentResponse.data.data && appointmentResponse.data.data.length > 0) {
          const appointment = appointmentResponse.data.data[0];
          bookingChannel = appointment.bookingChannel || 'offline';
          const invoiceId = appointment.invoiceId;
          
          console.log(`📄 [handlePaymentCreate] Appointment ${data.appointmentId} has invoiceId: ${invoiceId}`);
          
          // Step 2: If appointment has invoiceId, fetch invoice to get deposit amount
          if (invoiceId) {
            try {
              const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || 'http://localhost:3008';
              const invoiceResponse = await axios.get(`${INVOICE_SERVICE_URL}/api/invoices/internal/${invoiceId}`);
              
              if (invoiceResponse.data.success && invoiceResponse.data.data) {
                const invoice = invoiceResponse.data.data;
                depositAmount = invoice.paymentSummary?.totalPaid || 0;
                invoiceNumber = invoice.invoiceNumber || null;
                bookingChannel = 'online'; // ✅ Has invoice = online booking
                
                console.log(`💰 [handlePaymentCreate] Invoice ${invoiceNumber} deposit: ${depositAmount.toLocaleString('vi-VN')}đ (online booking)`);
              }
            } catch (invoiceError) {
              console.error('⚠️ [handlePaymentCreate] Failed to fetch invoice:', invoiceError.message);
            }
          } else {
            console.log(`ℹ️ [handlePaymentCreate] Appointment has no invoice - no deposit`);
          }
          
          console.log(`📋 [handlePaymentCreate] Appointment info:`, {
            appointmentId: data.appointmentId,
            bookingChannel: bookingChannel,
            invoiceId: invoiceId,
            deposit: depositAmount
          });
        }
      } catch (error) {
        console.error('⚠️ [handlePaymentCreate] Failed to fetch appointment:', error.message);
        // Continue without deposit info
      }
    }
    
    // Calculate final amount (after deducting deposit)
    const originalAmount = data.originalAmount || 0;
    const finalAmount = Math.max(0, originalAmount - depositAmount);
    
    // 🆕 Handle processedBy - use a system default ObjectId if null
    const mongoose = require('mongoose');
    const systemUserId = data.createdBy || new mongoose.Types.ObjectId('000000000000000000000000'); // System user
    
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
      method: null, // ✅ No default method - receptionist will choose later
      status: PaymentStatus.PENDING,
      originalAmount: originalAmount,
      depositAmount: depositAmount, // 💰 Deposit from invoice
      discountAmount: 0, // Additional discount (if any)
      finalAmount: finalAmount,
      paidAmount: 0,
      processedBy: systemUserId, // ✅ Use system ID if null
      processedByName: data.createdByName || 'Hệ thống',
      description: `Thanh toán cho ${data.serviceName || 'dịch vụ'}${data.serviceAddOnName ? ` - ${data.serviceAddOnName}` : ''}`,
      notes: depositAmount > 0 
        ? `Đã cọc ${depositAmount.toLocaleString('vi-VN')}đ qua ${invoiceNumber ? `hóa đơn ${invoiceNumber}` : 'đặt lịch online'} (${bookingChannel})`
        : 'Chưa có cọc trước'
    };
    
    // Create payment
    const payment = new Payment(paymentData);
    await payment.save();
    
    console.log(`✅ [handlePaymentCreate] Payment created: ${payment.paymentCode} for record ${data.recordId}`);
    console.log(`💰 Payment details:`, {
      originalAmount: payment.originalAmount,
      depositAmount: payment.depositAmount,
      discountAmount: payment.discountAmount,
      finalAmount: payment.finalAmount,
      invoiceNumber: invoiceNumber
    });
    
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

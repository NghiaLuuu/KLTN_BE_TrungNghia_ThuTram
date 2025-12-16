const { Payment, PaymentStatus, PaymentType, PaymentMethod } = require('../models/payment.model');
const { publishToQueue } = require('./rabbitmq.client');

/**
 * Xử lý sự kiện payment.create từ record-service
 * Tự động tạo yêu cầu thanh toán khi hồ sơ hoàn tất
 */
async function handlePaymentCreate(eventData) {
  try {
    const { data } = eventData;
    const timestamp = new Date().toISOString();
    
    console.log(`\n🔔🔔🔔 [${timestamp}] [handlePaymentCreate] ĐÃ NHẬN sự kiện payment.create`);
    console.log(`📝 Đang tạo thanh toán cho hồ sơ ${data.recordId} (${data.recordCode})`);
    
    // Kiểm tra xem thanh toán đã tồn tại cho hồ sơ này chưa
    const existingPayment = await Payment.findOne({ recordId: data.recordId });
    if (existingPayment) {
      console.log(`⚠️⚠️⚠️ [handlePaymentCreate] PHÁT HIỆN TRÙNG LẶP - Thanh toán đã tồn tại cho hồ sơ ${data.recordId}: ${existingPayment.paymentCode}`);
      console.log(`⏭️ Bỏ qua tạo thanh toán (ngăn chặn trùng lặp)`);
      return;
    }
    
    console.log('✅ Không tìm thấy thanh toán hiện có - tiếp tục tạo mới');
    console.log('📋 Dữ liệu thanh toán:', JSON.stringify(data, null, 2));
    
    // 🆕 Lấy tiền cọc từ invoice-service (nếu lịch hẹn có invoiceId)
    let depositAmount = 0;
    let bookingChannel = 'offline';
    let invoiceNumber = null;
    
    if (data.appointmentId) {
      try {
        const axios = require('axios');
        
        // Bước 1: Lấy thông tin lịch hẹn để kiểm tra có invoiceId không
        const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
        const appointmentResponse = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments/by-ids`, {
          params: { ids: data.appointmentId }
        });
        
        if (appointmentResponse.data.success && appointmentResponse.data.data && appointmentResponse.data.data.length > 0) {
          const appointment = appointmentResponse.data.data[0];
          bookingChannel = appointment.bookingChannel || 'offline';
          const invoiceId = appointment.invoiceId;
          
          console.log(`📄 [handlePaymentCreate] Lịch hẹn ${data.appointmentId} có invoiceId: ${invoiceId}`);
          
          // Bước 2: Nếu lịch hẹn có invoiceId, lấy hóa đơn để biết số tiền cọc
          if (invoiceId) {
            try {
              const INVOICE_SERVICE_URL = process.env.INVOICE_SERVICE_URL || 'http://localhost:3008';
              const invoiceResponse = await axios.get(`${INVOICE_SERVICE_URL}/api/invoices/internal/${invoiceId}`);
              
              if (invoiceResponse.data.success && invoiceResponse.data.data) {
                const invoice = invoiceResponse.data.data;
                depositAmount = invoice.paymentSummary?.totalPaid || 0;
                invoiceNumber = invoice.invoiceNumber || null;
                bookingChannel = 'online'; // ✅ Có hóa đơn = đặt lịch online
                
                console.log(`💰 [handlePaymentCreate] Hóa đơn ${invoiceNumber} tiền cọc: ${depositAmount.toLocaleString('vi-VN')}đ (đặt lịch online)`);
              }
            } catch (invoiceError) {
              console.error('⚠️ [handlePaymentCreate] Lấy hóa đơn thất bại:', invoiceError.message);
            }
          } else {
            console.log(`ℹ️ [handlePaymentCreate] Lịch hẹn không có hóa đơn - không có tiền cọc`);
          }
          
          console.log(`📋 [handlePaymentCreate] Thông tin lịch hẹn:`, {
            appointmentId: data.appointmentId,
            bookingChannel: bookingChannel,
            invoiceId: invoiceId,
            deposit: depositAmount
          });
        }
      } catch (error) {
        console.error('⚠️ [handlePaymentCreate] Lấy lịch hẹn thất bại:', error.message);
        // Tiếp tục không có thông tin tiền cọc
      }
    }
    
    // Tính số tiền cuối (sau khi trừ tiền cọc)
    const originalAmount = data.originalAmount || 0;
    const finalAmount = Math.max(0, originalAmount - depositAmount);
    
    // 🆕 Xử lý processedBy - dùng ObjectId hệ thống mặc định nếu null
    const mongoose = require('mongoose');
    const systemUserId = data.createdBy || new mongoose.Types.ObjectId('000000000000000000000000'); // Người dùng hệ thống
    
    // Chuẩn bị dữ liệu thanh toán
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
      method: null, // ✅ Không có phương thức mặc định - lễ tân sẽ chọn sau
      status: PaymentStatus.PENDING,
      originalAmount: originalAmount,
      depositAmount: depositAmount, // 💰 Tiền cọc từ hóa đơn
      discountAmount: 0, // Giảm giá thêm (nếu có)
      finalAmount: finalAmount,
      paidAmount: 0,
      processedBy: systemUserId, // ✅ Dùng ID hệ thống nếu null
      processedByName: data.createdByName || 'Hệ thống',
      description: `Thanh toán cho ${data.serviceName || 'dịch vụ'}${data.serviceAddOnName ? ` - ${data.serviceAddOnName}` : ''}`,
      notes: depositAmount > 0 
        ? `Đã cọc ${depositAmount.toLocaleString('vi-VN')}đ qua ${invoiceNumber ? `hóa đơn ${invoiceNumber}` : 'đặt lịch online'} (${bookingChannel})`
        : 'Chưa có cọc trước'
    };
    
    // Tạo thanh toán
    const payment = new Payment(paymentData);
    await payment.save();
    
    console.log(`✅ [handlePaymentCreate] Đã tạo thanh toán: ${payment.paymentCode} cho hồ sơ ${data.recordId}`);
    console.log(`💰 Chi tiết thanh toán:`, {
      originalAmount: payment.originalAmount,
      depositAmount: payment.depositAmount,
      discountAmount: payment.discountAmount,
      finalAmount: payment.finalAmount,
      invoiceNumber: invoiceNumber
    });
    
    // Phát sự kiện payment.created
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
      console.log(`✅ Đã phát sự kiện payment.created cho ${payment.paymentCode}`);
    } catch (publishError) {
      console.error('❌ Phát sự kiện payment.created thất bại:', publishError);
    }
    
    return payment;
    
  } catch (error) {
    console.error('❌ [handlePaymentCreate] Error:', error);
    throw error;
  }
}

/**
 * Xử lý sự kiện payment.cash_confirm
 * Xác nhận thanh toán tiền mặt và phát payment.success
 */
async function handleCashPaymentConfirm(eventData) {
  try {
    const { data } = eventData;
    const { paymentId, paidAmount, processedBy, processedByName } = data;
    
    console.log(`🔄 [handleCashPaymentConfirm] Đang xác nhận thanh toán ${paymentId}`);
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error(`Không tìm thấy thanh toán: ${paymentId}`);
    }
    
    if (payment.status === PaymentStatus.COMPLETED) {
      console.log(`⚠️ Thanh toán ${payment.paymentCode} đã hoàn tất`);
      return payment;
    }
    
    // Cập nhật thanh toán
    payment.status = PaymentStatus.COMPLETED;
    payment.paidAmount = paidAmount || payment.finalAmount;
    payment.changeAmount = Math.max(0, payment.paidAmount - payment.finalAmount);
    payment.processedBy = processedBy;
    payment.processedByName = processedByName || 'Staff';
    payment.completedAt = new Date();
    
    await payment.save();
    
    console.log(`✅ [handleCashPaymentConfirm] Thanh toán ${payment.paymentCode} hoàn tất`);
    
    // Phát sự kiện payment.success
    await publishPaymentSuccess(payment);
    
    return payment;
    
  } catch (error) {
    console.error('❌ [handleCashPaymentConfirm] Error:', error);
    throw error;
  }
}

/**
 * Phát sự kiện payment.success để kích hoạt tạo hóa đơn
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
    
    console.log(`✅ Đã phát sự kiện payment.success cho ${payment.paymentCode}`);
  } catch (error) {
    console.error('❌ Phát payment.success thất bại:', error);
    throw error;
  }
}

module.exports = {
  handlePaymentCreate,
  handleCashPaymentConfirm,
  publishPaymentSuccess
};

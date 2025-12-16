const { Invoice } = require('../models/invoice.model');
const { InvoiceDetail } = require('../models/invoiceDetail.model');
const rabbitmqClient = require('./rabbitmq.client');

/**
 * ⚠️ CÁC HÀM ĐÃ LỖI THỜI - Đã được thay thế bởi invoice.consumer.js
 * Các hàm này được giữ lại để tham khảo nhưng không còn được sử dụng
 * - handleAppointmentCreated: Giờ được xử lý trong invoice.consumer.js (sự kiện appointment.created)
 * - handlePaymentSuccess: Giờ được xử lý trong invoice.consumer.js (sự kiện payment.completed)
 */

/**
 * ĐÃ LỖI THỜI: Xử lý sự kiện appointment.created
 * GIỜI ĐƯỢC XỬ LÝ BỞI: invoice.consumer.js
 */
async function handleAppointmentCreated_DEPRECATED(data) {
  try {
    const {
      appointmentId,
      paymentId,
      transactionId,
      amount,
      patientId,
      patientName,
      patientPhone,
      patientEmail,
      patientAddress,
      serviceId,
      serviceName,
      servicePrice,
      doctorId,
      doctorName,
      appointmentDate,
      startTime,
      endTime,
      slotIds
    } = data;

    console.log('[Invoice] Processing appointment.created event:', {
      appointmentId,
      paymentId,
      amount
    });

    // Kiểm tra dữ liệu
    if (!appointmentId || !paymentId) {
      console.error('[Invoice] Dữ liệu lịch hẹn không hợp lệ - thiếu appointmentId hoặc paymentId');
      return;
    }

    // Kiểm tra xem hóa đơn đã tồn tại chưa (ngăn chặn trùng lặp)
    const existingInvoice = await Invoice.findOne({ appointmentId });
    if (existingInvoice) {
      console.log('[Invoice] Hóa đơn đã tồn tại cho lịch hẹn:', appointmentId);
      return;
    }

    // Tạo mã hóa đơn
    const invoiceCode = await generateInvoiceCode();

    // Tạo hóa đơn
    const invoice = await Invoice.create({
      invoiceCode,
      appointmentId,
      recordId: null, // Sẽ được cập nhật sau khi hồ sơ được tạo
      
      // Thông tin bệnh nhân
      patientId,
      patientInfo: {
        name: patientName,
        phone: patientPhone,
        email: patientEmail || '',
        address: patientAddress || '',
        dateOfBirth: null
      },
      
      // Thông tin nha sĩ
      dentistId: doctorId,
      dentistInfo: {
        name: doctorName,
        specialization: '',
        licenseNumber: ''
      },
      
      // Chi tiết tài chính
      subtotal: servicePrice || amount,
      taxInfo: {
        taxRate: 0,
        taxAmount: 0,
        taxType: 'VAT'
      },
      discountInfo: {
        discountType: 'none',
        discountValue: 0,
        discountAmount: 0
      },
      totalAmount: amount,
      
      // Payment information
      paymentSummary: {
        paidAmount: amount,
        remainingAmount: 0,
        paymentMethod: 'visa',
        paymentStatus: 'paid',
        paymentId: paymentId,
        transactionId: transactionId
      },
      
      // Status
      status: 'paid',
      
      // Notes
      notes: `Hóa đơn cho lịch khám ngày ${appointmentDate} - ${serviceName}`,
      
      // Ngày tháng
      invoiceDate: new Date(),
      dueDate: new Date(),
      paidDate: new Date(),
      
      // Tạo bởi (hệ thống)
      createdBy: patientId,
      createdByRole: 'patient'
    });

    console.log('[Invoice] Đã tạo hóa đơn:', {
      invoiceId: invoice._id,
      invoiceCode: invoice.invoiceCode,
      appointmentId,
      amount: invoice.totalAmount
    });

    // Tạo chi tiết hóa đơn cho dịch vụ
    await InvoiceDetail.create({
      invoiceId: invoice._id,
      appointmentId,
      itemType: 'service',
      itemId: serviceId,
      itemName: serviceName,
      itemDescription: `Dịch vụ nha khoa - ${serviceName}`,
      quantity: 1,
      unitPrice: servicePrice || amount,
      totalPrice: servicePrice || amount,
      discount: 0,
      tax: 0,
      finalPrice: servicePrice || amount,
      notes: `Lịch khám: ${appointmentDate} ${startTime} - ${endTime}`
    });

    console.log('[Invoice] Đã tạo chi tiết hóa đơn cho dịch vụ:', serviceName);

    console.log(`[Invoice] Đã tạo thành công hóa đơn ${invoiceCode} cho lịch hẹn ${appointmentId}`);

  } catch (error) {
    console.error('[Invoice] Lỗi xử lý sự kiện appointment.created:', error);
    throw error;
  }
}

/**
 * Xử lý sự kiện appointment.cancelled
 * Cập nhật trạng thái hóa đơn thành đã hủy (hoặc hoàn tiền)
 */
async function handleAppointmentCancelled(data) {
  try {
    const { appointmentId, reason, cancelledBy } = data;

    console.log('[Invoice] Đang xử lý sự kiện appointment.cancelled:', {
      appointmentId,
      reason
    });

    // Tìm hóa đơn
    const invoice = await Invoice.findOne({ appointmentId });
    
    if (!invoice) {
      console.log('[Invoice] Không tìm thấy hóa đơn cho lịch hẹn đã hủy:', appointmentId);
      return;
    }

    // Cập nhật trạng thái hóa đơn
    invoice.status = 'cancelled';
    invoice.notes = `${invoice.notes}\n\nĐã hủy: ${reason || 'Không rõ lý do'}`;
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = cancelledBy;

    // Cập nhật trạng thái thanh toán
    invoice.paymentSummary.paymentStatus = 'refunded';

    await invoice.save();

    console.log('[Invoice] Đã cập nhật trạng thái hóa đơn thành đã hủy:', invoice.invoiceCode);

  } catch (error) {
    console.error('[Invoice] Lỗi xử lý sự kiện appointment.cancelled:', error);
    throw error;
  }
}

/**
 * ĐÃ LỖI THỜI: Xử lý sự kiện payment.success
 * GIỜI ĐƯỢC XỬ LÝ BỞI: invoice.consumer.js (sự kiện payment.completed)
 */
async function handlePaymentSuccess_DEPRECATED(data) {
  try {
    const {
      paymentId,
      paymentCode,
      recordId,
      appointmentId,
      patientId,
      patientInfo,
      method,
      originalAmount,
      discountAmount,
      finalAmount,
      paidAmount,
      changeAmount,
      completedAt,
      processedBy,
      processedByName
    } = data;

    console.log('[Invoice] Đang xử lý sự kiện payment.success:', {
      paymentId,
      paymentCode,
      recordId,
      finalAmount
    });

    // Kiểm tra xem hóa đơn đã tồn tại chưa
    const existingInvoice = await Invoice.findOne({ 
      $or: [
        { 'paymentSummary.paymentId': paymentId },
        { recordId: recordId }
      ]
    });

    if (existingInvoice) {
      console.log('[Invoice] Hóa đơn đã tồn tại:', existingInvoice.invoiceCode);
      
      // Cập nhật recordId vào hồ sơ nếu chưa được đặt
      if (recordId && !existingInvoice.recordId) {
        existingInvoice.recordId = recordId;
        await existingInvoice.save();
        console.log('[Invoice] Đã cập nhật hóa đơn với recordId');
      }
      
      return existingInvoice;
    }

    // Tạo mã hóa đơn
    const invoiceCode = await generateInvoiceCode();

    // Tạo hóa đơn
    const invoice = await Invoice.create({
      invoiceCode,
      appointmentId: appointmentId || null,
      recordId: recordId || null,
      
      // Thông tin bệnh nhân
      patientId: patientId || null,
      patientInfo: {
        name: patientInfo?.name || 'Bệnh nhân không xác định',
        phone: patientInfo?.phone || '0000000000',
        email: patientInfo?.email || '',
        address: patientInfo?.address || '',
        dateOfBirth: null
      },
      
      // Thông tin nha sĩ (sẽ được cập nhật từ hồ sơ nếu có)
      dentistId: null,
      dentistInfo: {
        name: 'Chưa xác định',
        specialization: '',
        licenseNumber: ''
      },
      
      // Chi tiết tài chính
      subtotal: originalAmount,
      taxInfo: {
        taxRate: 0,
        taxAmount: 0,
        taxType: 'VAT'
      },
      discountInfo: {
        discountType: discountAmount > 0 ? 'fixed' : 'none',
        discountValue: discountAmount,
        discountAmount: discountAmount,
        discountReason: discountAmount > 0 ? 'Trừ tiền cọc' : null
      },
      totalAmount: finalAmount,
      
      // Thông tin thanh toán
      paymentSummary: {
        paidAmount: paidAmount,
        remainingAmount: 0,
        paymentMethod: method,
        paymentStatus: 'paid',
        paymentId: paymentId,
        transactionId: paymentCode
      },
      
      // Trạng thái
      status: 'paid',
      
      // Ghi chú
      notes: `Hóa đơn thanh toán sau điều trị. Phương thức: ${method === 'cash' ? 'Tiền mặt' : 'VNPay'}`,
      
      // Ngày tháng
      invoiceDate: new Date(),
      dueDate: new Date(),
      paidDate: completedAt || new Date(),
      
      // Tạo bởi
      createdBy: processedBy || patientId,
      createdByRole: 'staff'
    });

    console.log('[Invoice] Created invoice:', {
      invoiceId: invoice._id,
      invoiceCode: invoice.invoiceCode,
      paymentId,
      amount: invoice.totalAmount
    });

    // TODO: Publish event to update record with invoiceId
    try {
      if (recordId) {
        await rabbitmqClient.publishToQueue('record_queue', {
          event: 'invoice.created',
          data: {
            invoiceId: invoice._id.toString(),
            invoiceCode: invoice.invoiceCode,
            recordId: recordId
          }
        });
        console.log('[Invoice] Published invoice.created event to record-service');
      }
    } catch (publishError) {
      console.error('[Invoice] Failed to publish invoice.created event:', publishError);
    }

    return invoice;

  } catch (error) {
    console.error('[Invoice] Error handling payment.success event:', error);
    throw error;
  }
}

/**
 * Handle invoice.create_from_record event
 * Create invoice from completed treatment record
 */
async function handleInvoiceCreateFromRecord(data) {
  try {
    const {
      recordId,
      recordCode,
      appointmentId,
      appointmentCode,
      patientId,
      patientInfo,
      dentistId,
      dentistName,
      roomId,
      roomName,
      subroomId,
      subroomName,
      services,
      totalAmount,
      depositPaid,
      originalPaymentId,
      finalAmount,
      bookingChannel,
      createdBy,
      completedAt
    } = data;

    console.log('[Invoice] Đang xử lý sự kiện invoice.create_from_record:', {
      recordId,
      appointmentId,
      totalAmount,
      depositPaid,
      finalAmount
    });

    // Kiểm tra dữ liệu bắt buộc
    if (!recordId || !appointmentId || !patientId) {
      console.error('[Invoice] Thiếu trường bắt buộc trong sự kiện invoice.create_from_record');
      return;
    }

    // Kiểm tra xem hóa đơn đã tồn tại cho hồ sơ này chưa
    const existingInvoice = await Invoice.findOne({ recordId });
    if (existingInvoice) {
      console.log('[Invoice] Hóa đơn đã tồn tại cho hồ sơ:', recordId);
      return existingInvoice;
    }

    // Tạo số hóa đơn (sẽ được tự động tạo bởi pre-save hook)
    // Nhưng chúng ta cần tạo tại đây để trả về trong logs
    const invoiceNumber = await Invoice.generateInvoiceNumber();

    // Chuẩn bị thông tin bệnh nhân (dùng dữ liệu nhúng từ sự kiện)
    const patientInfoData = {
      name: patientInfo?.name || 'Unknown Patient',
      phone: patientInfo?.phone || '0000000000',
      email: patientInfo?.email || '',
      address: patientInfo?.address || '',
      dateOfBirth: patientInfo?.dateOfBirth || null,
      gender: patientInfo?.gender || null,
      identityNumber: patientInfo?.identityNumber || null
    };

    // Chuẩn bị thông tin nha sĩ
    const dentistInfoData = {
      name: dentistName || 'Nha sĩ không xác định',
      specialization: '',
      licenseNumber: ''
    };

    // Tính thông tin giảm giá (nếu đã đặt cọc)
    const discountInfo = depositPaid > 0 ? {
      type: 'fixed_amount',
      value: depositPaid,
      reason: `Trừ tiền cọc đã thanh toán (${appointmentCode})`
    } : {
      type: 'none',
      value: 0
    };

    // Xác định trạng thái hóa đơn và thông tin thanh toán
    let invoiceStatus = 'pending';
    let paymentSummaryData = {
      totalPaid: 0,
      remainingAmount: finalAmount,
      paymentMethod: null,
      paymentIds: []
    };

    // Nếu số tiền cuối là 0 (tiền cọc đã bao gồm tất cả), đánh dấu đã thanh toán
    if (finalAmount === 0 && depositPaid > 0) {
      invoiceStatus = 'paid';
      paymentSummaryData = {
        totalPaid: depositPaid,
        remainingAmount: 0,
        paymentMethod: 'online',
        lastPaymentDate: completedAt || new Date(),
        paymentIds: originalPaymentId ? [originalPaymentId] : []
      };
    }

    // Tạo hóa đơn với tên trường đúng theo InvoiceSchema
    const invoice = await Invoice.create({
      invoiceNumber,
      appointmentId,
      recordId,
      type: 'treatment', // InvoiceType.TREATMENT
      status: invoiceStatus,
      
      // Thông tin bệnh nhân
      patientId,
      patientInfo: patientInfoData,
      
      // Thông tin nha sĩ
      dentistInfo: dentistInfoData,
      
      // Chi tiết tài chính
      subtotal: totalAmount,
      taxInfo: {
        taxRate: 0,
        taxAmount: 0,
        taxIncluded: true
      },
      discountInfo: discountInfo,
      totalAmount: finalAmount,
      
      // Thông tin thanh toán
      paymentSummary: paymentSummaryData,
      
      // Ghi chú
      description: `Hóa đơn điều trị sau khám bệnh`,
      notes: `Appointment: ${appointmentCode}
Record: ${recordCode}
Phòng khám: ${roomName}${subroomName ? ` - ${subroomName}` : ''}
${depositPaid > 0 ? `Đã trừ tiền cọc: ${depositPaid.toLocaleString()} VND` : ''}`,
      
      // Dates
      issueDate: completedAt || new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      paidDate: finalAmount === 0 ? (completedAt || new Date()) : null,
      
      // Created by
      createdBy: createdBy || dentistId || patientId,
      createdByRole: 'dentist'
    });

    console.log('[Invoice] Created invoice:', {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      appointmentId,
      recordId,
      subtotal: invoice.subtotal,
      discount: depositPaid,
      totalAmount: invoice.totalAmount,
      status: invoice.status
    });

    // Create invoice details for each service using InvoiceDetail schema
    if (services && services.length > 0) {
      for (const service of services) {
        try {
          // Determine service type and category (simplified mapping)
          const serviceType = service.serviceType || 'examination';
          const serviceCategory = 'restorative'; // Default category

          await InvoiceDetail.create({
            invoiceId: invoice._id,
            serviceId: service.serviceId,
            serviceInfo: {
              name: service.serviceName,
              code: '',
              type: serviceType,
              category: serviceCategory,
              description: service.serviceAddOnName || service.serviceName
            },
            unitPrice: service.price || 0,
            quantity: service.quantity || 1,
            subtotal: service.price || 0,
            discount: {
              type: 'none',
              value: 0
            },
            discountAmount: 0,
            totalPrice: service.price || 0,
            description: service.notes || '',
            notes: service.notes || '',
            status: 'completed',
            completedDate: completedAt || new Date(),
            createdBy: createdBy || dentistId || patientId
          });
          
          console.log('[Invoice] Đã tạo chi tiết hóa đơn cho dịch vụ:', service.serviceName);
        } catch (detailError) {
          console.error('[Invoice] Lỗi tạo chi tiết hóa đơn:', detailError);
        }
      }
    }

    // Phát sự kiện invoice.created về record-service (để cập nhật hồ sơ với invoiceId)
    try {
      await rabbitmqClient.publishToQueue('record_queue', {
        event: 'invoice.created',
        data: {
          invoiceId: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNumber,
          recordId: recordId,
          appointmentId: appointmentId,
          totalAmount: invoice.totalAmount,
          status: invoice.status
        }
      });
      console.log('[Invoice] Đã phát sự kiện invoice.created tới record-service');
    } catch (publishError) {
      console.error('[Invoice] Không thể phát sự kiện invoice.created:', publishError);
    }

    console.log(`[Invoice] Đã tạo thành công hóa đơn ${invoice.invoiceNumber} từ hồ sơ ${recordCode}`);
    return invoice;

  } catch (error) {
    console.error('[Invoice] Lỗi xử lý sự kiện invoice.create_from_record:', error);
    throw error;
  }
}

/**
 * Tạo mã hóa đơn duy nhất
 */
async function generateInvoiceCode() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  // Đếm số hóa đơn hôm nay
  const startOfDay = new Date(year, date.getMonth(), day, 0, 0, 0);
  const endOfDay = new Date(year, date.getMonth(), day, 23, 59, 59);
  
  const count = await Invoice.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });
  
  const sequence = String(count + 1).padStart(4, '0');
  
  return `INV${year}${month}${day}${sequence}`;
}

/**
 * Thiết lập các bộ lắng nghe sự kiện cho invoice service
 */
async function setupEventListeners() {
  try {
    // Kết nối tới RabbitMQ
    await rabbitmqClient.connect();

    // Lắng nghe các sự kiện appointment.cancelled (để vô hiệu hóa cache)
    await rabbitmqClient.consumeQueue('appointment.cancelled', handleAppointmentCancelled);

    // ⚠️ GHI CHÚ: consumer invoice_queue đã chuyển sang invoice.consumer.js
    // File này chỉ xử lý appointment.cancelled để vô hiệu hóa cache
    console.log('✅ [EventListeners] Đang lắng nghe hàng đợi appointment.cancelled duy nhất');
    console.log('📝 [EventListeners] invoice_queue được xử lý bởi invoice.consumer.js');

  } catch (error) {
    console.error('[Invoice] Lỗi thiết lập các bộ lắng nghe sự kiện:', error);
    
    // Thử lại sau 5 giây
    setTimeout(() => {
      console.log('[Invoice] Đang thử lại thiết lập các bộ lắng nghe sự kiện...');
      setupEventListeners();
    }, 5000);
  }
}

module.exports = {
  setupEventListeners,
  handleAppointmentCancelled
};

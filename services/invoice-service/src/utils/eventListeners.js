const { Invoice } = require('../models/invoice.model');
const { InvoiceDetail } = require('../models/invoiceDetail.model');
const rabbitmqClient = require('./rabbitmq.client');

/**
 * Handle appointment.created event
 * Create invoice for the appointment
 */
async function handleAppointmentCreated(data) {
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

    // Validate data
    if (!appointmentId || !paymentId) {
      console.error('[Invoice] Invalid appointment data - missing appointmentId or paymentId');
      return;
    }

    // Check if invoice already exists (prevent duplicates)
    const existingInvoice = await Invoice.findOne({ appointmentId });
    if (existingInvoice) {
      console.log('[Invoice] Invoice already exists for appointment:', appointmentId);
      return;
    }

    // Generate invoice code
    const invoiceCode = await generateInvoiceCode();

    // Create invoice
    const invoice = await Invoice.create({
      invoiceCode,
      appointmentId,
      recordId: null, // Will be updated later when record is created
      
      // Patient information
      patientId,
      patientInfo: {
        name: patientName,
        phone: patientPhone,
        email: patientEmail || '',
        address: patientAddress || '',
        dateOfBirth: null
      },
      
      // Dentist information
      dentistId: doctorId,
      dentistInfo: {
        name: doctorName,
        specialization: '',
        licenseNumber: ''
      },
      
      // Financial details
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
      
      // Dates
      invoiceDate: new Date(),
      dueDate: new Date(),
      paidDate: new Date(),
      
      // Created by (system)
      createdBy: patientId,
      createdByRole: 'patient'
    });

    console.log('[Invoice] Created invoice:', {
      invoiceId: invoice._id,
      invoiceCode: invoice.invoiceCode,
      appointmentId,
      amount: invoice.totalAmount
    });

    // Create invoice detail for the service
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

    console.log('[Invoice] Created invoice detail for service:', serviceName);

    console.log(`[Invoice] Successfully created invoice ${invoiceCode} for appointment ${appointmentId}`);

  } catch (error) {
    console.error('[Invoice] Error handling appointment.created event:', error);
    throw error;
  }
}

/**
 * Handle appointment.cancelled event
 * Update invoice status to cancelled (or refund)
 */
async function handleAppointmentCancelled(data) {
  try {
    const { appointmentId, reason, cancelledBy } = data;

    console.log('[Invoice] Processing appointment.cancelled event:', {
      appointmentId,
      reason
    });

    // Find invoice
    const invoice = await Invoice.findOne({ appointmentId });
    
    if (!invoice) {
      console.log('[Invoice] No invoice found for cancelled appointment:', appointmentId);
      return;
    }

    // Update invoice status
    invoice.status = 'cancelled';
    invoice.notes = `${invoice.notes}\n\nĐã hủy: ${reason || 'Không rõ lý do'}`;
    invoice.cancelledAt = new Date();
    invoice.cancelledBy = cancelledBy;

    // Update payment status
    invoice.paymentSummary.paymentStatus = 'refunded';

    await invoice.save();

    console.log('[Invoice] Updated invoice status to cancelled:', invoice.invoiceCode);

  } catch (error) {
    console.error('[Invoice] Error handling appointment.cancelled event:', error);
    throw error;
  }
}

/**
 * Handle payment.success event
 * Create invoice after payment is completed
 */
async function handlePaymentSuccess(data) {
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

    console.log('[Invoice] Processing payment.success event:', {
      paymentId,
      paymentCode,
      recordId,
      finalAmount
    });

    // Check if invoice already exists
    const existingInvoice = await Invoice.findOne({ 
      $or: [
        { 'paymentSummary.paymentId': paymentId },
        { recordId: recordId }
      ]
    });

    if (existingInvoice) {
      console.log('[Invoice] Invoice already exists:', existingInvoice.invoiceCode);
      
      // Update record with invoiceId if not set
      if (recordId && !existingInvoice.recordId) {
        existingInvoice.recordId = recordId;
        await existingInvoice.save();
        console.log('[Invoice] Updated invoice with recordId');
      }
      
      return existingInvoice;
    }

    // Generate invoice code
    const invoiceCode = await generateInvoiceCode();

    // Create invoice
    const invoice = await Invoice.create({
      invoiceCode,
      appointmentId: appointmentId || null,
      recordId: recordId || null,
      
      // Patient information
      patientId: patientId || null,
      patientInfo: {
        name: patientInfo?.name || 'Unknown Patient',
        phone: patientInfo?.phone || '0000000000',
        email: patientInfo?.email || '',
        address: patientInfo?.address || '',
        dateOfBirth: null
      },
      
      // Dentist information (will be updated from record if available)
      dentistId: null,
      dentistInfo: {
        name: 'TBD',
        specialization: '',
        licenseNumber: ''
      },
      
      // Financial details
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
      
      // Payment information
      paymentSummary: {
        paidAmount: paidAmount,
        remainingAmount: 0,
        paymentMethod: method,
        paymentStatus: 'paid',
        paymentId: paymentId,
        transactionId: paymentCode
      },
      
      // Status
      status: 'paid',
      
      // Notes
      notes: `Hóa đơn thanh toán sau điều trị. Phương thức: ${method === 'cash' ? 'Tiền mặt' : 'VNPay'}`,
      
      // Dates
      invoiceDate: new Date(),
      dueDate: new Date(),
      paidDate: completedAt || new Date(),
      
      // Created by
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

    console.log('[Invoice] Processing invoice.create_from_record event:', {
      recordId,
      appointmentId,
      totalAmount,
      depositPaid,
      finalAmount
    });

    // Validate required data
    if (!recordId || !appointmentId || !patientId) {
      console.error('[Invoice] Missing required fields in invoice.create_from_record event');
      return;
    }

    // Check if invoice already exists for this record
    const existingInvoice = await Invoice.findOne({ recordId });
    if (existingInvoice) {
      console.log('[Invoice] Invoice already exists for record:', recordId);
      return existingInvoice;
    }

    // Generate invoice number (will be auto-generated by pre-save hook)
    // But we need to generate it here to return in logs
    const invoiceNumber = await Invoice.generateInvoiceNumber();

    // Prepare patient info (use embedded data from event)
    const patientInfoData = {
      name: patientInfo?.name || 'Unknown Patient',
      phone: patientInfo?.phone || '0000000000',
      email: patientInfo?.email || '',
      address: patientInfo?.address || '',
      dateOfBirth: patientInfo?.dateOfBirth || null,
      gender: patientInfo?.gender || null,
      identityNumber: patientInfo?.identityNumber || null
    };

    // Prepare dentist info
    const dentistInfoData = {
      name: dentistName || 'Unknown Dentist',
      specialization: '',
      licenseNumber: ''
    };

    // Calculate discount info (if deposit was paid)
    const discountInfo = depositPaid > 0 ? {
      type: 'fixed_amount',
      value: depositPaid,
      reason: `Trừ tiền cọc đã thanh toán (${appointmentCode})`
    } : {
      type: 'none',
      value: 0
    };

    // Determine invoice status and payment info
    let invoiceStatus = 'pending';
    let paymentSummaryData = {
      totalPaid: 0,
      remainingAmount: finalAmount,
      paymentMethod: null,
      paymentIds: []
    };

    // If final amount is 0 (deposit covered everything), mark as paid
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

    // Create invoice with correct field names matching InvoiceSchema
    const invoice = await Invoice.create({
      invoiceNumber,
      appointmentId,
      recordId,
      type: 'treatment', // InvoiceType.TREATMENT
      status: invoiceStatus,
      
      // Patient information
      patientId,
      patientInfo: patientInfoData,
      
      // Dentist information
      dentistInfo: dentistInfoData,
      
      // Financial details
      subtotal: totalAmount,
      taxInfo: {
        taxRate: 0,
        taxAmount: 0,
        taxIncluded: true
      },
      discountInfo: discountInfo,
      totalAmount: finalAmount,
      
      // Payment information
      paymentSummary: paymentSummaryData,
      
      // Notes
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
          
          console.log('[Invoice] Created invoice detail for service:', service.serviceName);
        } catch (detailError) {
          console.error('[Invoice] Error creating invoice detail:', detailError);
        }
      }
    }

    // Publish invoice.created event back to record-service (to update record with invoiceId)
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
      console.log('[Invoice] Published invoice.created event to record-service');
    } catch (publishError) {
      console.error('[Invoice] Failed to publish invoice.created event:', publishError);
    }

    console.log(`[Invoice] Successfully created invoice ${invoice.invoiceNumber} from record ${recordCode}`);
    return invoice;

  } catch (error) {
    console.error('[Invoice] Error handling invoice.create_from_record event:', error);
    throw error;
  }
}

/**
 * Generate unique invoice code
 */
async function generateInvoiceCode() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  // Count invoices today
  const startOfDay = new Date(year, date.getMonth(), day, 0, 0, 0);
  const endOfDay = new Date(year, date.getMonth(), day, 23, 59, 59);
  
  const count = await Invoice.countDocuments({
    createdAt: { $gte: startOfDay, $lte: endOfDay }
  });
  
  const sequence = String(count + 1).padStart(4, '0');
  
  return `INV${year}${month}${day}${sequence}`;
}

/**
 * Setup event listeners for invoice service
 */
async function setupEventListeners() {
  try {
    // Connect to RabbitMQ
    await rabbitmqClient.connect();

    // Listen to appointment.created events
    await rabbitmqClient.consumeQueue('appointment.created', handleAppointmentCreated);

    // Listen to appointment.cancelled events
    await rabbitmqClient.consumeQueue('appointment.cancelled', handleAppointmentCancelled);

    // Listen to invoice_queue for payment.success and invoice.create_from_record events
    await rabbitmqClient.consumeQueue('invoice_queue', async (message) => {
      try {
        const { event, data } = message;
        
        if (event === 'payment.success') {
          await handlePaymentSuccess(data);
        } else if (event === 'invoice.create_from_record') {
          await handleInvoiceCreateFromRecord(data);
        } else {
          console.log('[Invoice] Unknown event from invoice_queue:', event);
        }
      } catch (error) {
        console.error('[Invoice] Error processing invoice_queue message:', error);
      }
    });

    // ✅ Simplified logs - will show in index.js only

  } catch (error) {
    console.error('[Invoice] Error setting up event listeners:', error);
    
    // Retry after 5 seconds
    setTimeout(() => {
      console.log('[Invoice] Retrying event listeners setup...');
      setupEventListeners();
    }, 5000);
  }
}

module.exports = {
  setupEventListeners,
  handleAppointmentCreated,
  handleAppointmentCancelled,
  handlePaymentSuccess,
  handleInvoiceCreateFromRecord
};

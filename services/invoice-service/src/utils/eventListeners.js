const Invoice = require('../models/invoice.model');
const InvoiceDetail = require('../models/invoiceDetail.model');
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
  handleAppointmentCancelled
};

const mongoose = require('mongoose');
const rabbitmqClient = require('../utils/rabbitmq.client');
const invoiceRepository = require('../repositories/invoice.repository');
const invoiceDetailRepository = require('../repositories/invoiceDetail.repository');
const invoiceService = require('../services/invoice.service');

/**
 * Generate unique invoice number
 * Format: INV-YYYYMMDD-000001
 */
async function generateInvoiceNumber() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  
  const count = await invoiceRepository.countInvoicesToday();
  const sequence = String(count + 1).padStart(6, '0');
  
  return `INV-${dateStr}-${sequence}`;
}

/**
 * Start consuming messages from invoice_queue
 */
async function startConsumer() {
  try {
    await rabbitmqClient.consumeFromQueue('invoice_queue', async (message) => {
      if (message.event === 'payment.completed') {
        const { reservationId, paymentId, paymentCode, amount, patientInfo, appointmentData } = message.data;

        if (!appointmentData) {
          console.warn('⚠️ No appointmentData, skipping...');
          return;
        }

        try {
          // Generate invoice number
          const invoiceNumber = await generateInvoiceNumber();

          // Build invoice document
          const invoiceDoc = {
            invoiceNumber,
            
            // Reference IDs
            patientId: appointmentData.patientId || null,
            appointmentId: null, // Will be updated by appointment-service event
            recordId: null,
            
            // Type and Status
            type: 'appointment',
            status: 'paid', // Already paid via VNPay
            
            // Patient Info
            patientInfo: {
              name: patientInfo?.name || appointmentData.patientInfo?.fullName || 'Patient',
              phone: patientInfo?.phone || appointmentData.patientInfo?.phone || '0000000000',
              email: patientInfo?.email || appointmentData.patientInfo?.email || null,
              address: patientInfo?.address || appointmentData.patientInfo?.address || null,
              dateOfBirth: appointmentData.patientInfo?.dateOfBirth || null
            },
            
            // Dentist Info
            dentistInfo: {
              name: appointmentData.dentistName || 'Dentist',
              specialization: null,
              licenseNumber: null
            },
            
            // Financial Info
            subtotal: amount,
            discountInfo: {
              type: 'none',
              value: 0,
              reason: null
            },
            taxInfo: {
              taxRate: 0,
              taxAmount: 0,
              taxIncluded: true
            },
            totalAmount: amount,
            
            // Payment Summary
            paymentSummary: {
              totalPaid: amount,
              remainingAmount: 0,
              lastPaymentDate: new Date(),
              paymentMethod: 'vnpay',
              paymentIds: [paymentId]
            },
            
            // Dates
            issueDate: new Date(),
            dueDate: new Date(),
            paidDate: new Date(),
            
            // Metadata
            reservationId: reservationId,
            notes: appointmentData.notes || '',
            createdBy: appointmentData.patientId || new mongoose.Types.ObjectId(),
            createdByRole: appointmentData.bookedByRole || 'patient'
          };

          // Create invoice in database
          const invoice = await invoiceRepository.createInvoice(invoiceDoc);

          console.log('✅ Invoice created:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber
          });

          // Create invoice detail for the service
          const invoiceDetailDoc = {
            // Required: Invoice reference
            invoiceId: invoice._id,
            
            // Required: Service Info
            serviceInfo: {
              name: appointmentData.serviceAddOnName || appointmentData.serviceName,
              code: null,
              type: appointmentData.serviceType === 'exam' ? 'examination' : 'filling',
              category: appointmentData.serviceType === 'exam' ? 'diagnostic' : 'restorative',
              description: `${appointmentData.serviceName}${appointmentData.serviceAddOnName ? ' - ' + appointmentData.serviceAddOnName : ''}`
            },
            
            // Optional: Service reference
            serviceId: appointmentData.serviceAddOnId || appointmentData.serviceId,
            
            // Required: Pricing
            quantity: 1,
            unitPrice: amount,
            
            // Optional: Discount
            discount: {
              type: 'none',
              value: 0,
              reason: null,
              approvedBy: null
            },
            
            // Required: Calculated amounts
            subtotal: amount,
            discountAmount: 0,
            totalPrice: amount,  // ✅ REQUIRED
            
            // Optional: Treatment info
            dentistId: appointmentData.dentistId || null,
            
            // Optional: Service delivery dates (use correct field names)
            scheduledDate: appointmentData.appointmentDate ? new Date(appointmentData.appointmentDate) : null,
            completedDate: new Date(), // Service completed when payment successful
            
            // Optional: Status
            status: 'completed',
            
            // Optional: Notes
            description: appointmentData.notes || null,
            notes: appointmentData.notes || null,
            
            // Optional: Audit
            createdBy: appointmentData.patientId || new mongoose.Types.ObjectId()
          };

          const invoiceDetail = await invoiceDetailRepository.createInvoiceDetail(invoiceDetailDoc);

          console.log('✅ Invoice detail created: detailId=' + invoiceDetail._id.toString());

        } catch (error) {
          console.error('❌ [Invoice Consumer] Error creating invoice:', {
            error: error.message,
            reservationId,
            stack: error.stack
          });
          throw error; // Will trigger RabbitMQ retry
        }
      } else if (message.event === 'appointment.created') {
        // Update invoice with appointmentId after appointment is created
        const { appointmentId, paymentId } = message.data;

        if (!appointmentId || !paymentId) {
          console.warn('⚠️ [Invoice Consumer] Missing appointmentId or paymentId in appointment.created event');
          return;
        }

        try {
          // Find invoice by paymentId
          const invoice = await invoiceRepository.findOne({ 
            'paymentSummary.paymentIds': paymentId 
          });

          if (!invoice) {
            console.warn('⚠️ Invoice not found for paymentId:', paymentId);
            return;
          }

          // Update invoice with appointmentId
          await invoiceRepository.updateAppointmentId(invoice._id, appointmentId);
          
          console.log('✅ Invoice linked to appointment:', {
            invoiceId: invoice._id.toString(),
            appointmentId
          });

        } catch (error) {
          console.error('❌ Error linking invoice:', error.message);
          throw error;
        }
      } else if (message.event === 'payment.completed.cash') {
        // ✅ Handle cash payment completion - use createInvoiceFromPayment with full record details
        const { 
          paymentId, 
          paymentCode, 
          amount,  // finalAmount (already deducted deposit)
          originalAmount,  // ✅ NEW: Original service amount before deposit
          discountAmount,  // ✅ NEW: Deposit amount
          method,
          patientId, 
          patientInfo, 
          appointmentId, 
          recordId,
          type,
          confirmedBy
        } = message.data;

        console.log('🔄 [Invoice Consumer] Processing payment.completed.cash:', {
          paymentId,
          paymentCode,
          amount,
          originalAmount,
          discountAmount,
          appointmentId,
          recordId,
          type
        });

        try {
          // 🔥 FIX: Use createInvoiceFromPayment to get FULL service details from record
          if (!paymentId) {
            console.error('❌ Missing paymentId in payment.completed.cash event');
            return;
          }

          console.log('📞 [Invoice Consumer] Calling createInvoiceFromPayment for paymentId:', paymentId);
          
          const invoice = await invoiceService.createInvoiceFromPayment(paymentId);
          
          console.log('✅ [Invoice Consumer] Invoice created via createInvoiceFromPayment:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber,
            totalAmount: invoice.totalAmount,
            detailsCount: invoice.details?.length || 0
          });

        } catch (error) {
          console.error('❌ [Invoice Consumer] Error creating invoice for cash payment:', {
            error: error.message,
            paymentId,
            stack: error.stack
          });
          throw error; // Will trigger RabbitMQ retry
        }
      } else if (message.event === 'payment.success') {
        // ✅ Handle payment success from record completion (VNPay, Stripe, or Cash)
        // Use createInvoiceFromPayment for consistency and to avoid code duplication
        const { 
          paymentId,
          paymentCode,
          recordId,
          method,
          originalAmount,
          paidAmount
        } = message.data;

        console.log('🔄 [Invoice Consumer] Processing payment.success:', {
          paymentId,
          paymentCode,
          recordId,
          method,
          originalAmount,
          paidAmount
        });

        try {
          // ✅ Use createInvoiceFromPayment to ensure consistent invoice creation
          // This function fetches full record details and creates invoice with all services
          console.log('📄 [Invoice Consumer] Creating invoice from payment using service:', paymentId);
          
          const invoice = await invoiceService.createInvoiceFromPayment(paymentId);

          console.log('✅ [Invoice Consumer] Invoice created successfully:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber,
            subtotal: invoice.subtotal,
            totalAmount: invoice.totalAmount,
            detailsCount: invoice.details?.length || 0
          });

        } catch (error) {
        console.error('❌ [Invoice Consumer] Error creating invoice for payment.success:', {
          error: error.message,
          paymentId,
          recordId,
          stack: error.stack
        });
        throw error; // Will trigger RabbitMQ retry
      }
    } else if (message.event === 'appointment_cancelled') {
      // ✅ Handle appointment cancellation - update invoice and invoice details to cancelled
      const { 
        appointmentId, 
        invoiceId, 
        cancelledBy, 
        cancelledByRole, 
        cancelReason, 
        cancelledAt 
      } = message.data;

      console.log('🔄 [Invoice Consumer] Processing appointment_cancelled:', {
        appointmentId,
        invoiceId,
        cancelReason
      });

      try {
        const { Invoice } = require('../models/invoice.model');
        const { InvoiceDetail } = require('../models/invoiceDetail.model');

        // Find invoice by invoiceId
        const invoice = await Invoice.findById(invoiceId);
        
        if (!invoice) {
          console.warn('⚠️ [Invoice Consumer] Invoice not found:', invoiceId);
          return;
        }

        // Check if invoice can be cancelled
        if (invoice.status === 'cancelled') {
          console.log('ℹ️ [Invoice Consumer] Invoice already cancelled:', invoice.invoiceNumber);
          return;
        }

        // Update invoice status to cancelled
        invoice.status = 'cancelled';
        invoice.cancelReason = cancelReason || 'Appointment cancelled';
        invoice.cancelledBy = cancelledBy;
        invoice.cancelledAt = cancelledAt || new Date();
        invoice.notes = `${invoice.notes || ''}\n\nĐã hủy bởi ${cancelledByRole}: ${cancelReason || 'Không rõ lý do'}`.trim();

        await invoice.save();

        console.log('✅ [Invoice Consumer] Invoice cancelled:', {
          invoiceId: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNumber
        });

        // Update all invoice details to cancelled
        const invoiceDetails = await InvoiceDetail.find({ 
          invoiceId: invoice._id,
          isActive: true 
        });

        for (const detail of invoiceDetails) {
          detail.status = 'cancelled';
          await detail.save();
        }

        console.log(`✅ [Invoice Consumer] Updated ${invoiceDetails.length} invoice detail(s) to cancelled`);

      } catch (error) {
        console.error('❌ [Invoice Consumer] Error cancelling invoice:', {
          error: error.message,
          invoiceId,
          appointmentId,
          stack: error.stack
        });
        throw error;
      }
    } else {
      console.log('ℹ️ [Invoice Consumer] Unhandled event type:', message.event);
    }
  });

  console.log('👂 [Invoice Consumer] Listening to invoice_queue...');
} catch (error) {
  console.error('❌ [Invoice Consumer] Failed to start consumer:', error);
  throw error;
}
}module.exports = { startConsumer };

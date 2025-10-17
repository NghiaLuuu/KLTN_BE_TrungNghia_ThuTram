const rabbitmqClient = require('../utils/rabbitmq.client');
const invoiceRepository = require('../repositories/invoice.repository');
const invoiceDetailRepository = require('../repositories/invoiceDetail.repository');

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
      console.log('📥 [Invoice Consumer] Received event:', {
        event: message.event,
        timestamp: new Date().toISOString()
      });

      if (message.event === 'payment.completed') {
        const { reservationId, paymentId, paymentCode, amount, patientInfo, appointmentData } = message.data;

        console.log('🔄 [Invoice Consumer] Processing payment.completed:', {
          reservationId,
          paymentId,
          paymentCode,
          amount
        });

        if (!appointmentData) {
          console.warn('⚠️ [Invoice Consumer] No appointmentData provided, skipping...');
          return;
        }

        // 🔍 DEBUG: Log received appointment data structure
        console.log('🔍 [Invoice Consumer] Received appointmentData:', {
          hasPatientId: !!appointmentData.patientId,
          hasPatientInfo: !!appointmentData.patientInfo,
          patientName: appointmentData.patientInfo?.fullName || appointmentData.patientInfo?.name,
          hasServiceId: !!appointmentData.serviceId,
          serviceName: appointmentData.serviceName,
          hasServiceAddOn: !!appointmentData.serviceAddOnId,
          serviceAddOnName: appointmentData.serviceAddOnName,
          serviceType: appointmentData.serviceType,
          hasDentistId: !!appointmentData.dentistId,
          dentistName: appointmentData.dentistName,
          hasAppointmentDate: !!appointmentData.appointmentDate,
          amount: amount
        });

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
            createdBy: appointmentData.patientId || null,
            createdByRole: appointmentData.bookedByRole || 'patient'
          };

          console.log('📝 [Invoice Consumer] Creating invoice:', {
            invoiceNumber,
            patientName: invoiceDoc.patientInfo.name,
            amount: invoiceDoc.totalAmount
          });

          // Create invoice in database
          const invoice = await invoiceRepository.createInvoice(invoiceDoc);

          console.log('✅ [Invoice Consumer] Invoice created:', {
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
            createdBy: appointmentData.patientId || null
          };

          console.log('📝 [Invoice Consumer] Creating invoice detail...');

          const invoiceDetail = await invoiceDetailRepository.createInvoiceDetail(invoiceDetailDoc);

          console.log('✅ [Invoice Consumer] Invoice detail created:', {
            detailId: invoiceDetail._id.toString(),
            serviceName: invoiceDetail.serviceInfo?.name || 'Unknown',
            totalPrice: invoiceDetail.totalPrice,
            unitPrice: invoiceDetail.unitPrice,
            quantity: invoiceDetail.quantity
          });

          console.log('✅ [Invoice Consumer] Invoice & detail created successfully');

        } catch (error) {
          console.error('❌ [Invoice Consumer] Error creating invoice:', {
            error: error.message,
            reservationId,
            stack: error.stack
          });
          throw error; // Will trigger RabbitMQ retry
        }
      } else if (message.event === 'appointment.created') {
        // ✅ NEW APPROACH: Use paymentId instead of reservationId to avoid race condition
        // When appointment is created, update invoice with appointmentId
        const { appointmentId, paymentId } = message.data;

        console.log('🔄 [Invoice Consumer] Processing appointment.created:', {
          appointmentId,
          paymentId
        });

        if (!appointmentId || !paymentId) {
          console.warn('⚠️ [Invoice Consumer] Missing appointmentId or paymentId, skipping...');
          return;
        }

        try {
          // Find invoice by paymentId (no race condition - invoice always created first)
          const invoice = await invoiceRepository.findOne({ 
            'paymentSummary.paymentIds': paymentId 
          });

          if (!invoice) {
            console.warn('⚠️ [Invoice Consumer] Invoice not found for paymentId:', paymentId);
            return;
          }

          console.log('📝 [Invoice Consumer] Updating invoice with appointmentId:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber,
            appointmentId
          });

          // Update invoice with appointmentId
          await invoiceRepository.updateAppointmentId(invoice._id, appointmentId);

          console.log('✅ [Invoice Consumer] Invoice updated with appointmentId');

          // 🔗 Now send event to appointment-service to update invoiceId
          console.log('📤 [Invoice Consumer] Publishing event to update appointment with invoiceId:', {
            invoiceId: invoice._id.toString(),
            paymentId: paymentId.toString(),
            appointmentId
          });

          // Publish event to appointment_queue to update invoiceId
          await rabbitmqClient.publishToQueue('appointment_queue', {
            event: 'invoice.created',
            data: {
              invoiceId: invoice._id.toString(),
              paymentId: paymentId.toString()
            }
          });

          console.log('✅ [Invoice Consumer] Event published to update appointment with invoiceId');

        } catch (error) {
          console.error('❌ [Invoice Consumer] Error linking invoice to appointment:', {
            error: error.message,
            appointmentId,
            paymentId,
            stack: error.stack
          });
          throw error; // Will trigger RabbitMQ retry
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
}

module.exports = { startConsumer };

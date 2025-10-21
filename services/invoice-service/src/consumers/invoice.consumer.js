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
      } else if (message.event === 'payment.completed.cash') {
        // ✅ Handle cash payment completion - create invoice with proper calculation
        const { 
          paymentId, 
          paymentCode, 
          amount, 
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
          appointmentId,
          recordId,
          type
        });

        try {
          // Determine if this is online booking (has appointmentId) or walk-in (has recordId)
          const isOnlineBooking = !!appointmentId;
          const isWalkIn = !!recordId && !appointmentId;

          // For online booking, we need to check if there's a deposit payment
          let depositAmount = 0;
          let finalAmount = amount;

          if (isOnlineBooking && type === 'payment') {
            // Query payment repository to find deposit payment for this appointment
            console.log('🔍 [Invoice Consumer] Checking for deposit payment...');
            
            try {
              // Call payment service to get deposit info
              const axios = require('axios');
              const paymentServiceUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3008';
              
              const depositResponse = await axios.get(
                `${paymentServiceUrl}/api/payment/appointment/${appointmentId}`,
                { 
                  headers: { 
                    'x-internal-call': 'true' 
                  },
                  timeout: 5000
                }
              );

              if (depositResponse.data && depositResponse.data.success) {
                const payments = depositResponse.data.data;
                const depositPayment = payments.find(p => p.type === 'deposit' && p.status === 'completed');
                
                if (depositPayment) {
                  depositAmount = depositPayment.finalAmount || 0;
                  finalAmount = amount - depositAmount;
                  
                  console.log('💰 [Invoice Consumer] Found deposit payment:', {
                    depositPaymentId: depositPayment._id,
                    depositAmount,
                    originalAmount: amount,
                    finalAmount
                  });
                }
              }
            } catch (error) {
              console.warn('⚠️ [Invoice Consumer] Could not fetch deposit info:', error.message);
              // Continue without deposit deduction if service is unavailable
            }
          }

          // Generate invoice number
          const invoiceNumber = await generateInvoiceNumber();

          // Get patient and service info
          let patientInfoDoc = patientInfo;
          let dentistInfoDoc = { name: 'Unknown Dentist' };
          let serviceDescription = 'Medical Service';

          // If we have appointmentId, fetch appointment details
          if (appointmentId) {
            try {
              const axios = require('axios');
              const appointmentServiceUrl = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
              
              const appointmentResponse = await axios.get(
                `${appointmentServiceUrl}/api/appointment/${appointmentId}`,
                {
                  headers: { 'x-internal-call': 'true' },
                  timeout: 5000
                }
              );

              if (appointmentResponse.data && appointmentResponse.data.success) {
                const appointment = appointmentResponse.data.data;
                patientInfoDoc = {
                  name: appointment.patientInfo?.name || patientInfo?.name,
                  phone: appointment.patientInfo?.phone || patientInfo?.phone,
                  email: appointment.patientInfo?.email || patientInfo?.email,
                  address: appointment.patientInfo?.address || patientInfo?.address
                };
                dentistInfoDoc = {
                  name: appointment.dentistName || 'Unknown Dentist'
                };
                serviceDescription = `${appointment.serviceName}${appointment.serviceAddOnName ? ' - ' + appointment.serviceAddOnName : ''}`;
              }
            } catch (error) {
              console.warn('⚠️ [Invoice Consumer] Could not fetch appointment details:', error.message);
            }
          }

          // If we have recordId, fetch record details
          if (recordId) {
            try {
              const axios = require('axios');
              const recordServiceUrl = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
              
              const recordResponse = await axios.get(
                `${recordServiceUrl}/api/record/${recordId}`,
                {
                  headers: { 'x-internal-call': 'true' },
                  timeout: 5000
                }
              );

              if (recordResponse.data && recordResponse.data.success) {
                const record = recordResponse.data.data;
                patientInfoDoc = {
                  name: record.patientInfo?.name || patientInfo?.name,
                  phone: record.patientInfo?.phone || patientInfo?.phone,
                  address: record.patientInfo?.address || patientInfo?.address
                };
                dentistInfoDoc = {
                  name: record.dentistName || 'Unknown Dentist'
                };
                serviceDescription = record.serviceName || 'Medical Service';
              }
            } catch (error) {
              console.warn('⚠️ [Invoice Consumer] Could not fetch record details:', error.message);
            }
          }

          // Build invoice document
          const invoiceDoc = {
            invoiceNumber,
            
            // Reference IDs
            patientId: patientId || null,
            appointmentId: appointmentId || null,
            recordId: recordId || null,
            
            // Type and Status
            type: isOnlineBooking ? 'appointment' : 'treatment',
            status: 'paid', // Cash payment confirmed
            
            // Patient Info
            patientInfo: {
              name: patientInfoDoc?.name || 'Walk-in Patient',
              phone: patientInfoDoc?.phone || '0000000000',
              email: patientInfoDoc?.email || null,
              address: patientInfoDoc?.address || null
            },
            
            // Dentist Info
            dentistInfo: {
              name: dentistInfoDoc?.name || 'Dentist',
              specialization: null,
              licenseNumber: null
            },
            
            // Financial Info
            subtotal: amount,
            discountInfo: {
              type: depositAmount > 0 ? 'fixed_amount' : 'none',
              value: depositAmount,
              reason: depositAmount > 0 ? 'Deposit deduction' : null
            },
            taxInfo: {
              taxRate: 0,
              taxAmount: 0,
              taxIncluded: true
            },
            totalAmount: finalAmount,
            
            // Payment Summary
            paymentSummary: {
              totalPaid: finalAmount,
              remainingAmount: 0,
              lastPaymentDate: new Date(),
              paymentMethod: 'cash',
              paymentIds: [paymentId]
            },
            
            // Dates
            issueDate: new Date(),
            dueDate: new Date(),
            paidDate: new Date(),
            
            // Metadata
            notes: depositAmount > 0 ? `Original amount: ${amount}, Deposit: ${depositAmount}, Final amount: ${finalAmount}` : '',
            createdBy: confirmedBy || null,
            createdByRole: 'receptionist'
          };

          console.log('📝 [Invoice Consumer] Creating invoice for cash payment:', {
            invoiceNumber,
            patientName: invoiceDoc.patientInfo.name,
            originalAmount: amount,
            depositAmount,
            finalAmount: invoiceDoc.totalAmount,
            type: invoiceDoc.type
          });

          // Create invoice in database
          const invoice = await invoiceRepository.createInvoice(invoiceDoc);

          console.log('✅ [Invoice Consumer] Invoice created:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber
          });

          // Create invoice detail
          const invoiceDetailDoc = {
            invoiceId: invoice._id,
            serviceInfo: {
              name: serviceDescription,
              code: null,
              type: isOnlineBooking ? 'appointment' : 'treatment',
              category: 'medical',
              description: serviceDescription
            },
            quantity: 1,
            unitPrice: amount,
            discount: {
              type: depositAmount > 0 ? 'fixed_amount' : 'none',
              value: depositAmount,
              reason: depositAmount > 0 ? 'Deposit deduction' : null
            },
            subtotal: amount,
            discountAmount: depositAmount,
            totalPrice: finalAmount,
            scheduledDate: new Date(),
            completedDate: new Date(),
            status: 'completed',
            description: serviceDescription,
            notes: depositAmount > 0 ? `Deposit deducted: ${depositAmount}` : null,
            createdBy: confirmedBy || null
          };

          console.log('📝 [Invoice Consumer] Creating invoice detail for cash payment...');

          const invoiceDetail = await invoiceDetailRepository.createInvoiceDetail(invoiceDetailDoc);

          console.log('✅ [Invoice Consumer] Invoice detail created:', {
            detailId: invoiceDetail._id.toString(),
            serviceName: invoiceDetail.serviceInfo?.name,
            totalPrice: invoiceDetail.totalPrice
          });

          console.log('✅ [Invoice Consumer] Cash payment invoice & detail created successfully');

        } catch (error) {
          console.error('❌ [Invoice Consumer] Error creating invoice for cash payment:', {
            error: error.message,
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

const mongoose = require('mongoose');
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
        // ✅ Handle cash payment completion - create invoice with proper calculation
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
          // ✅ Use payment data directly
          const actualOriginalAmount = originalAmount || amount; // Service price
          const actualDepositAmount = discountAmount || 0; // Deposit already paid
          const actualFinalAmount = amount; // Remaining to pay
          
          console.log('💰 [Invoice Consumer] Payment amounts:', {
            originalAmount: actualOriginalAmount,
            depositAmount: actualDepositAmount,
            finalAmount: actualFinalAmount,
            isFullyPaidByDeposit: actualFinalAmount === 0 && actualDepositAmount > 0
          });

          // ✅ For invoice, we ALWAYS use originalAmount for subtotal/totalAmount
          // Even if finalAmount = 0 (fully paid by deposit), invoice still shows the service cost
          const invoiceSubtotal = actualOriginalAmount; // Always use original service amount
          const invoiceTotalPaid = actualOriginalAmount; // Total paid = deposit + cash = original amount

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
            // ✅ FIXED: Always use originalAmount for invoice (even if fully paid by deposit)
            subtotal: invoiceSubtotal,  // Original service amount
            discountInfo: {
              type: 'none',  // No discount in invoice calculation (deposit already in payment)
              value: 0,
              reason: actualDepositAmount > 0 ? `Đã trừ tiền cọc ${actualDepositAmount.toLocaleString('vi-VN')}đ trong thanh toán` : null
            },
            taxInfo: {
              taxRate: 0,
              taxAmount: 0,
              taxIncluded: true
            },
            totalAmount: invoiceSubtotal,  // Will be recalculated by pre-save hook
            
            // Payment Summary
            paymentSummary: {
              totalPaid: invoiceTotalPaid,  // Total paid (including deposit)
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
            notes: actualDepositAmount > 0 
              ? (actualFinalAmount === 0 
                  ? `Tổng tiền dịch vụ: ${actualOriginalAmount.toLocaleString('vi-VN')}đ, Đã cọc đủ: ${actualDepositAmount.toLocaleString('vi-VN')}đ, Không cần thanh toán thêm` 
                  : `Tổng tiền dịch vụ: ${actualOriginalAmount.toLocaleString('vi-VN')}đ, Đã cọc: ${actualDepositAmount.toLocaleString('vi-VN')}đ, Thanh toán tiền mặt: ${actualFinalAmount.toLocaleString('vi-VN')}đ`)
              : `Thanh toán tiền mặt: ${actualFinalAmount.toLocaleString('vi-VN')}đ`,
            createdBy: confirmedBy || new mongoose.Types.ObjectId(),
            createdByRole: 'receptionist'
          };

          console.log('📝 [Invoice Consumer] Creating invoice for cash payment:', {
            invoiceNumber,
            patientName: invoiceDoc.patientInfo.name,
            originalAmount: actualOriginalAmount,
            depositAmount: actualDepositAmount,
            finalAmount: actualFinalAmount,
            invoiceSubtotal,
            invoiceTotalPaid,
            isFullyPaidByDeposit: actualFinalAmount === 0,
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
              type: appointmentId ? 'examination' : 'filling', // ✅ Use valid enum values
              category: appointmentId ? 'diagnostic' : 'restorative', // ✅ Use valid enum values
              description: serviceDescription
            },
            quantity: 1,
            unitPrice: actualOriginalAmount,  // ✅ Use original amount
            discount: {
              type: 'none',  // ✅ No discount in detail
              value: 0,
              reason: null
            },
            subtotal: actualOriginalAmount,
            discountAmount: 0,  // ✅ No discount at detail level
            totalPrice: actualOriginalAmount,  // ✅ Full amount (deposit already in payment summary)
            scheduledDate: new Date(),
            completedDate: new Date(),
            status: 'completed',
            description: serviceDescription,
            notes: actualDepositAmount > 0 ? `Đã trừ tiền cọc: ${actualDepositAmount.toLocaleString('vi-VN')}đ` : null,
            createdBy: confirmedBy || new mongoose.Types.ObjectId()
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
      } else if (message.event === 'payment.success') {
        // ✅ Handle payment success from record completion (VNPay or Cash)
        const { 
          paymentId,
          paymentCode,
          recordId,
          appointmentId,
          patientId,
          patientInfo,
          method,
          originalAmount,
          depositAmount,  // ✅ Amount already paid as deposit
          discountAmount, // ✅ Real discount (not deposit)
          taxAmount,      // ✅ Tax amount
          finalAmount,    // ✅ Remaining amount to pay (originalAmount - depositAmount - discountAmount + taxAmount)
          paidAmount,     // ✅ Amount paid in this transaction
          completedAt,
          processedByName
        } = message.data;

        console.log('🔄 [Invoice Consumer] Processing payment.success:', {
          paymentId,
          paymentCode,
          recordId,
          appointmentId,
          method,
          originalAmount,
          depositAmount,
          discountAmount,
          taxAmount,
          finalAmount,
          paidAmount
        });

        // ✅ Calculate actual amounts (handle undefined values)
        const actualDepositAmount = depositAmount || 0;
        const actualDiscountAmount = discountAmount || 0;
        const actualTaxAmount = taxAmount || 0;
        const actualPaidAmount = paidAmount || finalAmount || 0;

        console.log('💰 [Invoice Consumer] Calculated amounts:', {
          actualDepositAmount,
          actualDiscountAmount,
          actualTaxAmount,
          actualPaidAmount,
          totalPaidWillBe: actualDepositAmount + actualPaidAmount
        });

        // ✅ Check if payment amount is 0 (fully paid by deposit)
        if (actualPaidAmount === 0) {
          console.log('⚠️ [Invoice Consumer] Payment amount is 0 (fully covered by deposit). Skipping invoice creation.');
          console.log('✅ [Invoice Consumer] No invoice needed - service fully paid by deposit');
          channel.ack(msg);
          return;
        }

        try {
          // Generate invoice number
          const invoiceNumber = await generateInvoiceNumber();

          // Fetch record details to get service info
          let recordData = null;
          let serviceDescription = 'Medical Service';
          let dentistName = 'Dentist';

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
                recordData = recordResponse.data.data;
                // Build service description with addon and unit
                const serviceName = recordData.serviceName || 'Medical Service';
                const addonName = recordData.serviceAddOnName || '';
                const unit = recordData.serviceAddOnUnit || '';
                const quantity = recordData.quantity || 1;
                
                serviceDescription = addonName 
                  ? `${serviceName} - ${addonName}${unit ? ` (${quantity} ${unit})` : ''}`
                  : serviceName;
                
                dentistName = recordData.dentistName || 'Dentist';
                
                console.log('✅ [Invoice Consumer] Fetched record details:', {
                  recordId,
                  serviceName: serviceDescription,
                  dentistName,
                  quantity,
                  unit
                });
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
            type: recordId ? 'treatment' : 'appointment',
            status: 'paid',
            
            // Patient Info
            patientInfo: {
              name: patientInfo?.name || recordData?.patientInfo?.name || 'Patient',
              phone: patientInfo?.phone || recordData?.patientInfo?.phone || '0000000000',
              email: patientInfo?.email || recordData?.patientInfo?.email || null,
              address: patientInfo?.address || recordData?.patientInfo?.address || null
            },
            
            // Dentist Info
            dentistInfo: {
              name: dentistName,
              specialization: null,
              licenseNumber: null
            },
            
            // Financial Info
            // ✅ FIXED: subtotal = originalAmount (service price before any deductions)
            // totalAmount will be calculated by pre-save hook: originalAmount - discountAmount (if any) + taxAmount
            // depositAmount is tracked separately in paymentSummary
            subtotal: originalAmount,  // ✅ Original service price
            discountInfo: {
              type: actualDiscountAmount > 0 ? 'fixed_amount' : 'none',  // ✅ Real discount (not deposit)
              value: actualDiscountAmount,
              reason: actualDiscountAmount > 0 ? 'Giảm giá' : null
            },
            taxInfo: {
              taxRate: 0,
              taxAmount: actualTaxAmount,
              taxIncluded: true
            },
            totalAmount: originalAmount,  // ✅ Will be recalculated by pre-save hook
            
            // Payment Summary
            paymentSummary: {
              totalPaid: actualDepositAmount + actualPaidAmount,  // ✅ Total: deposit + current payment
              remainingAmount: 0,
              lastPaymentDate: completedAt || new Date(),
              paymentMethod: method || 'vnpay',
              paymentIds: [paymentId]
            },
            
            // Dates
            issueDate: new Date(),
            dueDate: new Date(),
            paidDate: completedAt || new Date(),
            
            // Metadata
            notes: actualDepositAmount > 0 
              ? `Tổng tiền dịch vụ: ${originalAmount.toLocaleString('vi-VN')}đ\nĐã cọc: ${actualDepositAmount.toLocaleString('vi-VN')}đ\nThanh toán ${method === 'vnpay' ? 'VNPay' : method === 'stripe' ? 'Stripe' : 'tiền mặt'}: ${actualPaidAmount.toLocaleString('vi-VN')}đ\nMã thanh toán: ${paymentCode}`
              : `Thanh toán qua ${method === 'vnpay' ? 'VNPay' : method === 'stripe' ? 'Stripe' : 'tiền mặt'} - Mã thanh toán: ${paymentCode}`,
            createdBy: patientId || new mongoose.Types.ObjectId(), // ✅ Create dummy ObjectId if no patientId
            createdByRole: 'system'
          };

          console.log('📝 [Invoice Consumer] Creating invoice for payment.success:', {
            invoiceNumber,
            patientName: invoiceDoc.patientInfo.name,
            originalAmount,
            depositAmount: actualDepositAmount,
            discountAmount: actualDiscountAmount,
            paidAmount: actualPaidAmount,
            subtotal: invoiceDoc.subtotal,
            totalAmount: invoiceDoc.totalAmount,
            totalPaid: invoiceDoc.paymentSummary.totalPaid,
            paymentMethod: method
          });

          // Create invoice in database
          const invoice = await invoiceRepository.createInvoice(invoiceDoc);

          console.log('✅ [Invoice Consumer] Invoice created:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber,
            subtotal: invoice.subtotal,
            totalAmount: invoice.totalAmount,
            totalPaid: invoice.paymentSummary.totalPaid,
            isBalanced: invoice.totalAmount === invoice.paymentSummary.totalPaid
          });

          // ✅ Create invoice details for main service AND additional services
          const invoiceDetails = [];
          
          // 1️⃣ Main service detail
          if (recordData) {
            const mainServiceName = recordData.serviceName || 'Medical Service';
            const mainAddonName = recordData.serviceAddOnName || '';
            const mainUnit = recordData.serviceAddOnUnit || '';
            const mainQuantity = recordData.quantity || 1;
            // ✅ FIXED: Use originalAmount from payment if recordData price is 0
            const mainPrice = recordData.serviceAddOnPrice || originalAmount || 0;
            const mainTotal = mainPrice * mainQuantity;
            
            console.log('💵 [Invoice Consumer] Calculating main service detail:', {
              serviceAddOnPrice: recordData.serviceAddOnPrice,
              originalAmountFromPayment: originalAmount,
              mainPriceUsed: mainPrice,
              mainQuantity,
              mainTotal
            });
            
            const mainServiceDescription = mainAddonName 
              ? `${mainServiceName} - ${mainAddonName}`
              : mainServiceName;
            
            // ✅ Determine service type based on record type
            const serviceType = recordData.type === 'exam' ? 'examination' : 'filling'; // Default to filling for treatment
            const serviceCategory = recordData.type === 'exam' ? 'diagnostic' : 'restorative';
            
            const mainDetailDoc = {
              invoiceId: invoice._id,
              serviceInfo: {
                name: mainServiceDescription,
                code: null,
                type: serviceType,
                category: serviceCategory,
                description: mainServiceDescription,
                unit: mainUnit || null
              },
              quantity: mainQuantity,
              unitPrice: mainPrice,
              discount: {
                type: actualDiscountAmount > 0 ? 'fixed_amount' : 'none',
                value: actualDiscountAmount,
                reason: actualDiscountAmount > 0 ? 'Giảm giá' : null
              },
              subtotal: mainTotal,
              discountAmount: 0,
              totalPrice: mainTotal,
              scheduledDate: recordData.appointmentDate ? new Date(recordData.appointmentDate) : new Date(),
              completedDate: completedAt || new Date(),
              status: 'completed',
              description: mainServiceDescription,
              notes: null,
              createdBy: patientId || new mongoose.Types.ObjectId()
            };
            
            const mainDetail = await invoiceDetailRepository.createInvoiceDetail(mainDetailDoc);
            invoiceDetails.push(mainDetail);
            
            console.log('✅ [Invoice Consumer] Main service detail created:', {
              detailId: mainDetail._id.toString(),
              serviceName: mainServiceDescription,
              quantity: mainQuantity,
              unit: mainUnit,
              totalPrice: mainTotal
            });
          }
          
          // 2️⃣ Additional services details
          if (recordData?.additionalServices && recordData.additionalServices.length > 0) {
            for (const addSvc of recordData.additionalServices) {
              const addServiceName = addSvc.serviceName || 'Additional Service';
              const addAddonName = addSvc.serviceAddOnName || '';
              const addUnit = addSvc.serviceAddOnUnit || '';
              const addQuantity = addSvc.quantity || 1;
              const addPrice = addSvc.price || 0;
              const addTotal = addSvc.totalPrice || (addPrice * addQuantity);
              
              const addServiceDescription = addAddonName 
                ? `${addServiceName} - ${addAddonName}`
                : addServiceName;
              
              // ✅ Determine service type for additional services (default to filling/restorative)
              const addServiceType = addSvc.type === 'exam' ? 'examination' : 'filling';
              const addServiceCategory = addSvc.type === 'exam' ? 'diagnostic' : 'restorative';
              
              const addDetailDoc = {
                invoiceId: invoice._id,
                serviceInfo: {
                  name: addServiceDescription,
                  code: null,
                  type: addServiceType,
                  category: addServiceCategory,
                  description: addServiceDescription,
                  unit: addUnit || null
                },
                quantity: addQuantity,
                unitPrice: addPrice,
                discount: {
                  type: 'none',
                  value: 0,
                  reason: null
                },
                subtotal: addTotal,
                discountAmount: 0,
                totalPrice: addTotal,
                scheduledDate: recordData.appointmentDate ? new Date(recordData.appointmentDate) : new Date(),
                completedDate: completedAt || new Date(),
                status: 'completed',
                description: addServiceDescription,
                notes: 'Dịch vụ bổ sung',
                createdBy: patientId || new mongoose.Types.ObjectId()
              };
              
              const addDetail = await invoiceDetailRepository.createInvoiceDetail(addDetailDoc);
              invoiceDetails.push(addDetail);
              
              console.log('✅ [Invoice Consumer] Additional service detail created:', {
                detailId: addDetail._id.toString(),
                serviceName: addServiceDescription,
                quantity: addQuantity,
                unit: addUnit,
                totalPrice: addTotal
              });
            }
          }
          
          // 3️⃣ Add discount as a separate "service" if there's a deposit deduction
          if (discountAmount > 0) {
            const discountDetailDoc = {
              invoiceId: invoice._id,
              serviceInfo: {
                name: 'Giảm trừ tiền cọc',
                code: null,
                type: 'consultation', // ✅ Use valid enum value
                category: 'diagnostic', // ✅ Use valid enum value
                description: `Đã cọc trước ${discountAmount.toLocaleString('vi-VN')}đ`,
                unit: null
              },
              quantity: 1,
              unitPrice: -discountAmount,  // Negative amount
              discount: {
                type: 'none',
                value: 0,
                reason: null
              },
              subtotal: -discountAmount,
              discountAmount: 0,
              totalPrice: -discountAmount,
              scheduledDate: recordData?.appointmentDate ? new Date(recordData.appointmentDate) : new Date(),
              completedDate: completedAt || new Date(),
              status: 'completed',
              description: 'Giảm trừ tiền cọc',
              notes: 'Deposit deduction',
              createdBy: patientId || new mongoose.Types.ObjectId()
            };
            
            const discountDetail = await invoiceDetailRepository.createInvoiceDetail(discountDetailDoc);
            invoiceDetails.push(discountDetail);
            
            console.log('✅ [Invoice Consumer] Deposit deduction detail created:', {
              detailId: discountDetail._id.toString(),
              amount: -discountAmount
            });
          }

          console.log(`✅ [Invoice Consumer] Created ${invoiceDetails.length} invoice detail(s) total`);

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

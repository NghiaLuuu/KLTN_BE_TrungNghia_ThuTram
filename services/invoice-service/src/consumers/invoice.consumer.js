const mongoose = require('mongoose');
const rabbitmqClient = require('../utils/rabbitmq.client');
const invoiceRepository = require('../repositories/invoice.repository');
const invoiceDetailRepository = require('../repositories/invoiceDetail.repository');
const invoiceService = require('../services/invoice.service');

/**
 * Tạo mã hóa đơn duy nhất
 * Định dạng: INV-YYYYMMDD-000001
 */
async function generateInvoiceNumber() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
  
  const count = await invoiceRepository.countInvoicesToday();
  const sequence = String(count + 1).padStart(6, '0');
  
  return `INV-${dateStr}-${sequence}`;
}

/**
 * Bắt đầu lắng nghe tin nhắn từ invoice_queue
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
          // Tạo mã hóa đơn
          const invoiceNumber = await generateInvoiceNumber();

          // Xây dựng document hóa đơn
          const invoiceDoc = {
            invoiceNumber,
            
            // Các ID tham chiếu
            patientId: appointmentData.patientId || null,
            appointmentId: null, // Sẽ được cập nhật bởi sự kiện từ appointment-service
            recordId: null,
            
            // Loại và Trạng thái
            type: 'appointment',
            status: 'paid', // Đã thanh toán qua VNPay
            
            // Thông tin Bệnh nhân
            patientInfo: {
              name: patientInfo?.name || appointmentData.patientInfo?.fullName || 'Patient',
              phone: patientInfo?.phone || appointmentData.patientInfo?.phone || '0000000000',
              email: patientInfo?.email || appointmentData.patientInfo?.email || null,
              address: patientInfo?.address || appointmentData.patientInfo?.address || null,
              dateOfBirth: appointmentData.patientInfo?.dateOfBirth || null
            },
            
            // Thông tin Nha sĩ
            dentistInfo: {
              name: appointmentData.dentistName || 'Dentist',
              specialization: null,
              licenseNumber: null
            },
            
            // Thông tin Tài chính
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
            
            // Tổng hợp Thanh toán
            paymentSummary: {
              totalPaid: amount,
              remainingAmount: 0,
              lastPaymentDate: new Date(),
              paymentMethod: 'vnpay',
              paymentIds: [paymentId]
            },
            
            // Các Ngày
            issueDate: new Date(),
            dueDate: new Date(),
            paidDate: new Date(),
            
            // Metadata
            reservationId: reservationId,
            notes: appointmentData.notes || '',
            createdBy: appointmentData.patientId || new mongoose.Types.ObjectId(),
            createdByRole: appointmentData.bookedByRole || 'patient'
          };

          // Tạo hóa đơn trong database
          const invoice = await invoiceRepository.createInvoice(invoiceDoc);

          console.log('✅ Invoice created:', {
            invoiceId: invoice._id.toString(),
            invoiceNumber: invoice.invoiceNumber
          });

          // Tạo chi tiết hóa đơn cho dịch vụ
          const invoiceDetailDoc = {
            // Bắt buộc: Tham chiếu Hóa đơn
            invoiceId: invoice._id,
            
            // Bắt buộc: Thông tin Dịch vụ
            serviceInfo: {
              name: appointmentData.serviceAddOnName || appointmentData.serviceName,
              code: null,
              type: appointmentData.serviceType === 'exam' ? 'examination' : 'filling',
              category: appointmentData.serviceType === 'exam' ? 'diagnostic' : 'restorative',
              description: `${appointmentData.serviceName}${appointmentData.serviceAddOnName ? ' - ' + appointmentData.serviceAddOnName : ''}`
            },
            
            // Tùy chọn: Tham chiếu dịch vụ
            serviceId: appointmentData.serviceAddOnId || appointmentData.serviceId,
            
            // Bắt buộc: Giá
            quantity: 1,
            unitPrice: amount,
            
            // Tùy chọn: Giảm giá
            discount: {
              type: 'none',
              value: 0,
              reason: null,
              approvedBy: null
            },
            
            // Bắt buộc: Số tiền đã tính
            subtotal: amount,
            discountAmount: 0,
            totalPrice: amount,  // ✅ BẮT BUỘC
            
            // Tùy chọn: Thông tin điều trị
            dentistId: appointmentData.dentistId || null,
            
            // Tùy chọn: Ngày cung cấp dịch vụ (dùng đúng tên trường)
            scheduledDate: appointmentData.appointmentDate ? new Date(appointmentData.appointmentDate) : null,
            completedDate: new Date(), // Dịch vụ hoàn thành khi thanh toán thành công
            
            // Tùy chọn: Trạng thái
            status: 'completed',
            
            // Tùy chọn: Ghi chú
            description: appointmentData.notes || null,
            notes: appointmentData.notes || null,
            
            // Tùy chọn: Kiểm toán
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
          throw error; // Sẽ kích hoạt RabbitMQ thử lại
        }
      } else if (message.event === 'appointment.created') {
        // Cập nhật hóa đơn với appointmentId sau khi lịch hẹn được tạo
        const { appointmentId, paymentId } = message.data;

        if (!appointmentId || !paymentId) {
          console.warn('⚠️ [Invoice Consumer] Missing appointmentId or paymentId in appointment.created event');
          return;
        }

        try {
          // Tìm hóa đơn theo paymentId
          const invoice = await invoiceRepository.findOne({ 
            'paymentSummary.paymentIds': paymentId 
          });

          if (!invoice) {
            console.warn('⚠️ Không tìm thấy hóa đơn cho paymentId:', paymentId);
            return;
          }

          // Cập nhật hóa đơn với appointmentId
          await invoiceRepository.updateAppointmentId(invoice._id, appointmentId);
          
          console.log('✅ Invoice linked to appointment:', {
            invoiceId: invoice._id.toString(),
            appointmentId
          });

        } catch (error) {
          console.error('❌ Lỗi liên kết hóa đơn:', error.message);
          throw error;
        }
      } else if (message.event === 'payment.completed.cash') {
        // ✅ Xử lý hoàn tất thanh toán tiền mặt - dùng createInvoiceFromPayment với đầy đủ chi tiết hồ sơ
        const { 
          paymentId, 
          paymentCode, 
          amount,  // finalAmount (số tiền đã trừ cọc)
          originalAmount,  // ✅ MỚI: Số tiền dịch vụ gốc trước khi trừ cọc
          discountAmount,  // ✅ MỚI: Số tiền cọc
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
          // 🔥 SỬA LỖI: Dùng createInvoiceFromPayment để lấy ĐẦY ĐỦ chi tiết dịch vụ từ hồ sơ
          if (!paymentId) {
            console.error('❌ Thiếu paymentId trong sự kiện payment.completed.cash');
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
          throw error; // Sẽ kích hoạt RabbitMQ thử lại
        }
      } else if (message.event === 'payment.success') {
        // ✅ Xử lý thanh toán thành công từ hoàn tất hồ sơ (VNPay, Stripe, hoặc Tiền mặt)
        // Dùng createInvoiceFromPayment để đồng nhất và tránh trùng lặp code
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
          // ✅ Dùng createInvoiceFromPayment để đảm bảo tạo hóa đơn đồng nhất
          // Hàm này lấy đầy đủ chi tiết hồ sơ và tạo hóa đơn với tất cả dịch vụ
          console.log('📄 [Invoice Consumer] Đang tạo hóa đơn từ thanh toán dùng service:', paymentId);
          
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
        throw error; // Sẽ kích hoạt RabbitMQ thử lại
      }
    } else if (message.event === 'appointment_cancelled') {
      // ✅ Xử lý hủy lịch hẹn - cập nhật hóa đơn và chi tiết hóa đơn thành đã hủy
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

        // Kiểm tra xem hóa đơn có thể hủy được không
        if (invoice.status === 'cancelled') {
          console.log('ℹ️ [Invoice Consumer] Hóa đơn đã được hủy rồi:', invoice.invoiceNumber);
          return;
        }

        // Cập nhật trạng thái hóa đơn thành đã hủy
        invoice.status = 'cancelled';
        invoice.cancelReason = cancelReason || 'Lịch hẹn đã hủy';
        // 🔥 SỬA LỖI: cancelledBy phải là ObjectId hoặc null, không phải string 'system'
        invoice.cancelledBy = (cancelledBy && cancelledBy !== 'system') ? cancelledBy : null;
        invoice.cancelledAt = cancelledAt || new Date();
        invoice.notes = `${invoice.notes || ''}\n\nĐã hủy bởi ${cancelledByRole || 'system'}: ${cancelReason || 'Không rõ lý do'}`.trim();

        await invoice.save();

        console.log('✅ [Invoice Consumer] Đã hủy hóa đơn:', {
          invoiceId: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNumber
        });

        // Cập nhật tất cả chi tiết hóa đơn thành đã hủy
        const invoiceDetails = await InvoiceDetail.find({ 
          invoiceId: invoice._id,
          isActive: true 
        });

        for (const detail of invoiceDetails) {
          detail.status = 'cancelled';
          await detail.save();
        }

        console.log(`✅ [Invoice Consumer] Đã cập nhật ${invoiceDetails.length} chi tiết hóa đơn thành đã hủy`);

      } catch (error) {
        console.error('❌ [Invoice Consumer] Error cancelling invoice:', {
          error: error.message,
          invoiceId,
          appointmentId,
          stack: error.stack
        });
        throw error;
      }
    } else if (message.event === 'appointment_restored') {
      // 🆕 Xử lý khôi phục lịch hẹn - khôi phục hóa đơn và chi tiết hóa đơn thành đã thanh toán
      const { 
        appointmentId, 
        invoiceId, 
        restoredBy, 
        restoredByRole, 
        reason, 
        restoredAt 
      } = message.data;

      console.log('🔄 [Invoice Consumer] Processing appointment_restored:', {
        appointmentId,
        invoiceId,
        reason
      });

      try {
        const { Invoice } = require('../models/invoice.model');
        const { InvoiceDetail } = require('../models/invoiceDetail.model');

        // Tìm hóa đơn theo invoiceId
        const invoice = await Invoice.findById(invoiceId);
        
        if (!invoice) {
          console.warn('⚠️ [Invoice Consumer] Không tìm thấy hóa đơn:', invoiceId);
          return;
        }

        // Kiểm tra xem hóa đơn có thể khôi phục được không (phải đang bị hủy)
        if (invoice.status !== 'cancelled') {
          console.log('ℹ️ [Invoice Consumer] Hóa đơn chưa bị hủy, bỏ qua khôi phục:', invoice.invoiceNumber);
          return;
        }

        // Khôi phục trạng thái hóa đơn thành đã thanh toán
        invoice.status = 'paid';
        invoice.cancelReason = null;
        invoice.cancelledBy = null;
        invoice.cancelledAt = null;
        invoice.notes = `${invoice.notes || ''}\n\nĐã khôi phục: ${reason || 'Slot được bật lại'}`.trim();

        await invoice.save();

        console.log('✅ [Invoice Consumer] Đã khôi phục hóa đơn:', {
          invoiceId: invoice._id.toString(),
          invoiceNumber: invoice.invoiceNumber
        });

        // Khôi phục tất cả chi tiết hóa đơn thành hoàn tất
        const invoiceDetails = await InvoiceDetail.find({ 
          invoiceId: invoice._id
        });

        for (const detail of invoiceDetails) {
          detail.status = 'completed';
          await detail.save();
        }

        console.log(`✅ [Invoice Consumer] Đã khôi phục ${invoiceDetails.length} chi tiết hóa đơn thành hoàn tất`);

      } catch (error) {
        console.error('❌ [Invoice Consumer] Error restoring invoice:', {
          error: error.message,
          invoiceId,
          appointmentId,
          stack: error.stack
        });
        throw error;
      }
    } else {
      console.log('ℹ️ [Invoice Consumer] Loại sự kiện chưa xử lý:', message.event);
    }
  });

  console.log('👂 [Invoice Consumer] Đang lắng nghe invoice_queue...');
} catch (error) {
  console.error('❌ [Invoice Consumer] Không thể khởi động consumer:', error);
  throw error;
}
}module.exports = { startConsumer };

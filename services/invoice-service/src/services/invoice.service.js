const mongoose = require('mongoose');
const invoiceRepo = require("../repositories/invoice.repository");
const invoiceDetailRepo = require("../repositories/invoiceDetail.repository");
const RedisClient = require("../config/redis.config");
const RPCClient = require("../config/rpc.config");
const { InvoiceStatus, InvoiceType } = require("../models/invoice.model");

class InvoiceService {
  constructor() {
    this.redis = RedisClient;
    this.rpcClient = RPCClient;
    this.cacheTimeout = 300; // 5 phút
  }

  // ============ CÁC THAO TÁC HÓA ĐƠN CHÍNH ============
  async createInvoice(invoiceData, userId) {
    try {
      // Xác thực cuộc hẹn nếu được cung cấp VÀ thông tin bệnh nhân chưa có
      // 🔥 SỬa: Bỏ qua xác thực cuộc hẹn nếu patientId và patientInfo đã có
      // Tránh gọi RPC không cần thiết khi tạo hóa đơn từ thanh toán
      if (invoiceData.appointmentId && (!invoiceData.patientId || !invoiceData.patientInfo)) {
        console.log('📞 Lấy thông tin cuộc hẹn để có thông tin bệnh nhân:', invoiceData.appointmentId);
        const appointment = await this.rpcClient.call('appointment-service', 'getAppointmentById', {
          id: invoiceData.appointmentId
        });

        if (!appointment) {
          throw new Error('Appointment không tồn tại');
        }

        // Chỉ tạo hóa đơn nếu cuộc hẹn đã hoàn thành hoặc đã xác nhận
        if (!['completed', 'confirmed'].includes(appointment.status)) {
          throw new Error('Chỉ có thể tạo hóa đơn cho cuộc hẹn đã hoàn thành hoặc đã xác nhận');
        }

        // Tự động điền thông tin bệnh nhân từ cuộc hẹn
        invoiceData.patientId = appointment.patientId;
        invoiceData.patientInfo = appointment.patientInfo;
      } else if (invoiceData.appointmentId) {
        console.log('✅ Bỏ qua xác thực cuộc hẹn - thông tin bệnh nhân đã có');
      }

      // Tạo số hóa đơn
      invoiceData.invoiceNumber = await this.generateInvoiceNumber();

      // Thiết lập giá trị mặc định
      // 🔥 SỬa: Đảm bảo userId luôn là ObjectId
      if (typeof userId === 'string' && userId !== 'system') {
        try {
          invoiceData.createdBy = new mongoose.Types.ObjectId(userId);
        } catch (e) {
          invoiceData.createdBy = invoiceData.dentistInfo?.dentistId || new mongoose.Types.ObjectId();
        }
      } else if (mongoose.Types.ObjectId.isValid(userId)) {
        invoiceData.createdBy = userId;
      } else {
        invoiceData.createdBy = invoiceData.dentistInfo?.dentistId || new mongoose.Types.ObjectId();
      }
      
      invoiceData.status = invoiceData.status || InvoiceStatus.DRAFT;
      invoiceData.type = invoiceData.type || InvoiceType.APPOINTMENT;

      // Tính ngày đến hạn nếu không được cung cấp
      if (!invoiceData.dueDate) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 7); // Mặc định 7 ngày
        invoiceData.dueDate = dueDate;
      }

      // Tạo hóa đơn
      const invoice = await invoiceRepo.create(invoiceData);

      // Tạo chi tiết hóa đơn nếu được cung cấp
      if (invoiceData.details && invoiceData.details.length > 0) {
        const detailsWithInvoiceId = invoiceData.details.map(detail => ({
          ...detail,
          invoiceId: invoice._id,
          createdBy: detail.createdBy || userId || 'system', // Ensure createdBy is set
          // 🔥 SỬa: Đảm bảo completedDate được thiết lập để thống kê doanh thu hoạt động đúng
          completedDate: detail.completedDate || (detail.status === 'completed' ? new Date() : null)
        }));

        console.log('💾 Creating', detailsWithInvoiceId.length, 'invoice details');
        const createdDetails = await invoiceDetailRepo.createMultiple(detailsWithInvoiceId);
        console.log('✅ Created invoice details:', createdDetails.map(d => ({
          name: d.serviceInfo?.name,
          unitPrice: d.unitPrice,
          quantity: d.quantity,
          totalPrice: d.totalPrice
        })));
        
        // 🔥 SỬa: Tính tổng số tiền - sử dụng totalPrice không phải totalAmount
        const subtotalAmount = createdDetails.reduce((sum, detail) => sum + (detail.totalPrice || 0), 0);
        
        // Cập nhật hóa đơn với số tiền đã tính
        // 🔥 QUAN TRỌNG: Không ghi đè totalAmount nếu đã được set rõ ràng (từ thanh toán có cọc)
        // 🔥 MỚI: Sử dụng invoiceData.subtotal nếu được set (bao gồm cộng thêm cọc để hiển thị)
        const updateData = {
          subtotal: invoiceData.subtotal !== undefined ? invoiceData.subtotal : subtotalAmount
        };
        
        // Kiểm tra xem totalAmount có được set rõ ràng không (ví dụ: từ thanh toán có cọc)
        // invoiceData.totalAmount sẽ được set khi tạo hóa đơn từ thanh toán
        const totalAmountExplicitlySet = invoiceData.hasOwnProperty('totalAmount') && 
                                         invoiceData.totalAmount !== undefined && 
                                         invoiceData.totalAmount !== null;
        
        if (totalAmountExplicitlySet) {
          // Giữ nguyên totalAmount đã set rõ ràng (từ thanh toán)
          updateData.totalAmount = invoiceData.totalAmount;
          console.log('💰 Giữ nguyên totalAmount rõ ràng:', invoiceData.totalAmount, '(từ thanh toán, subtotal:', subtotalAmount, ')');
        } else {
          // Tính totalAmount từ subtotal (tạo hóa đơn bình thường)
          updateData.totalAmount = subtotalAmount + (invoice.taxInfo?.taxAmount || 0) - (invoice.discountInfo?.discountAmount || 0);
          console.log('💰 Đã tính totalAmount:', updateData.totalAmount);
        }
        
        const updatedInvoice = await invoiceRepo.update(invoice._id, updateData);
        
        console.log('💰 Đã cập nhật hóa đơn với subtotal:', subtotalAmount);
        
        // Xóa cache
        await this.clearInvoiceCache();

        console.log("✅ Đã tạo hóa đơn:", updatedInvoice);
        return updatedInvoice;
      }

      // Xóa cache
      await this.clearInvoiceCache();

      console.log("✅ Đã tạo hóa đơn:", invoice);
      return invoice;
    } catch (error) {
      console.error("❌ Lỗi tạo hóa đơn:", error);
      throw error;
    }
  }

  async updateInvoice(id, updateData, userId) {
    try {
      const invoice = await invoiceRepo.findById(id);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Kiểm tra xem hóa đơn có thể cập nhật được không
      if (invoice.status === InvoiceStatus.PAID) {
        throw new Error('Không thể cập nhật hóa đơn đã thanh toán');
      }

      updateData.updatedBy = userId;
      const updatedInvoice = await invoiceRepo.update(id, updateData);

      // Xóa cache
      await this.clearInvoiceCache(id);

      return updatedInvoice;
    } catch (error) {
      console.error("❌ Lỗi cập nhật hóa đơn:", error);
      throw error;
    }
  }

  async getInvoiceById(id, useCache = true) {
    try {
      const cacheKey = `invoice:${id}`;

      if (useCache) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const invoice = await invoiceRepo.findById(id);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Lấy chi tiết hóa đơn
      const details = await invoiceDetailRepo.findByInvoice(id, { populateService: true });
      
      const result = {
        ...invoice.toObject(),
        details
      };

      // Lưu vào cache
      if (useCache) {
        await this.redis.setex(cacheKey, this.cacheTimeout, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      console.error("❌ Lỗi lấy hóa đơn:", error);
      throw error;
    }
  }

  async getInvoices(filter = {}, options = {}) {
    try {
      // ⚠️ Tạm thời bỏ qua cache để debug
      const useCache = false;
      const cacheKey = `invoices:${JSON.stringify({ filter, options })}`;
      
      if (useCache) {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }

      const result = await invoiceRepo.findAll(filter, options);

      // ✅ Điền chi tiết hóa đơn cho mỗi hóa đơn
      if (result.invoices && result.invoices.length > 0) {
        const invoicesWithDetails = await Promise.all(
          result.invoices.map(async (invoice) => {
            const details = await invoiceDetailRepo.findByInvoice(invoice._id);
            // console.log(`📋 [Invoice Service] Invoice ${invoice.invoiceNumber} has ${details.length} details`);
            return {
              ...invoice.toObject ? invoice.toObject() : invoice,
              details
            };
          })
        );
        result.invoices = invoicesWithDetails;
      }

      // Cache trong thời gian ngắn hơn vì dữ liệu thay đổi thường xuyên
      if (useCache) {
        await this.redis.setex(cacheKey, 60, JSON.stringify(result));
      }

      return result;
    } catch (error) {
      console.error("❌ Lỗi lấy danh sách hóa đơn:", error);
      throw error;
    }
  }

  async searchInvoices(searchTerm, options = {}) {
    try {
      return await invoiceRepo.search(searchTerm, options);
    } catch (error) {
      console.error("❌ Lỗi tìm kiếm hóa đơn:", error);
      throw error;
    }
  }

  // ============ CÁC PHƯƠNG THỨC TÍCH HỢP THANH TOÁN ============
  async handlePaymentSuccess(paymentData) {
    try {
      console.log("🔄 Đang xử lý thanh toán thành công cho hóa đơn:", paymentData);

      const { invoiceId, paymentId, amount, paymentMethod } = paymentData;

      const invoice = await invoiceRepo.findById(invoiceId);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      // Thêm thanh toán vào hóa đơn
      const updatedInvoice = await invoiceRepo.addPaymentToInvoice(invoiceId, {
        paymentId,
        amount,
        method: paymentMethod
      });

      // Xóa cache
      await this.clearInvoiceCache(invoiceId);

      // Gửi thông báo nếu cần
      await this.sendPaymentNotification(updatedInvoice);

      console.log("✅ Đã xử lý thanh toán thành công cho hóa đơn:", invoiceId);
      return updatedInvoice;
    } catch (error) {
      console.error("❌ Lỗi xử lý thanh toán:", error);
      throw error;
    }
  }

  async createInvoiceFromPayment(paymentIdOrData) {
    try {
      // 🔥 SỬa: Hỗ trợ cả paymentId (chuỗi) và paymentData (đối tượng)
      let paymentData;
      if (typeof paymentIdOrData === 'string') {
        console.log('📞 Lấy thanh toán theo ID:', paymentIdOrData);
        paymentData = await this.rpcClient.callPaymentService('getPaymentById', {
          id: paymentIdOrData
        });
        if (!paymentData) {
          throw new Error(`Payment not found: ${paymentIdOrData}`);
        }
      } else {
        paymentData = paymentIdOrData;
      }

      // Chỉ tạo hóa đơn nếu thanh toán thành công
      if (paymentData.status !== 'completed') {
        throw new Error('Chỉ tạo hóa đơn khi thanh toán thành công');
      }

      console.log('📝 Tạo hóa đơn từ thanh toán:', paymentData._id);

      // 🔥 SỬa: Tính cọc TRƯỚC (trước khi tạo chi tiết hóa đơn)
      const originalAmount = paymentData.originalAmount || 0;
      const paidAmount = paymentData.paidAmount || paymentData.amount || 0;
      const depositAmount = paymentData.depositAmount || Math.max(0, originalAmount - paidAmount);
      
      console.log('💰 Tính toán cọc:');
      console.log('  - originalAmount từ thanh toán:', originalAmount.toLocaleString());
      console.log('  - paidAmount từ thanh toán:', paidAmount.toLocaleString());
      console.log('  - depositAmount phát hiện:', depositAmount.toLocaleString());
      
      // 🔥 SỬa: Lấy dịch vụ từ hồ sơ nếu có recordId
      let invoiceDetails = [];
      let record = null; // 🔥 SỬa: Khai báo record ở ngoài scope để dùng cho dentistInfo
      if (paymentData.recordId) {
        try {
          console.log('📋 Lấy hồ sơ:', paymentData.recordId);
          record = await this.rpcClient.call('record-service', 'getRecordById', {
            id: paymentData.recordId
          });

          if (record) {
            // 🔥 DEBUG: Ghi log dữ liệu hồ sơ đầy đủ để hiểu giá
            console.log('📋 [DEBUG] Dữ liệu hồ sơ cho hóa đơn:', JSON.stringify({
              recordId: record._id,
              recordCode: record.recordCode,
              serviceName: record.serviceName,
              serviceAddOnId: record.serviceAddOnId,
              serviceAddOnName: record.serviceAddOnName,
              servicePrice: record.servicePrice,
              serviceAddOnPrice: record.serviceAddOnPrice,
              quantity: record.quantity,
              totalCost: record.totalCost,
              depositPaid: record.depositPaid,
              additionalServices: record.additionalServices?.map(s => ({
                serviceName: s.serviceName,
                serviceAddOnId: s.serviceAddOnId,
                serviceAddOnName: s.serviceAddOnName,
                price: s.price,
                quantity: s.quantity,
                totalPrice: s.totalPrice
              })) || []
            }, null, 2));
            
            // 🔥 SỬa: Thêm dịch vụ CHÍNH trước (serviceId + serviceAddOn)
            if (record.serviceId && record.serviceName) {
              // 🔥 QUAN TRỌNG: serviceAddOnPrice là BẮT BUỘC cho giá hóa đơn
              // servicePrice là giá cơ bản (không dùng), serviceAddOnPrice là giá biến thể thực tế
              
              console.log('🔍 [DEBUG] Các trường giá dịch vụ chính:', {
                recordId: record._id || record.id,
                serviceName: record.serviceName,
                serviceAddOnName: record.serviceAddOnName,
                servicePrice: record.servicePrice,
                serviceAddOnPrice: record.serviceAddOnPrice,
                totalCost: record.totalCost,
                depositPaid: record.depositPaid
              });
              
              // 🔥 XÁC THỰC NGHIÊM NGẶT: serviceAddOnPrice PHẢI tồn tại và > 0
              if (!record.serviceAddOnPrice || record.serviceAddOnPrice === 0) {
                const errorMsg = `❌ LỖI NGHIÊM TRỌNG: serviceAddOnPrice thiếu hoặc bằng 0 cho hồ sơ ${record._id || record.id}! ` +
                  `Dịch vụ: ${record.serviceName}, Add-on: ${record.serviceAddOnName}. ` +
                  `Không thể tạo hóa đơn khi thiếu giá. Vui lòng kiểm tra record-service.`;
                console.error(errorMsg);
                throw new Error(errorMsg);
              }
              
              const originalPrice = record.serviceAddOnPrice; // CHỈ lấy serviceAddOnPrice (giá gốc)
              
              // 🔥 SỬa: unitPrice = giá GỐC, totalPrice = giá SAU KHI trừ cọc
              // Cọc chỉ áp dụng cho dịch vụ ĐẦU TIÊN (dịch vụ chính)
              const priceAfterDeposit = depositAmount > 0 
                ? Math.max(0, originalPrice - depositAmount)
                : originalPrice;
              
              console.log(`💰 Giá dịch vụ chính: Gốc ${originalPrice.toLocaleString()}, Cọc ${depositAmount.toLocaleString()}, Sau cọc ${priceAfterDeposit.toLocaleString()}`);
              
              const mainServiceQuantity = record.quantity || 1;
              const mainServiceSubtotal = priceAfterDeposit * mainServiceQuantity;

              invoiceDetails.push({
                serviceId: record.serviceId || null,
                serviceInfo: {
                  name: record.serviceName,
                  code: record.serviceAddOnId || null,
                  type: record.type === 'exam' ? 'examination' : 'filling', // Use valid enum
                  category: 'restorative',
                  description: record.serviceAddOnName || record.serviceName,
                  unit: record.serviceAddOnUnit || null
                },
                unitPrice: originalPrice, // 🔥 SỬa: Lưu giá GỐC (500k), không phải giá sau cọc
                quantity: mainServiceQuantity,
                subtotal: mainServiceSubtotal,
                discountAmount: depositAmount, // 🔥 Hiển thị cọc như giảm giá
                totalPrice: mainServiceSubtotal, // 🔥 Giá sau cọc (300k)
                notes: depositAmount > 0 
                  ? `Dịch vụ chính: ${record.serviceName}${record.serviceAddOnName ? ' - ' + record.serviceAddOnName : ''} (Đã trừ cọc ${depositAmount.toLocaleString('vi-VN')}đ)`
                  : `Dịch vụ chính: ${record.serviceName}${record.serviceAddOnName ? ' - ' + record.serviceAddOnName : ''}`,
                dentistId: record.dentistId || null, // 🔥 SỬa: Thêm dentistId để thống kê doanh thu theo nha sĩ
                status: 'completed',
                completedDate: new Date() // 🔥 SỬa: Thêm completedDate để thống kê doanh thu hoạt động đúng
                // 🔥 SỬa: Không set createdBy ở đây, sẽ được set sau
              });
              
              console.log(`✅ Đã thêm dịch vụ chính: ${record.serviceName} (${originalPrice.toLocaleString()} - ${depositAmount.toLocaleString()} cọc = ${mainServiceSubtotal.toLocaleString()})`);
            }
            
            // 🔥 SỬa: Thêm các dịch vụ bổ sung
            if (record.additionalServices && record.additionalServices.length > 0) {
              console.log(`✅ Tìm thấy ${record.additionalServices.length} dịch vụ bổ sung`);
              
              const additionalDetails = record.additionalServices.map(service => {
                const unitPrice = service.price || 0;
                const quantity = service.quantity || 1;
                const subtotal = unitPrice * quantity;
                const totalPrice = service.totalPrice || subtotal;

                return {
                  serviceId: service.serviceId || null,
                  serviceInfo: {
                    name: service.serviceName || 'Unknown Service',
                    code: service.serviceAddOnId || null,
                    type: service.serviceType === 'exam' ? 'examination' : 'filling',
                    category: 'restorative',
                    description: service.serviceAddOnName || service.serviceName,
                    unit: service.serviceAddOnUnit || null
                  },
                  unitPrice: unitPrice,
                  quantity: quantity,
                  subtotal: subtotal,
                  discountAmount: 0,
                  totalPrice: totalPrice,
                  notes: service.notes || '',
                  dentistId: record.dentistId || null, // 🔥 SỬa: Thêm dentistId để thống kê doanh thu theo nha sĩ
                  status: 'completed',
                  completedDate: new Date() // 🔥 SỬa: Thêm completedDate để thống kê doanh thu hoạt động đúng
                  // 🔥 SỬa: Không set createdBy ở đây, sẽ được set sau
                };
              });
              
              invoiceDetails.push(...additionalDetails);
            }
            
            console.log('📦 Tổng chi tiết hóa đơn:', invoiceDetails.length);
            console.log('💰 Chi tiết:', invoiceDetails.map(d => ({
              name: d.serviceInfo.name,
              unitPrice: d.unitPrice,
              quantity: d.quantity,
              totalPrice: d.totalPrice
            })));
          } else {
            console.warn('⚠️ Không tìm thấy hồ sơ');
          }
        } catch (error) {
          console.error('❌ Lỗi lấy hồ sơ:', error);
          // 🔥 QUAN TRỌNG: Nếu lỗi liên quan đến serviceAddOnPrice, throw để dừng tạo hóa đơn
          if (error.message && error.message.includes('serviceAddOnPrice')) {
            throw error; // Dừng tạo hóa đơn ngay lập tức
          }
          // Với các lỗi khác, tiếp tục không có chi tiết (để tương thích ngược)
          console.warn('⚠️ Tiếp tục không có chi tiết hóa đơn do lỗi không nghiêm trọng');
        }
      }

      // 🔥 SỬa: Lấy thông tin nha sĩ từ thanh toán hoặc hồ sơ
      let dentistInfo = null;
      let dentistId = null;
      let dentistName = null;

      // Ưu tiên 1: Lấy từ payment
      if (paymentData.processedBy) {
        dentistId = paymentData.processedBy;
        dentistName = paymentData.processedByName || null;
      }
      
      // Ưu tiên 2: Lấy từ record nếu chưa có
      if (!dentistId && record && record.dentistId) {
        dentistId = record.dentistId;
        dentistName = record.dentistName || null;
      }

      // 🔥 SỬa: Nếu có dentistId nhưng không có tên, gọi auth-service để lấy tên
      if (dentistId && !dentistName) {
        try {
          console.log('🔍 Lấy thông tin nha sĩ từ auth-service:', dentistId);
          const dentistData = await this.rpcClient.call('auth-service', 'getUserById', {
            id: dentistId
          });
          if (dentistData) {
            dentistName = dentistData.fullName || dentistData.name || `Nha sĩ ${dentistData.employeeCode || ''}`;
            console.log('✅ Đã lấy tên nha sĩ:', dentistName);
          }
        } catch (error) {
          console.warn('⚠️ Không thể lấy thông tin nha sĩ từ auth-service:', error.message);
          dentistName = 'Nha sĩ'; // Fallback
        }
      }

      if (dentistId) {
        dentistInfo = {
          dentistId: dentistId,
          name: dentistName || 'Nha sĩ'
        };
        console.log('✅ DentistInfo:', dentistInfo);
      } else {
        console.warn('⚠️ Không tìm thấy dentistId từ payment hoặc record');
      }

      // 🔥 SỬa: Tính subtotal từ chi tiết hóa đơn (sau khi trừ cọc ở dịch vụ chính)
      const subtotalFromDetails = invoiceDetails.reduce((sum, detail) => sum + (detail.totalPrice || 0), 0);
      
      // 🔥 QUAN TRỌNG: 
      // - invoiceSubtotal = số tiền gốc (trước cọc) để hiển thị
      // - invoiceTotalAmount = sau khi trừ cọc (số tiền khách thực trả)
      const invoiceSubtotal = subtotalFromDetails + depositAmount; // Cộng lại cọc để hiển thị
      const invoiceTotalAmount = subtotalFromDetails; // Số tiền thanh toán thực tế

      console.log('💰 Tính toán hóa đơn cuối cùng:');
      console.log('  - Subtotal (trước cọc):', invoiceSubtotal.toLocaleString());
      console.log('  - Số tiền cọc:', depositAmount.toLocaleString());
      console.log('  - Tổng tiền (sau cọc):', invoiceTotalAmount.toLocaleString());

      const invoiceData = {
        appointmentId: paymentData.appointmentId,
        patientId: paymentData.patientId,
        patientInfo: paymentData.patientInfo, // 🔥 SỬa: Thêm patientInfo để bỏ qua xác thực cuộc hẹn
        recordId: paymentData.recordId, // 🆕 Liên kết với hồ sơ
        type: InvoiceType.APPOINTMENT,
        status: InvoiceStatus.PAID,
        totalAmount: invoiceTotalAmount, // 🔥 SỬa: = paidAmount (tiền thực trả)
        subtotal: invoiceSubtotal, // 🔥 Tổng dịch vụ trước khi trừ cọc
        paidDate: new Date(),
        dentistInfo: dentistInfo, // 🔥 SỬa: Thêm dentistInfo bắt buộc
        createdByRole: 'system', // 🔥 SỬa: Thêm createdByRole bắt buộc
        paymentSummary: {
          totalPaid: paidAmount, // 🔥 Số tiền thực trả trong giao dịch này
          remainingAmount: 0,
          paymentIds: [paymentData._id],
          lastPaymentDate: new Date(),
          paymentMethod: paymentData.paymentMethod
        },
        details: invoiceDetails, // 🔥 SỬa: Thêm chi tiết hóa đơn từ hồ sơ
        notes: depositAmount > 0 
          ? `Hóa đơn tự động tạo từ thanh toán ${paymentData._id}. Đã trừ cọc ${depositAmount.toLocaleString('vi-VN')}đ`
          : `Hóa đơn tự động tạo từ thanh toán ${paymentData._id}`
      };

      console.log('💰 Tạo hóa đơn với', invoiceDetails.length, 'chi tiết dịch vụ');
      
      // 🔥 SỬa: Sử dụng dentistInfo.dentistId hoặc payment.processedBy làm createdBy (phải là ObjectId)
      const createdBy = dentistInfo?.dentistId || paymentData.processedBy || new mongoose.Types.ObjectId();
      
      return await this.createInvoice(invoiceData, createdBy);
    } catch (error) {
      console.error("❌ Lỗi tạo hóa đơn từ thanh toán:", error);
      throw error;
    }
  }

  // ============ CÁC PHƯƠNG THỨC NGHIỆP VỤ ============
  async finalizeInvoice(id, userId) {
    try {
      const invoice = await invoiceRepo.findById(id);
      if (!invoice) {
        throw new Error('Hóa đơn không tồn tại');
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new Error('Chỉ có thể hoàn thiện hóa đơn nháp');
      }

      // Kiểm tra hóa đơn có chi tiết không
      const details = await invoiceDetailRepo.findByInvoice(id);
      if (!details || details.length === 0) {
        throw new Error('Hóa đơn phải có ít nhất một dịch vụ');
      }

      // Tính lại số tiền
      await this.recalculateInvoiceAmounts(id);

      // Chuyển sang trạng thái chờ
      const finalizedInvoice = await invoiceRepo.convertDraftToPending(id, {
        finalizedBy: userId,
        finalizedAt: new Date()
      });

      await this.clearInvoiceCache(id);
      return finalizedInvoice;
    } catch (error) {
      console.error("❌ Lỗi hoàn thiện hóa đơn:", error);
      throw error;
    }
  }

  async cancelInvoice(id, cancelReason, userId) {
    try {
      const updatedInvoice = await invoiceRepo.cancelInvoice(id, cancelReason, userId);
      await this.clearInvoiceCache(id);
      return updatedInvoice;
    } catch (error) {
      console.error("❌ Lỗi hủy hóa đơn:", error);
      throw error;
    }
  }

  async recalculateInvoiceAmounts(invoiceId) {
    try {
      // Tính lại số tiền chi tiết trước
      await invoiceDetailRepo.recalculateInvoiceAmounts(invoiceId);

      // Lấy chi tiết đã cập nhật
      const details = await invoiceDetailRepo.findByInvoice(invoiceId);
      const subtotal = details.reduce((sum, detail) => sum + detail.totalAmount, 0);

      const invoice = await invoiceRepo.findById(invoiceId);
      
      // Tính lại tổng hóa đơn
      const taxAmount = invoice.taxInfo?.taxAmount || 0;
      const discountAmount = invoice.discountInfo?.discountAmount || 0;
      const totalAmount = subtotal + taxAmount - discountAmount;

      return await invoiceRepo.update(invoiceId, {
        subtotalAmount: subtotal,
        totalAmount: totalAmount
      });
    } catch (error) {
      console.error("❌ Lỗi tính lại số tiền:", error);
      throw error;
    }
  }

  // ============ THỐNG KÊ & BÁO CÁO ============
  async getInvoiceStatistics(startDate, endDate, groupBy = 'day') {
    try {
      // Chuyển đổi sang Date nếu nhận chuỗi từ RabbitMQ
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const cacheKey = `stats:invoices:${start.toISOString()}:${end.toISOString()}:${groupBy}`;
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const stats = await invoiceRepo.getInvoiceStatistics(start, end, groupBy);
      
      // Cache lâu hơn vì thống kê không thay đổi thường xuyên
      await this.redis.setex(cacheKey, 1800, JSON.stringify(stats)); // 30 phút

      return stats;
    } catch (error) {
      console.error("❌ Lỗi lấy thống kê:", error);
      throw error;
    }
  }

  async getRevenueStats(startDate, endDate, groupBy = 'day', dentistId = null, serviceId = null) {
    try {
      // Chuyển đổi sang Date nếu nhận chuỗi từ RabbitMQ
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      // ❌ TẮT CACHE - Luôn lấy dữ liệu mới nhất cho thống kê chính xác
      // const cacheKey = `stats:revenue:${start.toISOString()}:${end.toISOString()}:${groupBy}:${dentistId || 'all'}:${serviceId || 'all'}`;
      // const cached = await this.redis.get(cacheKey);
      // if (cached) {
      //   return JSON.parse(cached);
      // }

      const stats = await invoiceRepo.getRevenueStats(start, end, groupBy, dentistId, serviceId);
      
      // ❌ TẮT CACHE
      // await this.redis.setex(cacheKey, 1800, JSON.stringify(stats));

      return stats;
    } catch (error) {
      console.error("❌ Lỗi lấy thống kê doanh thu:", error);
      throw error;
    }
  }

  async getDashboardData() {
    try {
      const cacheKey = 'dashboard:invoices';
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const today = new Date();
      const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const lastMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [
        todayInvoices,
        pendingInvoices,
        overdueInvoices,
        weeklyRevenue,
        monthlyRevenue
      ] = await Promise.all([
        invoiceRepo.findTodayInvoices(),
        invoiceRepo.findPendingInvoices(10),
        invoiceRepo.findOverdueInvoices(),
        this.getRevenueStats(lastWeek, today),
        this.getRevenueStats(lastMonth, today)
      ]);

      const dashboardData = {
        todayInvoices: todayInvoices.length,
        pendingInvoices: pendingInvoices.length,
        overdueInvoices: overdueInvoices.length,
        weeklyRevenue: weeklyRevenue.totalRevenue || 0,
        monthlyRevenue: monthlyRevenue.totalRevenue || 0
      };

      await this.redis.setex(cacheKey, 300, JSON.stringify(dashboardData)); // 5 minutes

      return dashboardData;
    } catch (error) {
      console.error("❌ Lỗi lấy dữ liệu dashboard:", error);
      throw error;
    }
  }

  // ============ CÁC PHƯƠNG THỨC HỖ TRỢ ============
  async generateInvoiceNumber() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    
    // Đếm số hóa đơn trong tháng này
    const startOfMonth = new Date(year, today.getMonth(), 1);
    const endOfMonth = new Date(year, today.getMonth() + 1, 0);
    
    const count = await invoiceRepo.findByDateRange(startOfMonth, endOfMonth);
    const sequenceNumber = String(count.length + 1).padStart(4, '0');
    
    return `INV${year}${month}${sequenceNumber}`;
  }

  async clearInvoiceCache(invoiceId = null) {
    try {
      if (invoiceId) {
        await this.redis.del(`invoice:${invoiceId}`);
      }
      
      // Xóa tất cả cache danh sách hóa đơn
      const keys = await this.redis.keys('invoices:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      // Xóa cache thống kê
      const statsKeys = await this.redis.keys('stats:*');
      if (statsKeys.length > 0) {
        await this.redis.del(...statsKeys);
      }

      // Xóa cache dashboard
      await this.redis.del('dashboard:invoices');
    } catch (error) {
      console.error("⚠️ Cảnh báo: Không thể xóa cache:", error.message);
    }
  }

  async sendPaymentNotification(invoice) {
    try {
      // Gửi thông báo qua RPC đến notification service
      await this.rpcClient.call('notification-service', 'sendInvoicePaymentNotification', {
        invoiceId: invoice._id,
        patientInfo: invoice.patientInfo,
        amount: invoice.paymentSummary.totalPaid,
        status: invoice.status
      });
    } catch (error) {
      console.error("⚠️ Cảnh báo: Không thể gửi thông báo:", error.message);
    }
  }
}

module.exports = new InvoiceService();

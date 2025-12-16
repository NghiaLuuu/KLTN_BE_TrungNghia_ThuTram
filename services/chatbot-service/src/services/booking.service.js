/**
 * Booking Service - Xử lý luồng đặt lịch trong chatbot
 * Flow tương tự /patient/booking/select-service
 */

const axios = require('axios');
const internalApiClient = require('../utils/internalApiClient');

// URL các service từ biến môi trường
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const SERVICE_SERVICE_URL = process.env.SERVICE_SERVICE_URL || 'http://localhost:3003';
const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
const RECORD_SERVICE_URL = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3008';

class BookingService {
  /**
   * Lấy danh sách dịch vụ khả dụng của user (bao gồm các chỉ định chưa sử dụng từ phiếu khám)
   * @param {String} userId - ID người dùng
   * @param {String} authToken - JWT token (tùy chọn)
   * @returns {Promise<Object>}
   */
  async getUserAvailableServices(userId, authToken = null) {
    try {
      console.log(`📋 Lấy dịch vụ khả dụng cho user: ${userId}`);
      
      // 1. Lấy tất cả dịch vụ đang hoạt động từ service-service
      console.log(`🔗 Gọi API: ${SERVICE_SERVICE_URL}/api/service?page=1&limit=1000`);
      const servicesResponse = await axios.get(`${SERVICE_SERVICE_URL}/api/service`, {
        params: { 
          page: 1, 
          limit: 1000 
        }
      });
      
      console.log('📦 Response services:', servicesResponse.data);
      
      let allServices = [];
      // Xử lý các định dạng response khác nhau
      if (servicesResponse.data.data && Array.isArray(servicesResponse.data.data)) {
        // Định dạng: { success: true, data: [...] }
        allServices = servicesResponse.data.data.filter(s => s.isActive);
      } else if (servicesResponse.data.services && Array.isArray(servicesResponse.data.services)) {
        // Định dạng: { services: [...] }
        allServices = servicesResponse.data.services.filter(s => s.isActive);
      } else if (Array.isArray(servicesResponse.data)) {
        // Định dạng: [...]
        allServices = servicesResponse.data.filter(s => s.isActive);
      }
      
      console.log(`✅ Tìm thấy ${allServices.length} dịch vụ đang hoạt động`);
      
      // 2. Lấy phiếu khám của bệnh nhân để kiểm tra dịch vụ chưa sử dụng (dịch vụ được chỉ định)
      let unusedServices = [];
      let examRecords = [];
      
      // Bỏ qua việc lấy phiếu khám cho user ẩn danh
      if (userId !== 'anonymous') {
        try {
          // Lấy phiếu khám để trích xuất treatmentIndications
          console.log(`🔗 Gọi API: ${RECORD_SERVICE_URL}/api/record/patient/${userId}?limit=100`);
          
          const config = authToken ? {
            headers: { Authorization: `Bearer ${authToken}` }
          } : {};
          
          const recordsResponse = await axios.get(
            `${RECORD_SERVICE_URL}/api/record/patient/${userId}`,
            {
              ...config,
              params: { limit: 100 }
            }
          );
          
          console.log('📦 Response phiếu khám:', recordsResponse.data);
          
          if (recordsResponse.data.success && recordsResponse.data.data && Array.isArray(recordsResponse.data.data)) {
            const records = recordsResponse.data.data;
            
            // Trích xuất tất cả treatmentIndications chưa được sử dụng
            records.forEach(record => {
              if (record.treatmentIndications && Array.isArray(record.treatmentIndications)) {
                record.treatmentIndications.forEach(indication => {
                  // Chỉ bao gồm các chỉ định chưa sử dụng
                  if (!indication.used && indication.serviceId && indication.serviceAddOnId) {
                    unusedServices.push({
                      serviceId: indication.serviceId,
                      serviceAddOnId: indication.serviceAddOnId, // Addon cụ thể được chỉ định
                      recordId: record._id,
                      recordDentistId: record.dentistId, // Nha sĩ đã khám và tạo chỉ định này
                      recordDentistName: record.dentistName,
                      serviceName: indication.serviceName,
                      serviceAddOnName: indication.serviceAddOnName,
                      notes: indication.notes || ''
                    });
                  }
                });
              }
            });
            
            console.log(`🎯 Trích xuất được ${unusedServices.length} chỉ định dịch vụ chưa sử dụng từ ${records.length} phiếu khám`);
          }
        } catch (error) {
          console.warn('⚠️ Không thể lấy phiếu khám của bệnh nhân:', error.message);
          // Vẫn OK - user có thể chưa có phiếu khám nào
        }
      } else {
        console.log('ℹ️ User ẩn danh - bỏ qua kiểm tra dịch vụ chưa sử dụng');
      }
      
      // 3. Lọc dịch vụ dựa trên requireExamFirst
      const unusedServiceIds = new Set(unusedServices.map(s => s.serviceId.toString()));
      
      const availableServices = allServices.filter(service => {
        // ⭐ QUAN TRỌNG: Chỉ lọc nếu requireExamFirst là TRUE và user KHÔNG có chỉ định
        // Nếu requireExamFirst là FALSE hoặc undefined, luôn hiển thị dịch vụ
        if (!service.requireExamFirst) {
          return true; // Luôn hiển dịch vụ không yêu cầu khám trước
        }
        
        // Nếu dịch vụ yêu cầu khám trước, kiểm tra user có chỉ định chưa sử dụng không
        const hasIndication = unusedServiceIds.has(service._id.toString());
        
        if (!hasIndication) {
          console.log(`   ⚠️ Bỏ qua "${service.name}" - cần khám trước nhưng không có chỉ định`);
        }
        
        return hasIndication;
      });
      
      console.log(`✅ Tổng dịch vụ khả dụng sau lọc: ${availableServices.length}`);
      
      // 3.5. Lấy chi tiết đầy đủ của dịch vụ để có basePrice và duration
      const servicesWithDetails = await Promise.all(
        availableServices.map(async (service) => {
          try {
            const detailResponse = await axios.get(
              `${SERVICE_SERVICE_URL}/api/service/${service._id}`
            );
            
            if (detailResponse.data.success && detailResponse.data.data) {
              return {
                ...service,
                ...detailResponse.data.data // Merge chi tiết đầy đủ
              };
            }
            return service; // Fallback về bản gốc nếu lấy thất bại
          } catch (error) {
            console.warn(`⚠️ Không thể lấy chi tiết dịch vụ ${service._id}:`, error.message);
            return service; // Fallback về bản gốc
          }
        })
      );
      
      console.log(`📦 Đã lấy chi tiết đầy đủ của ${servicesWithDetails.length} dịch vụ`);
      
      // 4. Đánh dấu dịch vụ được khuyến nghị và gắn recordId + addon cụ thể
      const servicesWithMetadata = servicesWithDetails.map(service => {
        const isRecommended = unusedServiceIds.has(service._id.toString());
        
        // Tìm recordId và addon cụ thể nếu được khuyến nghị
        let recordId = null;
        let recommendationNotes = null;
        let recommendedAddOnId = null; // Addon cụ thể được chỉ định
        let recordDentistId = null; // Nha sĩ đã tạo chỉ định
        let recordDentistName = null;
        
        if (isRecommended) {
          const unusedService = unusedServices.find(
            unused => unused.serviceId.toString() === service._id.toString()
          );
          if (unusedService) {
            recordId = unusedService.recordId;
            recommendationNotes = unusedService.notes;
            recommendedAddOnId = unusedService.serviceAddOnId; // Quan trọng: addon cụ thể
            recordDentistId = unusedService.recordDentistId;
            recordDentistName = unusedService.recordDentistName;
          }
        }
        
        return {
          ...service,
          isRecommended,
          recordId, // Sẽ dùng để cập nhật hasBeenUsed sau khi đặt lịch
          recordDentistId, // Nha sĩ đã khám bệnh nhân
          recordDentistName,
          recommendationNotes,
          recommendedAddOnId // Addon cụ thể được bác sĩ chỉ định
        };
      });
      
      console.log(`🎉 Đã chuẩn bị ${servicesWithMetadata.length} dịch vụ với metadata`);
      console.log(`   - Được khuyến nghị: ${servicesWithMetadata.filter(s => s.isRecommended).length}`);
      console.log(`   - Thường: ${servicesWithMetadata.filter(s => !s.isRecommended).length}`);
      
      return {
        services: servicesWithMetadata,
        recommendedCount: unusedServices.length,
        total: servicesWithMetadata.length
      };
      
    } catch (error) {
      console.error('❌ getUserAvailableServices error:', error);
      throw new Error('Không thể lấy danh sách dịch vụ: ' + error.message);
    }
  }
  
  /**
   * Lấy danh sách nha sĩ khả dụng cho dịch vụ
   * @param {String} serviceId - ID dịch vụ
   * @param {String} serviceAddOnId - ID addon dịch vụ (tùy chọn)
   * @returns {Promise<Array>}
   */
  async getAvailableDentists(serviceId, serviceAddOnId = null) {
    try {
      // Lấy thông tin dịch vụ để biết chuyên môn cần thiết
      const serviceResponse = await axios.get(`${SERVICE_SERVICE_URL}/api/service/${serviceId}`);
      const service = serviceResponse.data.service;
      
      // Lấy tất cả nha sĩ
      const dentistsResponse = await axios.get(`${AUTH_SERVICE_URL}/api/users/by-role/dentist`);
      const dentists = dentistsResponse.data.data || [];
      
      // Lọc nha sĩ dựa trên chuyên môn của dịch vụ (nếu có)
      let filteredDentists = dentists.filter(d => d.isActive);
      
      // TODO: Lọc theo chuyên môn nếu dịch vụ có yêu cầu cụ thể
      // Hiện tại, trả về tất cả nha sĩ đang hoạt động
      
      return {
        dentists: filteredDentists,
        service: {
          _id: service._id,
          name: service.name,
          duration: service.duration,
          basePrice: service.basePrice
        }
      };
      
    } catch (error) {
      console.error('❌ getAvailableDentists error:', error);
      throw new Error('Không thể lấy danh sách nha sĩ: ' + error.message);
    }
  }
  
  /**
   * Lấy các khung giờ trống
   * @param {String} dentistId - ID nha sĩ
   * @param {String} date - Ngày theo định dạng YYYY-MM-DD
   * @param {Number} serviceDuration - Thời lượng dịch vụ (phút)
   * @returns {Promise<Object>}
   */
  async getAvailableSlots(dentistId, date, serviceDuration) {
    try {
      const response = await axios.get(`${APPOINTMENT_SERVICE_URL}/api/appointments/available-slots`, {
        params: {
          dentistId,
          date,
          serviceDuration
        }
      });
      
      if (response.data.success) {
        return response.data.data;
      } else {
        throw new Error(response.data.message || 'Không thể lấy lịch trống');
      }
      
    } catch (error) {
      console.error('❌ getAvailableSlots error:', error);
      throw new Error('Không thể lấy lịch trống: ' + error.message);
    }
  }
  
  /**
   * Tạo reservation lịch hẹn và trả về URL thanh toán
   * @param {Object} bookingData - Dữ liệu đặt lịch
   * @returns {Promise<Object>}
   */
  async createReservation(bookingData) {
    try {
      const { userId, serviceId, serviceAddOnId, dentistId, date, slotIds, notes } = bookingData;
      
      // Lấy thông tin user
      const userResponse = await axios.get(`${AUTH_SERVICE_URL}/api/users/${userId}`);
      const user = userResponse.data.user;
      
      // Lấy thông tin dịch vụ
      const serviceResponse = await axios.get(`${SERVICE_SERVICE_URL}/api/service/${serviceId}`);
      const service = serviceResponse.data.service;
      
      // Chuẩn bị dữ liệu reservation
      const reservationData = {
        patientId: userId,
        patientInfo: {
          fullName: user.fullName,
          phone: user.phone,
          email: user.email,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          address: user.address
        },
        serviceId,
        serviceAddOnId: serviceAddOnId || null,
        dentistId,
        slotIds,
        date,
        notes: notes || ''
      };
      
      console.log('📋 Tạo reservation:', reservationData);
      
      // Tạo reservation qua appointment service
      const reservationResponse = await axios.post(
        `${APPOINTMENT_SERVICE_URL}/api/appointments/reserve`,
        reservationData
      );
      
      if (!reservationResponse.data.success) {
        throw new Error(reservationResponse.data.message || 'Không thể tạo reservation');
      }
      
      const reservation = reservationResponse.data.data;
      
      console.log('✅ Đã tạo reservation:', reservation.appointmentCode);
      
      // Tạo URL thanh toán qua payment service
      const paymentData = {
        appointmentCode: reservation.appointmentCode,
        amount: reservation.depositAmount,
        returnUrl: process.env.PAYMENT_RETURN_URL || 'http://localhost:5173/patient/payment-result',
        locale: 'vn'
      };
      
      const paymentResponse = await axios.post(
        `${PAYMENT_SERVICE_URL}/api/payment/vnpay/create-payment`,
        paymentData
      );
      
      if (!paymentResponse.data.success) {
        throw new Error(paymentResponse.data.message || 'Không thể tạo link thanh toán');
      }
      
      console.log('✅ Đã tạo URL thanh toán');
      
      return {
        reservation: {
          appointmentCode: reservation.appointmentCode,
          appointmentId: reservation.appointmentId,
          depositAmount: reservation.depositAmount,
          expiresAt: reservation.expiresAt,
          serviceName: service.name,
          dentistName: reservation.dentistName,
          date: reservation.date,
          startTime: reservation.startTime,
          endTime: reservation.endTime
        },
        paymentUrl: paymentResponse.data.data.paymentUrl
      };
      
    } catch (error) {
      console.error('❌ Lỗi createReservation:', error);
      throw new Error('Không thể tạo đặt lịch: ' + error.message);
    }
  }
}

module.exports = new BookingService();

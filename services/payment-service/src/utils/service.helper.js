const axios = require('axios');
const redis = require('./redis.client');

/**
 * Kiểm tra và cập nhật trạng thái hasBeenUsed của dịch vụ
 * Được gọi trước khi chuyển hướng đến frontend sau khi thanh toán thành công
 * @param {String} reservationId 
 * @param {String} paymentId 
 */
async function checkAndUpdateServiceUsage(reservationId, paymentId) {
  try {
    console.log('🔍 [HTTP] Starting service usage check...', { reservationId, paymentId });
    
    // Lấy dữ liệu lịch hẹn từ Redis với tiền tố đúng
    const redisKey = reservationId.startsWith('temp_reservation:') 
      ? reservationId 
      : `temp_reservation:${reservationId}`;
    
    const appointmentData = await redis.get(redisKey);
    
    console.log('🔍 [HTTP] Redis lookup:', {
      originalKey: reservationId,
      redisKey,
      found: !!appointmentData
    });
    
    if (!appointmentData) {
      console.warn('⚠️ [HTTP] No appointment data found for reservation:', reservationId);
      return;
    }

    const appointment = JSON.parse(appointmentData);
    console.log('📋 [HTTP] Appointment data retrieved:', {
      hasServiceId: !!appointment.serviceId,
      hasServiceAddOnId: !!appointment.serviceAddOnId,
      hasServices: !!appointment.selectedServices,
      servicesCount: appointment.selectedServices?.length || 0
    });
    
    // Chuyển đổi cấu trúc reservation sang định dạng mong đợi
    let selectedServices = appointment.selectedServices || [];
    
    if (selectedServices.length === 0) {
      // Xây dựng từ serviceId và serviceAddOnId
      if (appointment.serviceId) {
        selectedServices.push({
          serviceId: appointment.serviceId,
          _id: appointment.serviceId
        });
      }
      
      if (appointment.serviceAddOnId) {
        selectedServices.push({
          serviceId: appointment.serviceAddOnId,
          _id: appointment.serviceAddOnId
        });
      }
    }
    
    if (selectedServices.length === 0) {
      console.warn('⚠️ [HTTP] No services found in appointment data');
      return;
    }

    const serviceIds = selectedServices
      .map(s => s.serviceId || s._id)
      .filter(Boolean);

    console.log('📝 [HTTP] Extracted service IDs:', serviceIds);

    if (serviceIds.length === 0) {
      return;
    }

    // Kiểm tra trạng thái sử dụng dịch vụ từ service-service
    const SERVICE_SERVICE_URL = process.env.SERVICE_SERVICE_URL || 'http://localhost:3004';
    
    console.log(`🔍 [HTTP] Checking usage status for ${serviceIds.length} services...`);
    console.log(`🌐 [HTTP] Calling: POST ${SERVICE_SERVICE_URL}/api/service/check-usage`);
    
    const checkResponse = await axios.post(`${SERVICE_SERVICE_URL}/api/service/check-usage`, {
      serviceIds
    }, {
      timeout: 5000
    });

    console.log('📥 [HTTP] Response from check-usage:', checkResponse.data);

    const { notUsed, allUsed } = checkResponse.data;

    // Nếu có dịch vụ cần đánh dấu là đã sử dụng
    if (notUsed && notUsed.length > 0) {
      console.log(`🔄 [HTTP] Updating ${notUsed.length} services to hasBeenUsed=true`);
      console.log(`🌐 [HTTP] Calling: POST ${SERVICE_SERVICE_URL}/api/service/mark-as-used`);
      
      await axios.post(`${SERVICE_SERVICE_URL}/api/service/mark-as-used`, {
        serviceIds: notUsed
      }, {
        timeout: 5000
      });

      console.log('✅ [HTTP] Services marked as used successfully');
    } else {
      console.log('✅ [HTTP] All services already marked as used');
    }
  } catch (error) {
    // Không throw - điều này không quan trọng cho luồng thanh toán
    console.error('❌ [HTTP] Error checking/updating service usage:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data
    });
  }
}

module.exports = {
  checkAndUpdateServiceUsage
};

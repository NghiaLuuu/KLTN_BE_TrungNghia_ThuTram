const axios = require('axios');
const redis = require('./redis.client');

/**
 * Check and update service hasBeenUsed status
 * Called before redirecting to frontend after payment success
 * @param {String} reservationId 
 * @param {String} paymentId 
 */
async function checkAndUpdateServiceUsage(reservationId, paymentId) {
  try {
    console.log('🔍 [HTTP] Starting service usage check...', { reservationId, paymentId });
    
    // Get appointment data from Redis with correct prefix
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
    
    // Transform reservation structure to expected format
    let selectedServices = appointment.selectedServices || [];
    
    if (selectedServices.length === 0) {
      // Build from serviceId and serviceAddOnId
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

    // Check service usage status from service-service
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

    // If there are services that need to be marked as used
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
    // Don't throw - this is not critical for payment flow
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

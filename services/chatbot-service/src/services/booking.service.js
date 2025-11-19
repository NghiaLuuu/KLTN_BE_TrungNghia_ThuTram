/**
 * Booking Service - Handle booking flow in chatbot
 * Flow tương tự /patient/booking/select-service
 */

const axios = require('axios');
const internalApiClient = require('../utils/internalApiClient');

// Service URLs from environment
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const SERVICE_SERVICE_URL = process.env.SERVICE_SERVICE_URL || 'http://localhost:3003';
const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
const RECORD_SERVICE_URL = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3008';

class BookingService {
  /**
   * Get user's available services (including unused indications from exam records)
   * @param {String} userId - User ID
   * @param {String} authToken - JWT token (optional)
   * @returns {Promise<Object>}
   */
  async getUserAvailableServices(userId, authToken = null) {
    try {
      console.log(`📋 Getting available services for user: ${userId}`);
      
      // 1. Get all active services from service-service
      console.log(`🔗 Calling: ${SERVICE_SERVICE_URL}/api/service?page=1&limit=1000`);
      const servicesResponse = await axios.get(`${SERVICE_SERVICE_URL}/api/service`, {
        params: { 
          page: 1, 
          limit: 1000 
        }
      });
      
      console.log('📦 Services response:', servicesResponse.data);
      
      let allServices = [];
      // Handle different response formats
      if (servicesResponse.data.data && Array.isArray(servicesResponse.data.data)) {
        // Format: { success: true, data: [...] }
        allServices = servicesResponse.data.data.filter(s => s.isActive);
      } else if (servicesResponse.data.services && Array.isArray(servicesResponse.data.services)) {
        // Format: { services: [...] }
        allServices = servicesResponse.data.services.filter(s => s.isActive);
      } else if (Array.isArray(servicesResponse.data)) {
        // Format: [...]
        allServices = servicesResponse.data.filter(s => s.isActive);
      }
      
      console.log(`✅ Found ${allServices.length} active services`);
      
      // 2. Get patient records to check for unused services (dịch vụ được chỉ định)
      let unusedServices = [];
      let examRecords = [];
      
      // Skip fetching records for anonymous users
      if (userId !== 'anonymous') {
        try {
          // Fetch patient records to extract treatmentIndications
          console.log(`🔗 Calling: ${RECORD_SERVICE_URL}/api/record/patient/${userId}?limit=100`);
          
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
          
          console.log('📦 Records response:', recordsResponse.data);
          
          if (recordsResponse.data.success && recordsResponse.data.data && Array.isArray(recordsResponse.data.data)) {
            const records = recordsResponse.data.data;
            
            // Extract all treatmentIndications that are not used yet
            records.forEach(record => {
              if (record.treatmentIndications && Array.isArray(record.treatmentIndications)) {
                record.treatmentIndications.forEach(indication => {
                  // Only include unused indications
                  if (!indication.used && indication.serviceId && indication.serviceAddOnId) {
                    unusedServices.push({
                      serviceId: indication.serviceId,
                      serviceAddOnId: indication.serviceAddOnId, // The specific addon that was indicated
                      recordId: record._id,
                      recordDentistId: record.dentistId, // Dentist who examined and created this indication
                      recordDentistName: record.dentistName,
                      serviceName: indication.serviceName,
                      serviceAddOnName: indication.serviceAddOnName,
                      notes: indication.notes || ''
                    });
                  }
                });
              }
            });
            
            console.log(`🎯 Extracted ${unusedServices.length} unused service indications from ${records.length} records`);
          }
        } catch (error) {
          console.warn('⚠️ Could not fetch patient records:', error.message);
          // This is OK - user might not have any exam records
        }
      } else {
        console.log('ℹ️ Anonymous user - skipping unused services check');
      }
      
      // 3. Filter services based on requireExamFirst
      const unusedServiceIds = new Set(unusedServices.map(s => s.serviceId.toString()));
      
      const availableServices = allServices.filter(service => {
        // ⭐ IMPORTANT: Only filter out if requireExamFirst is TRUE and user has NO indication
        // If requireExamFirst is FALSE or undefined, always show the service
        if (!service.requireExamFirst) {
          return true; // Always show services that don't require exam first
        }
        
        // If service requires exam first, check if user has unused indication
        const hasIndication = unusedServiceIds.has(service._id.toString());
        
        if (!hasIndication) {
          console.log(`   ⚠️ Skipping "${service.name}" - requireExamFirst but no indication`);
        }
        
        return hasIndication;
      });
      
      console.log(`✅ Total available services after filtering: ${availableServices.length}`);
      
      // 3.5. Fetch full service details to get basePrice and duration
      const servicesWithDetails = await Promise.all(
        availableServices.map(async (service) => {
          try {
            const detailResponse = await axios.get(
              `${SERVICE_SERVICE_URL}/api/service/${service._id}`
            );
            
            if (detailResponse.data.success && detailResponse.data.data) {
              return {
                ...service,
                ...detailResponse.data.data // Merge full details
              };
            }
            return service; // Fallback to original if fetch fails
          } catch (error) {
            console.warn(`⚠️ Could not fetch details for service ${service._id}:`, error.message);
            return service; // Fallback to original
          }
        })
      );
      
      console.log(`📦 Fetched full details for ${servicesWithDetails.length} services`);
      
      // 4. Mark recommended services and attach recordId + specific addon
      const servicesWithMetadata = servicesWithDetails.map(service => {
        const isRecommended = unusedServiceIds.has(service._id.toString());
        
        // Find recordId and specific addon if recommended
        let recordId = null;
        let recommendationNotes = null;
        let recommendedAddOnId = null; // The specific addon that was indicated
        let recordDentistId = null; // Dentist who created the indication
        let recordDentistName = null;
        
        if (isRecommended) {
          const unusedService = unusedServices.find(
            unused => unused.serviceId.toString() === service._id.toString()
          );
          if (unusedService) {
            recordId = unusedService.recordId;
            recommendationNotes = unusedService.notes;
            recommendedAddOnId = unusedService.serviceAddOnId; // Important: specific addon
            recordDentistId = unusedService.recordDentistId;
            recordDentistName = unusedService.recordDentistName;
          }
        }
        
        return {
          ...service,
          isRecommended,
          recordId, // Will be used to update hasBeenUsed after booking
          recordDentistId, // Dentist who examined patient
          recordDentistName,
          recommendationNotes,
          recommendedAddOnId // The specific addon that was indicated by doctor
        };
      });
      
      console.log(`🎉 Prepared ${servicesWithMetadata.length} services with metadata`);
      console.log(`   - Recommended: ${servicesWithMetadata.filter(s => s.isRecommended).length}`);
      console.log(`   - Regular: ${servicesWithMetadata.filter(s => !s.isRecommended).length}`);
      
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
   * Get available dentists for a service
   * @param {String} serviceId - Service ID
   * @param {String} serviceAddOnId - Service addon ID (optional)
   * @returns {Promise<Array>}
   */
  async getAvailableDentists(serviceId, serviceAddOnId = null) {
    try {
      // Get service info to know which specialization is needed
      const serviceResponse = await axios.get(`${SERVICE_SERVICE_URL}/api/service/${serviceId}`);
      const service = serviceResponse.data.service;
      
      // Get all dentists
      const dentistsResponse = await axios.get(`${AUTH_SERVICE_URL}/api/users/by-role/dentist`);
      const dentists = dentistsResponse.data.data || [];
      
      // Filter dentists based on service specialization (if any)
      let filteredDentists = dentists.filter(d => d.isActive);
      
      // TODO: Filter by specialization if service has specific requirement
      // For now, return all active dentists
      
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
   * Get available time slots
   * @param {String} dentistId - Dentist ID
   * @param {String} date - Date in YYYY-MM-DD format
   * @param {Number} serviceDuration - Service duration in minutes
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
   * Create appointment reservation and return payment URL
   * @param {Object} bookingData
   * @returns {Promise<Object>}
   */
  async createReservation(bookingData) {
    try {
      const { userId, serviceId, serviceAddOnId, dentistId, date, slotIds, notes } = bookingData;
      
      // Get user info
      const userResponse = await axios.get(`${AUTH_SERVICE_URL}/api/users/${userId}`);
      const user = userResponse.data.user;
      
      // Get service info
      const serviceResponse = await axios.get(`${SERVICE_SERVICE_URL}/api/service/${serviceId}`);
      const service = serviceResponse.data.service;
      
      // Prepare reservation data
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
      
      console.log('📋 Creating reservation:', reservationData);
      
      // Create reservation via appointment service
      const reservationResponse = await axios.post(
        `${APPOINTMENT_SERVICE_URL}/api/appointments/reserve`,
        reservationData
      );
      
      if (!reservationResponse.data.success) {
        throw new Error(reservationResponse.data.message || 'Không thể tạo reservation');
      }
      
      const reservation = reservationResponse.data.data;
      
      console.log('✅ Reservation created:', reservation.appointmentCode);
      
      // Create payment URL via payment service
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
      
      console.log('✅ Payment URL created');
      
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
      console.error('❌ createReservation error:', error);
      throw new Error('Không thể tạo đặt lịch: ' + error.message);
    }
  }
}

module.exports = new BookingService();

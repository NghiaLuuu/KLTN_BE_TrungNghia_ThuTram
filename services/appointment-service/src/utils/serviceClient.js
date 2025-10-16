const axios = require('axios');

/**
 * HTTP Client for inter-service communication
 * Alternative to RPC when simpler request-response is needed
 */
class ServiceClient {
  constructor() {
    this.services = {
      'schedule-service': process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005',
      'service-service': process.env.SERVICE_SERVICE_URL || 'http://localhost:3009',
      'payment-service': process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007',
      'auth-service': process.env.AUTH_SERVICE_URL || 'http://localhost:3001'
    };
  }

  /**
   * Get base URL for a service
   */
  getServiceUrl(serviceName) {
    const url = this.services[serviceName];
    if (!url) {
      throw new Error(`Service URL not configured for: ${serviceName}`);
    }
    return url;
  }

  /**
   * Make HTTP GET request to a service
   */
  async get(serviceName, path, config = {}) {
    const baseUrl = this.getServiceUrl(serviceName);
    const url = `${baseUrl}${path}`;
    
    try {
      const response = await axios.get(url, {
        timeout: 10000,
        ...config
      });
      return response.data;
    } catch (error) {
      console.error(`[ServiceClient] GET ${url} failed:`, error.message);
      throw new Error(`Failed to call ${serviceName}: ${error.message}`);
    }
  }

  /**
   * Make HTTP POST request to a service
   */
  async post(serviceName, path, data, config = {}) {
    const baseUrl = this.getServiceUrl(serviceName);
    const url = `${baseUrl}${path}`;
    
    try {
      const response = await axios.post(url, data, {
        timeout: 10000,
        ...config
      });
      return response.data;
    } catch (error) {
      console.error(`[ServiceClient] POST ${url} failed:`, error.message);
      throw new Error(`Failed to call ${serviceName}: ${error.message}`);
    }
  }

  /**
   * Get slot by ID from schedule-service
   */
  async getSlot(slotId) {
    const response = await this.get('schedule-service', `/api/slot/${slotId}`);
    return response.slot || response.data || response;
  }

  /**
   * Get slots by dentist and date
   */
  async getSlotsByDentistAndDate(dentistId, date) {
    const response = await this.get('schedule-service', `/api/slot/dentist/${dentistId}/date/${date}`);
    return response.slots || response.data || response;
  }

  /**
   * Bulk update slots - Use new status-based API
   * @param {Array} slotIds - Array of slot IDs
   * @param {Object} updates - Updates to apply { status, appointmentId, lockedAt, lockedBy }
   */
  async bulkUpdateSlots(slotIds, updates) {
    const response = await this.put('schedule-service', '/api/slot/bulk-update', {
      slotIds,
      updates
    });
    return response;
  }

  /**
   * @deprecated Use bulkUpdateSlots with status instead
   * Update slots booked status (legacy)
   */
  async updateSlotsBooked(slotIds, isBooked) {
    console.warn('⚠️ updateSlotsBooked is deprecated, use bulkUpdateSlots with status instead');
    const status = isBooked ? 'booked' : 'available';
    return this.bulkUpdateSlots(slotIds, { status });
  }

  /**
   * Create temporary payment for appointment reservation
   * @param {String} appointmentHoldKey - Redis key for held appointment
   * @param {Number} amount - Payment amount
   * @returns {Object} Payment data with tempPaymentId, orderId, paymentUrl
   */
  async createTemporaryPayment(appointmentHoldKey, amount) {
    const response = await this.post('payment-service', '/api/payments/temporary', {
      appointmentHoldKey,
      amount
    });
    return response;
  }
}

// Export singleton instance
const serviceClient = new ServiceClient();
module.exports = serviceClient;
module.exports.ServiceClient = ServiceClient;

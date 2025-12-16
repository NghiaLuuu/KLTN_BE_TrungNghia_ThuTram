const axios = require('axios');

/**
 * HTTP Client cho giao tiếp giữa các service
 * Thay thế cho RPC khi cần request-response đơn giản hơn
 */
class ServiceClient {
  constructor() {
    this.services = {
      'schedule-service': process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005',
      'service-service': process.env.SERVICE_SERVICE_URL || 'http://localhost:3009',
      'payment-service': process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007',
      'auth-service': process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
      'room-service': process.env.ROOM_SERVICE_URL || 'http://localhost:3002'
    };
  }

  /**
   * Lấy base URL của một service
   * @param {string} serviceName - Tên service
   * @returns {string} URL base của service
   */
  getServiceUrl(serviceName) {
    const url = this.services[serviceName];
    if (!url) {
      throw new Error(`URL service chưa được cấu hình: ${serviceName}`);
    }
    return url;
  }

  /**
   * Gửi HTTP GET request đến service
   * @param {string} serviceName - Tên service
   * @param {string} path - Đường dẫn API
   * @param {object} config - Cấu hình axios
   * @returns {Promise<any>} Response data
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
      console.error(`[ServiceClient] GET ${url} thất bại:`, error.message);
      throw new Error(`Gọi ${serviceName} thất bại: ${error.message}`);
    }
  }

  /**
   * Gửi HTTP POST request đến service
   * @param {string} serviceName - Tên service
   * @param {string} path - Đường dẫn API
   * @param {object} data - Dữ liệu gửi đi
   * @param {object} config - Cấu hình axios
   * @returns {Promise<any>} Response data
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
      console.error(`[ServiceClient] POST ${url} thất bại:`, error.message);
      throw new Error(`Gọi ${serviceName} thất bại: ${error.message}`);
    }
  }

  /**
   * Lấy thông tin slot theo ID từ schedule-service
   * @param {string} slotId - ID của slot
   * @returns {Promise<object>} Dữ liệu slot
   */
  async getSlot(slotId) {
    const response = await this.get('schedule-service', `/api/slot/${slotId}`);
    return response.slot || response.data || response;
  }

  /**
   * Lấy danh sách slot theo nha sĩ và ngày
   * @param {string} dentistId - ID nha sĩ
   * @param {string} date - Ngày (YYYY-MM-DD)
   * @returns {Promise<Array>} Danh sách slots
   */
  async getSlotsByDentistAndDate(dentistId, date) {
    const response = await this.get('schedule-service', `/api/slot/dentist/${dentistId}/date/${date}`);
    return response.slots || response.data || response;
  }

  /**
   * Cập nhật hàng loạt slots - Sử dụng API mới dựa trên status
   * @param {Array} slotIds - Mảng ID slot
   * @param {Object} updates - Cập nhật cần áp dụng { status, appointmentId, lockedAt, lockedBy }
   * @returns {Promise<object>} Kết quả cập nhật
   */
  async bulkUpdateSlots(slotIds, updates) {
    const response = await this.put('schedule-service', '/api/slot/bulk-update', {
      slotIds,
      updates
    });
    return response;
  }

  /**
   * @deprecated Sử dụng bulkUpdateSlots với status thay thế
   * Cập nhật trạng thái booked của slots (cũ)
   */
  async updateSlotsBooked(slotIds, isBooked) {
    console.warn('⚠️ updateSlotsBooked đã lỗi thời, sử dụng bulkUpdateSlots với status thay thế');
    const status = isBooked ? 'booked' : 'available';
    return this.bulkUpdateSlots(slotIds, { status });
  }

  /**
   * Lấy cấu hình lịch từ schedule-service
   * @returns {Object} Config lịch với shifts, unitDuration, maxBookingDays, depositAmount
   */
  async getScheduleConfig() {
    const response = await this.get('schedule-service', '/api/schedule/config');
    return response.config || response.data || response;
  }

  /**
   * Lấy chi tiết ServiceAddOn bao gồm giá
   * @param {String} serviceId - ID dịch vụ
   * @param {String} addOnId - ID dịch vụ phụ
   * @returns {Object} Dữ liệu ServiceAddOn với giá
   */
  async getServiceAddOnPrice(serviceId, addOnId) {
    try {
      const response = await this.get('service-service', `/api/services/${serviceId}/addons/${addOnId}`);
      // Định dạng response: { service: "Service name", addOn: { _id, name, price, ... } }
      return response.addOn || response.data?.addOn;
    } catch (error) {
      console.error(`[ServiceClient] Lấy giá ServiceAddOn ${serviceId}/${addOnId} thất bại:`, error.message);
      return null;
    }
  }

  /**
   * Lấy thông tin phòng theo ID từ room-service (có cache Redis)
   * @param {String} roomId - ID phòng
   * @returns {Object} Dữ liệu phòng { _id, name, description, type, ... }
   */
  async getRoomById(roomId) {
    try {
      const response = await this.get('room-service', `/api/rooms/${roomId}`);
      return response.room || response.data || response;
    } catch (error) {
      console.error(`[ServiceClient] Lấy thông tin phòng ${roomId} thất bại:`, error.message);
      return null;
    }
  }

  /**
   * Lấy thông tin phòng con theo ID từ room-service (có cache Redis)
   * @param {String} roomId - ID phòng cha
   * @param {String} subroomId - ID phòng con
   * @returns {Object} Dữ liệu phòng con { _id, name, description, ... }
   */
  async getSubroomById(roomId, subroomId) {
    try {
      const response = await this.get('room-service', `/api/rooms/${roomId}/subrooms/${subroomId}`);
      return response.subroom || response.data || response;
    } catch (error) {
      console.error(`[ServiceClient] Lấy thông tin phòng con ${subroomId} trong phòng ${roomId} thất bại:`, error.message);
      return null;
    }
  }

  /**
   * Tạo payment tạm thời cho reservation lịch hẹn
   * @param {String} appointmentHoldKey - Redis key cho lịch hẹn đang giữ
   * @param {Number} amount - Số tiền thanh toán
   * @returns {Object} Dữ liệu payment với tempPaymentId, orderId, paymentUrl
   */
  async createTemporaryPayment(appointmentHoldKey, amount) {
    const response = await this.post('payment-service', '/api/payments/temporary', {
      appointmentHoldKey,
      amount
    });
    return response;
  }

  /**
   * Gửi HTTP PUT request đến service
   * @param {string} serviceName - Tên service
   * @param {string} path - Đường dẫn API
   * @param {object} data - Dữ liệu gửi đi
   * @param {object} config - Cấu hình axios
   * @returns {Promise<any>} Response data
   */
  async put(serviceName, path, data, config = {}) {
    const baseUrl = this.getServiceUrl(serviceName);
    const url = `${baseUrl}${path}`;
    
    try {
      const response = await axios.put(url, data, {
        timeout: 10000,
        ...config
      });
      return response.data;
    } catch (error) {
      console.error(`[ServiceClient] PUT ${url} thất bại:`, error.message);
      throw new Error(`Gọi ${serviceName} thất bại: ${error.message}`);
    }
  }
}

// Export singleton instance
const serviceClient = new ServiceClient();
module.exports = serviceClient;
module.exports.ServiceClient = ServiceClient;

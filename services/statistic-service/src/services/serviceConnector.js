const rabbitClient = require('../config/rabbitmq.config');

class ServiceConnector {
  /**
   * Get appointment statistics from appointment service
   */
  static async getAppointmentStats(startDate, endDate, filters = {}) {
    try {
      // Convert to Date objects if they're strings
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const message = {
        action: 'getStatistics',
        payload: {
          startDate: start,
          endDate: end,
          ...filters
        }
      };

      const result = await rabbitClient.request('appointment_queue', message);
      return result.data || null;
    } catch (error) {
      console.error('Error getting appointment stats:', error);
      throw new Error('Không thể lấy thống kê lịch hẹn');
    }
  }

  /**
   * Get revenue statistics from invoice service
   */
  static async getRevenueStats(startDate, endDate, groupBy = 'day', filters = {}) {
    try {
      // Convert to Date objects if they're strings
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const message = {
        method: 'getRevenueStatistics',
        params: {
          startDate: start,
          endDate: end,
          groupBy,
          dentistId: filters.dentistId || null,
          serviceId: filters.serviceId || null
        }
      };

      const result = await rabbitClient.request('invoice-service_rpc_queue', message);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get revenue stats');
      }
      
      return result.result || null;
    } catch (error) {
      console.error('Error getting revenue stats:', error);
      throw new Error('Không thể lấy thống kê doanh thu');
    }
  }

  /**
   * Get service statistics from invoice service
   */
  static async getServiceStats(startDate, endDate) {
    try {
      // Convert to Date objects if they're strings
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const message = {
        method: 'getServiceStatistics',
        params: {
          startDate: start,
          endDate: end
        }
      };

      const result = await rabbitClient.request('invoice-service_rpc_queue', message);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get service stats');
      }
      
      return result.result || null;
    } catch (error) {
      console.error('Error getting service stats:', error);
      throw new Error('Không thể lấy thống kê dịch vụ');
    }
  }

  /**
   * Get payment statistics from payment service
   */
  static async getPaymentStats(startDate, endDate, filters = {}) {
    try {
      // Convert to Date objects if they're strings
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const message = {
        action: 'getPaymentStatistics',
        payload: {
          startDate: start,
          endDate: end,
          ...filters
        }
      };

      const result = await rabbitClient.request('payment_queue', message);
      return result.data || null;
    } catch (error) {
      console.error('Error getting payment stats:', error);
      throw new Error('Không thể lấy thống kê thanh toán');
    }
  }

  /**
   * Get staff statistics from auth service
   */
  static async getStaffStats(filters = {}) {
    try {
      const message = {
        action: 'getStaffStatistics',
        payload: filters
      };

      const result = await rabbitClient.request('auth_queue', message);
      return result.data || null;
    } catch (error) {
      console.error('Error getting staff stats:', error);
      throw new Error('Không thể lấy thống kê nhân viên');
    }
  }

  /**
   * Get schedule statistics from schedule service
   */
  static async getScheduleStats(startDate, endDate, filters = {}) {
    try {
      // Convert to Date objects if they're strings
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const message = {
        action: 'getScheduleStatistics',
        payload: {
          startDate: start,
          endDate: end,
          ...filters
        }
      };

      const result = await rabbitClient.request('schedule_queue', message);
      return result.data || null;
    } catch (error) {
      console.error('Error getting schedule stats:', error);
      throw new Error('Không thể lấy thống kê lịch trình');
    }
  }

  /**
   * Get slot utilization statistics from schedule service
   */
  static async getSlotUtilizationStats(startDate, endDate, roomIds = [], timeRange = 'month', shiftName = null) {
    try {
      // Convert to Date objects if they're strings
      const start = startDate instanceof Date ? startDate : new Date(startDate);
      const end = endDate instanceof Date ? endDate : new Date(endDate);
      
      const message = {
        action: 'getUtilizationStatistics',
        payload: {
          startDate: start,
          endDate: end,
          roomIds,
          timeRange,
          shiftName
        }
      };

      const result = await rabbitClient.request('schedule_queue', message);
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to get utilization statistics');
      }
      
      return result.data || null;
    } catch (error) {
      console.error('Error getting slot utilization stats:', error);
      throw new Error('Không thể lấy thống kê hiệu suất phòng khám');
    }
  }

  /**
   * Get patient statistics by analyzing appointments
   */
  static async getPatientStats(startDate, endDate, filters = {}) {
    try {
      // Get appointment data and analyze for patient patterns
      const appointmentStats = await this.getAppointmentStats(startDate, endDate, filters);
      
      if (!appointmentStats) {
        return null;
      }

      // Process patient statistics from appointment data
      return this.processPatientStatistics(appointmentStats);
    } catch (error) {
      console.error('Error getting patient stats:', error);
      throw new Error('Không thể lấy thống kê bệnh nhân');
    }
  }

  /**
   * Process patient statistics from appointment data
   */
  static processPatientStatistics(appointmentData) {
    // This would process appointment data to extract patient insights
    // For now, return a basic structure
    return {
      totalPatients: appointmentData.totalUniquePatients || 0,
      newPatients: appointmentData.newPatients || 0,
      returningPatients: appointmentData.returningPatients || 0,
      genderDistribution: appointmentData.genderDistribution || {},
      ageDistribution: appointmentData.ageDistribution || {}
    };
  }
}

module.exports = ServiceConnector;
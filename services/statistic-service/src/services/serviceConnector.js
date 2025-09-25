const rabbitClient = require('../config/rabbitmq.config');

class ServiceConnector {
  /**
   * Get appointment statistics from appointment service
   */
  static async getAppointmentStats(startDate, endDate, filters = {}) {
    try {
      const message = {
        action: 'getStatistics',
        payload: {
          startDate,
          endDate,
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
  static async getRevenueStats(startDate, endDate, groupBy = 'month') {
    try {
      const message = {
        action: 'getRevenueStatistics',
        payload: {
          startDate,
          endDate,
          groupBy
        }
      };

      const result = await rabbitClient.request('invoice_queue', message);
      return result.data || null;
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
      const message = {
        action: 'getServiceStatistics',
        payload: {
          startDate,
          endDate
        }
      };

      const result = await rabbitClient.request('invoice_queue', message);
      return result.data || null;
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
      const message = {
        action: 'getPaymentStatistics',
        payload: {
          startDate,
          endDate,
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
      const message = {
        action: 'getScheduleStatistics',
        payload: {
          startDate,
          endDate,
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
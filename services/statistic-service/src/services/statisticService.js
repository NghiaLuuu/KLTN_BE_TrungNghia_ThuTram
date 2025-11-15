const ServiceConnector = require('./serviceConnector');
const CacheUtils = require('../utils/cacheUtils');
const DateUtils = require('../utils/dateUtils');

class StatisticService {
  /**
   * Get dashboard overview statistics
   */
  async getDashboardStats(timeframe = 'month') {
    const cacheKey = CacheUtils.generateKey('dashboard', { timeframe });
    
    return await CacheUtils.getOrSet(cacheKey, async () => {
      const { startDate, endDate } = DateUtils.getPeriodRange(timeframe);
      const { startDate: prevStart, endDate: prevEnd } = DateUtils.getPreviousPeriodRange(timeframe);

      try {
        // Get current period stats
        const [
          appointmentStats,
          revenueStats,
          paymentStats,
          staffStats
        ] = await Promise.allSettled([
          ServiceConnector.getAppointmentStats(startDate, endDate),
          ServiceConnector.getRevenueStats(startDate, endDate),
          ServiceConnector.getPaymentStats(startDate, endDate),
          ServiceConnector.getStaffStats()
        ]);

        // Get previous period stats for comparison
        const [
          prevAppointmentStats,
          prevRevenueStats
        ] = await Promise.allSettled([
          ServiceConnector.getAppointmentStats(prevStart, prevEnd),
          ServiceConnector.getRevenueStats(prevStart, prevEnd)
        ]);

        const dashboard = {
          timeframe,
          period: {
            current: { startDate, endDate },
            previous: { startDate: prevStart, endDate: prevEnd }
          },
          overview: {
            totalAppointments: this.getValue(appointmentStats, 'total', 0),
            completedAppointments: this.getValue(appointmentStats, 'completed', 0),
            totalRevenue: this.getValue(revenueStats, 'totalAmount', 0),
            totalPatients: this.getValue(appointmentStats, 'uniquePatients', 0),
            activeStaff: this.getValue(staffStats, 'activeCount', 0)
          },
          comparison: {
            appointments: this.calculatePercentageChange(
              this.getValue(appointmentStats, 'total', 0),
              this.getValue(prevAppointmentStats, 'total', 0)
            ),
            revenue: this.calculatePercentageChange(
              this.getValue(revenueStats, 'totalAmount', 0),
              this.getValue(prevRevenueStats, 'totalAmount', 0)
            )
          },
          trends: {
            appointments: this.getValue(appointmentStats, 'dailyTrends', []),
            revenue: this.getValue(revenueStats, 'dailyTrends', [])
          }
        };

        return dashboard;
      } catch (error) {
        console.error('Dashboard stats error:', error);
        throw new Error('Không thể tải thống kê dashboard');
      }
    }, 1800); // Cache for 30 minutes
  }

  /**
   * Get detailed appointment statistics
   */
  async getAppointmentStatistics(startDate, endDate, filters = {}) {
    // Ensure dates are Date objects
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    const cacheKey = CacheUtils.generateKey('appointments', { 
      startDate: start.toISOString(), 
      endDate: end.toISOString(), 
      ...filters 
    });

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        const stats = await ServiceConnector.getAppointmentStats(start, end, filters);
        
        if (!stats) {
          return this.getEmptyAppointmentStats();
        }

        return {
          period: { startDate: start, endDate: end },
          summary: {
            total: stats.total || 0,
            pending: stats.pending || 0,
            confirmed: stats.confirmed || 0,
            completed: stats.completed || 0,
            cancelled: stats.cancelled || 0,
            noShow: stats.noShow || 0
          },
          trends: stats.dailyTrends || [],
          byChannel: stats.byChannel || {},
          byDentist: stats.byDentist || [],
          byService: stats.byService || [],
          completionRate: stats.completionRate || 0,
          averageWaitTime: stats.averageWaitTime || 0
        };
      } catch (error) {
        console.error('Appointment statistics error:', error);
        throw new Error('Không thể lấy thống kê lịch hẹn');
      }
    }, 1800);
  }

  /**
   * Get revenue statistics with breakdown by service and payment method
   */
  async getRevenueStatistics(startDate, endDate, groupBy = 'day', filters = {}) {
    // Ensure dates are Date objects
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    const cacheKey = CacheUtils.generateKey('revenue', { 
      startDate: start.toISOString(), 
      endDate: end.toISOString(), 
      groupBy,
      ...filters
    });

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        // Get revenue stats from invoice-service with all filters
        const revenueStats = await ServiceConnector.getRevenueStats(start, end, groupBy, filters);

        if (!revenueStats) {
          return this.getEmptyRevenueStats();
        }

        // Return the data structure expected by frontend
        return {
          period: revenueStats.period || { startDate: start, endDate: end, groupBy },
          filters,
          summary: {
            totalRevenue: revenueStats.summary?.totalRevenue || 0,
            totalInvoices: revenueStats.summary?.totalInvoices || 0,
            averageInvoiceValue: revenueStats.summary?.averageValue || 0,
            paidAmount: revenueStats.summary?.paidAmount || 0,
            pendingAmount: revenueStats.summary?.pendingAmount || 0,
            paymentRate: revenueStats.summary?.paymentRate || 0
          },
          trends: revenueStats.trends || [],
          byDentist: revenueStats.byDentist || [],
          byService: revenueStats.byService || [],
          rawDetails: revenueStats.rawDetails || [] // ✅ Add rawDetails for cross-filtering
        };
      } catch (error) {
        console.error('Revenue statistics error:', error);
        throw new Error('Không thể lấy thống kê doanh thu');
      }
    }, 1800);
  }

  /**
   * Get patient statistics
   */
  async getPatientStatistics(startDate, endDate, filters = {}) {
    // Ensure dates are Date objects
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    const cacheKey = CacheUtils.generateKey('patients', { 
      startDate: start.toISOString(), 
      endDate: end.toISOString(), 
      ...filters 
    });

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        const patientStats = await ServiceConnector.getPatientStats(start, end, filters);
        
        if (!patientStats) {
          return this.getEmptyPatientStats();
        }

        return {
          period: { startDate: start, endDate: end },
          summary: {
            totalPatients: patientStats.totalPatients || 0,
            newPatients: patientStats.newPatients || 0,
            returningPatients: patientStats.returningPatients || 0,
            retentionRate: this.calculateRetentionRate(patientStats)
          },
          demographics: {
            genderDistribution: patientStats.genderDistribution || {},
            ageDistribution: patientStats.ageDistribution || {}
          },
          trends: patientStats.trends || []
        };
      } catch (error) {
        console.error('Patient statistics error:', error);
        throw new Error('Không thể lấy thống kê bệnh nhân');
      }
    }, 3600);
  }

  /**
   * Get staff and dentist statistics
   */
  async getStaffStatistics(filters = {}) {
    const cacheKey = CacheUtils.generateKey('staff', filters);

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        const staffStats = await ServiceConnector.getStaffStats(filters);
        
        if (!staffStats) {
          return this.getEmptyStaffStats();
        }

        return {
          summary: {
            totalStaff: staffStats.totalStaff || 0,
            activeStaff: staffStats.activeStaff || 0,
            byRole: staffStats.byRole || {}
          },
          dentists: {
            total: staffStats.dentists?.total || 0,
            active: staffStats.dentists?.active || 0,
            performance: staffStats.dentists?.performance || []
          },
          workload: staffStats.workload || {},
          availability: staffStats.availability || {}
        };
      } catch (error) {
        console.error('Staff statistics error:', error);
        throw new Error('Không thể lấy thống kê nhân viên');
      }
    }, 3600);
  }

  /**
   * Get service performance statistics
   */
  async getServiceStatistics(startDate, endDate, filters = {}) {
    // Ensure dates are Date objects
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    const cacheKey = CacheUtils.generateKey('services', { 
      startDate: start.toISOString(), 
      endDate: end.toISOString(), 
      ...filters 
    });

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        const serviceStats = await ServiceConnector.getServiceStats(start, end);
        
        if (!serviceStats || !Array.isArray(serviceStats)) {
          return this.getEmptyServiceStats();
        }

        const totalRevenue = serviceStats.reduce((sum, service) => sum + (service.totalRevenue || 0), 0);
        const totalServices = serviceStats.reduce((sum, service) => sum + (service.totalServices || 0), 0);

        return {
          period: { startDate: start, endDate: end },
          summary: {
            totalServices: totalServices,
            totalRevenue: totalRevenue,
            averageServiceValue: totalServices > 0 ? totalRevenue / totalServices : 0,
            uniqueServiceTypes: serviceStats.length
          },
          services: serviceStats.map(service => ({
            name: service.name || service._id,
            type: service.type || service._id,
            count: service.totalServices || service.count || 0,
            revenue: service.totalRevenue || 0,
            averagePrice: service.averagePrice || 0,
            percentageOfTotal: totalRevenue > 0 ? ((service.totalRevenue || 0) / totalRevenue) * 100 : 0
          })),
          topServices: serviceStats
            .sort((a, b) => (b.totalRevenue || 0) - (a.totalRevenue || 0))
            .slice(0, 10)
        };
      } catch (error) {
        console.error('Service statistics error:', error);
        throw new Error('Không thể lấy thống kê dịch vụ');
      }
    }, 1800);
  }

  /**
   * Get schedule and room utilization statistics
   */
  async getScheduleStatistics(startDate, endDate, filters = {}) {
    // Ensure dates are Date objects
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const end = endDate instanceof Date ? endDate : new Date(endDate);
    
    const cacheKey = CacheUtils.generateKey('schedule', { 
      startDate: start.toISOString(), 
      endDate: end.toISOString(), 
      ...filters 
    });

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        const scheduleStats = await ServiceConnector.getScheduleStats(start, end, filters);
        
        if (!scheduleStats) {
          return this.getEmptyScheduleStats();
        }

        return {
          period: { startDate: start, endDate: end },
          roomUtilization: scheduleStats.roomUtilization || [],
          shiftDistribution: scheduleStats.shiftDistribution || {},
          staffAllocation: scheduleStats.staffAllocation || {},
          averageUtilizationRate: scheduleStats.averageUtilizationRate || 0
        };
      } catch (error) {
        console.error('Schedule statistics error:', error);
        throw new Error('Không thể lấy thống kê lịch trình');
      }
    }, 1800);
  }

  /**
   * Get clinic utilization statistics (slot-based)
   */
  async getClinicUtilizationStatistics(startDate, endDate, roomIds = [], timeRange = 'month', shiftName = null) {
    const cacheKey = CacheUtils.generateKey('clinic-utilization', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      roomIds: roomIds?.join(','),
      timeRange,
      shiftName
    });

    return await CacheUtils.getOrSet(cacheKey, async () => {
      try {
        // Get slot stats from schedule-service
        const slotStats = await ServiceConnector.getSlotUtilizationStats(
          startDate,
          endDate,
          roomIds,
          timeRange,
          shiftName
        );

        if (!slotStats) {
          return this.getEmptyUtilizationStats();
        }

        return {
          period: { startDate, endDate, timeRange },
          summary: slotStats.summary,
          byRoom: slotStats.byRoom,
          byShift: slotStats.byShift,
          timeline: slotStats.timeline || []
        };
      } catch (error) {
        console.error('Clinic utilization error:', error);
        throw new Error('Không thể lấy thống kê hiệu suất phòng khám');
      }
    }, 1800);
  }

  /**
   * Generate timeline data for utilization
   */
  generateUtilizationTimeline(startDate, endDate, timeRange) {
    const timeline = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // For now, return empty timeline - can be enhanced later
    // This would require fetching slot data grouped by date
    return timeline;
  }

  // Helper methods
  getValue(promiseResult, path, defaultValue) {
    if (promiseResult.status === 'fulfilled' && promiseResult.value) {
      if (!path) return promiseResult.value;
      return promiseResult.value[path] ?? defaultValue;
    }
    return defaultValue;
  }

  calculatePercentageChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  calculateRetentionRate(patientStats) {
    const { totalPatients, returningPatients } = patientStats;
    if (totalPatients === 0) return 0;
    return Math.round((returningPatients / totalPatients) * 100);
  }

  // Empty stats templates
  getEmptyAppointmentStats() {
    return {
      summary: { total: 0, pending: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0 },
      trends: [],
      byChannel: {},
      byDentist: [],
      byService: [],
      completionRate: 0,
      averageWaitTime: 0
    };
  }

  getEmptyRevenueStats() {
    return {
      summary: {
        totalRevenue: 0,
        totalInvoices: 0,
        averageInvoiceValue: 0,
        paidAmount: 0,
        pendingAmount: 0,
        paymentRate: 0
      },
      trends: [],
      byDentist: [],
      byService: []
    };
  }

  getEmptyPatientStats() {
    return {
      summary: { totalPatients: 0, newPatients: 0, returningPatients: 0, retentionRate: 0 },
      demographics: { genderDistribution: {}, ageDistribution: {} },
      trends: []
    };
  }

  getEmptyStaffStats() {
    return {
      summary: { totalStaff: 0, activeStaff: 0, byRole: {} },
      dentists: { total: 0, active: 0, performance: [] },
      workload: {},
      availability: {}
    };
  }

  getEmptyServiceStats() {
    return {
      summary: { totalServices: 0, totalRevenue: 0, averageServiceValue: 0, uniqueServiceTypes: 0 },
      services: [],
      topServices: []
    };
  }

  getEmptyScheduleStats() {
    return {
      roomUtilization: [],
      shiftDistribution: {},
      staffAllocation: {},
      averageUtilizationRate: 0
    };
  }

  getEmptyUtilizationStats() {
    return {
      summary: { totalSlots: 0, bookedSlots: 0, emptySlots: 0, utilizationRate: 0 },
      byRoom: [],
      byShift: {},
      timeline: []
    };
  }
}

module.exports = new StatisticService();
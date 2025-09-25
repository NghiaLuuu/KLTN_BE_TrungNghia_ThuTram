const statisticService = require('../services/statisticService');
const DateUtils = require('../utils/dateUtils');
const CacheUtils = require('../utils/cacheUtils');

class StatisticController {
  /**
   * Get dashboard overview statistics
   */
  async getDashboard(req, res) {
    try {
      const { timeframe = 'month' } = req.query;
      
      const dashboard = await statisticService.getDashboardStats(timeframe);
      
      res.json({
        success: true,
        message: 'Lấy thống kê dashboard thành công',
        data: dashboard
      });
    } catch (error) {
      console.error('Dashboard error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê dashboard'
      });
    }
  }

  /**
   * Get appointment statistics
   */
  async getAppointmentStats(req, res) {
    try {
      const { startDate, endDate, dentistId, status, period } = req.query;
      
      const dateRange = DateUtils.parseDateRange(startDate, endDate, period || 'month');
      const filters = {};
      
      if (dentistId) filters.dentistId = dentistId;
      if (status) filters.status = status;
      
      const stats = await statisticService.getAppointmentStatistics(
        dateRange.startDate,
        dateRange.endDate,
        filters
      );
      
      res.json({
        success: true,
        message: 'Lấy thống kê lịch hẹn thành công',
        data: stats
      });
    } catch (error) {
      console.error('Appointment stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê lịch hẹn'
      });
    }
  }

  /**
   * Get revenue statistics
   */
  async getRevenueStats(req, res) {
    try {
      const { startDate, endDate, groupBy = 'day', compareWithPrevious, period } = req.query;
      
      const dateRange = DateUtils.parseDateRange(startDate, endDate, period || 'month');
      
      const stats = await statisticService.getRevenueStatistics(
        dateRange.startDate,
        dateRange.endDate,
        groupBy
      );
      
      // Add comparison if requested
      if (compareWithPrevious === 'true') {
        const prevRange = DateUtils.getPreviousPeriodRange(period || 'month');
        const prevStats = await statisticService.getRevenueStatistics(
          prevRange.startDate,
          prevRange.endDate,
          groupBy
        );
        
        stats.comparison = {
          previous: prevStats.summary,
          change: {
            revenue: statisticService.calculatePercentageChange(
              stats.summary.totalRevenue,
              prevStats.summary.totalRevenue
            ),
            invoices: statisticService.calculatePercentageChange(
              stats.summary.totalInvoices,
              prevStats.summary.totalInvoices
            )
          }
        };
      }
      
      res.json({
        success: true,
        message: 'Lấy thống kê doanh thu thành công',
        data: stats
      });
    } catch (error) {
      console.error('Revenue stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê doanh thu'
      });
    }
  }

  /**
   * Get patient statistics
   */
  async getPatientStats(req, res) {
    try {
      const { startDate, endDate, ageGroup, gender, period } = req.query;
      
      const dateRange = DateUtils.parseDateRange(startDate, endDate, period || 'month');
      const filters = {};
      
      if (ageGroup && ageGroup !== 'all') filters.ageGroup = ageGroup;
      if (gender && gender !== 'all') filters.gender = gender;
      
      const stats = await statisticService.getPatientStatistics(
        dateRange.startDate,
        dateRange.endDate,
        filters
      );
      
      res.json({
        success: true,
        message: 'Lấy thống kê bệnh nhân thành công',
        data: stats
      });
    } catch (error) {
      console.error('Patient stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê bệnh nhân'
      });
    }
  }

  /**
   * Get staff statistics
   */
  async getStaffStats(req, res) {
    try {
      const { role, includeInactive } = req.query;
      
      const filters = {};
      if (role && role !== 'all') filters.role = role;
      if (includeInactive) filters.includeInactive = includeInactive === 'true';
      
      const stats = await statisticService.getStaffStatistics(filters);
      
      res.json({
        success: true,
        message: 'Lấy thống kê nhân viên thành công',
        data: stats
      });
    } catch (error) {
      console.error('Staff stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê nhân viên'
      });
    }
  }

  /**
   * Get service statistics
   */
  async getServiceStats(req, res) {
    try {
      const { startDate, endDate, serviceType, limit = 20, period } = req.query;
      
      const dateRange = DateUtils.parseDateRange(startDate, endDate, period || 'month');
      const filters = {};
      
      if (serviceType && serviceType !== 'all') filters.serviceType = serviceType;
      if (limit) filters.limit = parseInt(limit);
      
      const stats = await statisticService.getServiceStatistics(
        dateRange.startDate,
        dateRange.endDate,
        filters
      );
      
      res.json({
        success: true,
        message: 'Lấy thống kê dịch vụ thành công',
        data: stats
      });
    } catch (error) {
      console.error('Service stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê dịch vụ'
      });
    }
  }

  /**
   * Get schedule and room utilization statistics
   */
  async getScheduleStats(req, res) {
    try {
      const { startDate, endDate, roomId, period } = req.query;
      
      const dateRange = DateUtils.parseDateRange(startDate, endDate, period || 'month');
      const filters = {};
      
      if (roomId) filters.roomId = roomId;
      
      const stats = await statisticService.getScheduleStatistics(
        dateRange.startDate,
        dateRange.endDate,
        filters
      );
      
      res.json({
        success: true,
        message: 'Lấy thống kê lịch trình thành công',
        data: stats
      });
    } catch (error) {
      console.error('Schedule stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê lịch trình'
      });
    }
  }

  /**
   * Get dentist performance statistics
   */
  async getDentistStats(req, res) {
    try {
      const { startDate, endDate, dentistId, period } = req.query;
      
      const dateRange = DateUtils.parseDateRange(startDate, endDate, period || 'month');
      
      // Get multiple statistics for dentist performance
      const [appointmentStats, revenueStats, scheduleStats] = await Promise.allSettled([
        statisticService.getAppointmentStatistics(dateRange.startDate, dateRange.endDate, { dentistId }),
        statisticService.getRevenueStatistics(dateRange.startDate, dateRange.endDate),
        statisticService.getScheduleStatistics(dateRange.startDate, dateRange.endDate, { dentistId })
      ]);

      const dentistPerformance = {
        period: dateRange,
        dentistId: dentistId || 'all',
        appointments: appointmentStats.status === 'fulfilled' ? appointmentStats.value : null,
        revenue: revenueStats.status === 'fulfilled' ? revenueStats.value : null,
        schedule: scheduleStats.status === 'fulfilled' ? scheduleStats.value : null
      };
      
      res.json({
        success: true,
        message: 'Lấy thống kê hiệu suất nha sĩ thành công',
        data: dentistPerformance
      });
    } catch (error) {
      console.error('Dentist stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi lấy thống kê hiệu suất nha sĩ'
      });
    }
  }

  /**
   * Export statistics to CSV/Excel (future implementation)
   */
  async exportStats(req, res) {
    try {
      const { type, format = 'json' } = req.query;
      
      // For now, return JSON format
      // Future: implement CSV/Excel export
      
      res.json({
        success: true,
        message: 'Xuất thống kê thành công',
        data: {
          message: 'Tính năng xuất file đang được phát triển',
          availableFormats: ['json'],
          requestedFormat: format
        }
      });
    } catch (error) {
      console.error('Export stats error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi xuất thống kê'
      });
    }
  }

  /**
   * Clear statistics cache
   */
  async clearCache(req, res) {
    try {
      // Only admin can clear cache
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Chỉ admin mới có thể xóa cache'
        });
      }

      await CacheUtils.clearStatsCache();
      
      res.json({
        success: true,
        message: 'Xóa cache thống kê thành công'
      });
    } catch (error) {
      console.error('Clear cache error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Lỗi khi xóa cache'
      });
    }
  }

  /**
   * Health check for statistics service
   */
  async healthCheck(req, res) {
    try {
      const health = {
        service: 'statistic-service',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cache: {
          connected: true // TODO: check Redis connection
        }
      };
      
      res.json({
        success: true,
        data: health
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Service health check failed',
        error: error.message
      });
    }
  }
}

module.exports = new StatisticController();
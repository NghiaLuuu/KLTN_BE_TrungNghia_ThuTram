const autoScheduleService = require('../services/autoSchedule.service');
const CronJobManager = require('../utils/cronJobs');

// Simulate auto-generation with custom date (for testing)
exports.simulateAutoGeneration = async (req, res) => {
  try {
    const { simulateDate } = req.body;
    
    if (!simulateDate) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp simulateDate (định dạng: YYYY-MM-DD)'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(simulateDate)) {
      return res.status(400).json({
        success: false,
        message: 'Định dạng ngày không hợp lệ. Vui lòng dùng định dạng: YYYY-MM-DD (VD: 2025-09-30)'
      });
    }

    const testDate = new Date(simulateDate);
    if (isNaN(testDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Ngày không hợp lệ'
      });
    }

    console.log(`🧪 Simulating auto-generation for date: ${simulateDate}`);
    
    // Simulate the cron job logic with custom date
    const shouldRun = await autoScheduleService.shouldRunAutoGeneration(testDate);
    
    if (!shouldRun) {
      return res.status(200).json({
        success: true,
        message: 'Mô phỏng thành công - Không cần sinh lịch vào ngày này',
        data: {
          simulateDate,
          shouldRun: false,
          reason: 'Chưa đến thời điểm sinh lịch hoặc tính năng tự động đã tắt'
        }
      });
    }

    // 🧪 SIMULATION - Run dry-run generation (check logic but don't save)
    try {
      const simulationResult = await autoScheduleService.simulateAutoGeneration(testDate);
      
      res.status(200).json({
        success: true,
        message: `Mô phỏng sinh lịch tự động thành công cho ngày ${simulateDate}`,
        data: {
          simulateDate,
          shouldRun: true,
          simulationNote: 'Đây là mô phỏng - đã kiểm tra khả năng tạo lịch nhưng KHÔNG lưu vào database.',
          ...simulationResult
        }
      });
    } catch (simulationError) {
      res.status(200).json({
        success: true,
        message: `Mô phỏng sinh lịch tự động cho ngày ${simulateDate}`,
        data: {
          simulateDate,
          shouldRun: true,
          simulationNote: 'Mô phỏng phát hiện lỗi - sẽ không thể tạo lịch tự động.',
          error: simulationError.message,
          canGenerate: false
        }
      });
    }
  } catch (error) {
    console.error('Simulate auto-generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Mô phỏng sinh lịch tự động thất bại',
      error: error.message
    });
  }
};

// Manual trigger auto-generation for specific room
exports.triggerAutoGenerationForRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    
    if (!roomId) {
      return res.status(400).json({
        success: false,
        message: 'roomId is required'
      });
    }
    
    const results = await autoScheduleService.autoGenerateSchedulesForRoom(roomId);
    
    res.status(200).json({
      success: true,
      message: `Auto-generation completed for room ${roomId}`,
      data: {
        roomId,
        results
      }
    });
  } catch (error) {
    console.error('Auto-generation error for room:', error);
    res.status(500).json({
      success: false,
      message: 'Auto-generation failed for room',
      error: error.message
    });
  }
};

// Check quarter status for specific room
exports.checkQuarterStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { quarter, year } = req.query;
    
    if (!roomId) {
      return res.status(400).json({
        success: false,
        message: 'roomId is required'
      });
    }
    
    // Use current quarter/year if not provided
    const currentDate = new Date();
    const targetQuarter = quarter ? parseInt(quarter) : Math.ceil((currentDate.getMonth() + 1) / 3);
    const targetYear = year ? parseInt(year) : currentDate.getFullYear();
    
    const status = await autoScheduleService.checkQuarterStatus(roomId, targetQuarter, targetYear);
    
    res.status(200).json({
      success: true,
      message: 'Quarter status retrieved successfully',
      data: status
    });
  } catch (error) {
    console.error('Check quarter status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check quarter status',
      error: error.message
    });
  }
};

// Check if auto-generation should run (for monitoring)
exports.checkAutoGenerationStatus = async (req, res) => {
  try {
    const { quarter, year } = autoScheduleService.getQuarterInfo();
    const shouldRun = autoScheduleService.shouldRunAutoGeneration();
    const isEndOfMonth = autoScheduleService.isEndOfMonth();
    
    res.status(200).json({
      success: true,
      data: {
        currentQuarter: quarter,
        currentYear: year,
        shouldRunAutoGeneration: shouldRun,
        isEndOfMonth: isEndOfMonth,
        message: shouldRun ? 'Auto-generation should run now' : 'Auto-generation not needed'
      }
    });
  } catch (error) {
    console.error('Check auto-generation status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check auto-generation status',
      error: error.message
    });
  }
};

// Get cron job schedule information
exports.getCronJobInfo = async (req, res) => {
  try {
    const cronInfo = CronJobManager.getScheduleInfo();
    
    res.status(200).json({
      success: true,
      message: 'Cron job information retrieved successfully',
      data: cronInfo
    });
  } catch (error) {
    console.error('Error getting cron job info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cron job information',
      error: error.message
    });
  }
};

// Get auto-schedule configuration
exports.getConfig = async (req, res) => {
  try {
    const config = await autoScheduleService.getAutoScheduleConfig();
    
    res.status(200).json({
      success: true,
      message: 'Lấy cấu hình sinh lịch tự động thành công',
      data: config
    });
  } catch (error) {
    console.error('Error getting auto-schedule config:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể lấy cấu hình sinh lịch tự động',
      error: error.message
    });
  }
};

// Update auto-schedule configuration
exports.updateConfig = async (req, res) => {
  try {
    const { enabled } = req.body;
    const modifiedBy = req.user?.id || req.user?.name || 'unknown';
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'enabled must be a boolean value'
      });
    }
    
    const config = await autoScheduleService.updateAutoScheduleConfig(enabled, modifiedBy);
    
    res.status(200).json({
      success: true,
      message: `Auto-schedule ${enabled ? 'enabled' : 'disabled'} successfully`,
      data: config
    });
  } catch (error) {
    console.error('Error updating auto-schedule config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update auto-schedule configuration',
      error: error.message
    });
  }
};

// Toggle auto-schedule on/off (no body required - auto toggle current status)
exports.toggleAutoSchedule = async (req, res) => {
  try {
    // Debug: Check what's in req.user
    console.log('🔍 req.user:', req.user);
    
    const modifiedBy = req.user?.userId || req.user?.id || req.user?.email || req.user?.fullName || 'unknown';
    
    // Get current config to toggle the current status
    const currentConfig = await autoScheduleService.getAutoScheduleConfig();
    const newEnabledStatus = !currentConfig.enabled; // Toggle current status
    
    const config = await autoScheduleService.updateAutoScheduleConfig(newEnabledStatus, modifiedBy);
    
    res.status(200).json({
      success: true,
      message: `${newEnabledStatus ? 'Bật' : 'Tắt'} sinh lịch tự động thành công`,
      enabled: config.enabled
    });
  } catch (error) {
    console.error('Error toggling auto-schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Không thể thay đổi trạng thái sinh lịch tự động',
      error: error.message
    });
  }
};
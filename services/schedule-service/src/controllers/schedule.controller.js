const scheduleService = require('../services/schedule.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// Generate quarter schedule (all rooms)
exports.generateQuarterSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép tạo lịch' 
    });
  }
  
  try {
    const { quarter, year } = req.body;
    
    if (!quarter || !year) {
      return res.status(400).json({
        success: false,
        message: 'Quarter và year là bắt buộc'
      });
    }
    
    const result = await scheduleService.generateQuarterSchedule(quarter, year);
    
    res.status(201).json({
      success: true,
      message: `Tạo lịch quý ${quarter}/${year} thành công`,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể tạo lịch quý' 
    });
  }
};

// Get available quarters to generate
exports.getAvailableQuarters = async (req, res) => {
  try {
    const quarters = await scheduleService.getAvailableQuarters();
    
    res.json({
      success: true,
      data: quarters
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách quý' 
    });
  }
};

// Check quarters status for a specific room
exports.checkQuartersStatus = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { year } = req.query;
    
    if (!roomId) {
      return res.status(400).json({
        success: false,
        message: 'Room ID là bắt buộc'
      });
    }
    
    const currentYear = year ? parseInt(year) : new Date().getFullYear();
    const quarters = [1, 2, 3, 4];
    const quartersStatus = [];
    
    for (const quarter of quarters) {
      const analysis = await scheduleService.getQuarterAnalysisForRoom(roomId, quarter, currentYear);
      quartersStatus.push({
        quarter,
        year: currentYear,
        ...analysis
      });
    }
    
    res.json({
      success: true,
      data: {
        roomId,
        year: currentYear,
        quarters: quartersStatus,
        summary: {
          totalQuarters: quarters.length,
          quartersWithSchedules: quartersStatus.filter(q => q.hasAnySchedule).length,
          completeQuarters: quartersStatus.filter(q => q.isComplete).length,
          partialQuarters: quartersStatus.filter(q => q.isPartial).length,
          emptyQuarters: quartersStatus.filter(q => q.isEmpty).length
        }
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách quý' 
    });
  }
};

// Get schedules by room and date range
exports.getSchedulesByRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!roomId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Room ID, startDate và endDate là bắt buộc'
      });
    }
    
    const schedules = await scheduleService.getSchedulesByRoom(roomId, startDate, endDate);
    
    res.json({
      success: true,
      data: schedules
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch phòng' 
    });
  }
};

// Get schedules by date range (all rooms)
exports.getSchedulesByDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'StartDate và endDate là bắt buộc'
      });
    }
    
    const schedules = await scheduleService.getSchedulesByDateRange(startDate, endDate);
    
    res.json({
      success: true,
      data: schedules
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch' 
    });
  }
};



// Get quarter status
exports.getQuarterStatus = async (req, res) => {
  try {
    const { quarter, year } = req.query;
    
    if (!quarter || !year) {
      return res.status(400).json({
        success: false,
        message: 'Quarter và year là bắt buộc'
      });
    }
    
    const status = await scheduleService.getQuarterStatus(parseInt(quarter), parseInt(year));
    
    res.json({
      success: true,
      data: status
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy trạng thái quý' 
    });
  }
};

  // Toggle schedule active state
  exports.toggleScheduleActive = async (req, res) => {
    if (!isManagerOrAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'Chỉ quản lý hoặc admin mới được phép thay đổi trạng thái lịch' });
    }

    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ success: false, message: 'Thiếu schedule id' });

      const updated = await scheduleService.toggleStatus(id);
      return res.json({ success: true, data: updated });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message || 'Không thể cập nhật trạng thái lịch' });
    }
  };

module.exports = {
  generateQuarterSchedule: exports.generateQuarterSchedule,
  getAvailableQuarters: exports.getAvailableQuarters,
  checkQuartersStatus: exports.checkQuartersStatus,
  getSchedulesByRoom: exports.getSchedulesByRoom,
  getSchedulesByDateRange: exports.getSchedulesByDateRange,
  getQuarterStatus: exports.getQuarterStatus,
  toggleScheduleActive: exports.toggleScheduleActive
};
const cfgService = require('../services/scheduleConfig.service');

const isManagerOrAdmin = (user) => {
  if (!user) return false;
  const userRoles = user.roles || (user.role ? [user.role] : []); // Hỗ trợ cả mảng roles và role cũ
  return userRoles.includes('manager') || userRoles.includes('admin');
};

// Quản lý Cấu hình Chính
exports.getConfig = async (req, res) => {
  try {
    const configExists = await cfgService.checkConfigExists();
    if (!configExists) {
      return res.status(404).json({
        success: false,
        message: 'Chưa có Cấu hình phòng khám. Vui lòng khởi tạo cấu hình trước.',
        needInitialization: true
      });
    }

    const config = await cfgService.getConfig();
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.initializeConfig = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Chỉ manager hoặc admin mới có quyền khởi tạo cấu hình' 
    });
  }

  try {
    const configExists = await cfgService.checkConfigExists();
    if (configExists) {
      return res.status(400).json({
        success: false,
        message: 'Cấu hình đã tồn tại. Sử dụng API cập nhật để thay đổi.'
      });
    }

    const config = await cfgService.initializeConfig();
    res.status(201).json({
      success: true,
      message: 'Khởi tạo Cấu hình phòng khám thành công',
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.checkConfigExists = async (req, res) => {
  try {
    const exists = await cfgService.checkConfigExists();
    res.json({
      success: true,
      data: { exists }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.updateConfig = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Chỉ manager hoặc admin mới có quyền cập nhật cấu hình' 
    });
  }

  try {
    const updates = req.body;

    // Kiểm tra thời lượng đơn vị
    if (updates.unitDuration && (updates.unitDuration <= 0 || updates.unitDuration > 240)) {
      return res.status(400).json({
        success: false,
        message: 'Thời lượng đơn vị phải từ 1 đến 240 phút'
      });
    }

    // Ghi chú: maxGenerateScheduleMonths đã bị xóa (tạo lịch giới hạn theo quý)

    // Kiểm tra số ngày đặt lịch tối đa
    if (updates.maxBookingDays && (updates.maxBookingDays <= 0 || updates.maxBookingDays > 365)) {
      return res.status(400).json({
        success: false,
        message: 'Số ngày đặt lịch tối đa phải từ 1 đến 365'
      });
    }

    const config = await cfgService.updateConfig(updates);
    res.json({
      success: true,
      message: 'Cấu hình đã được cập nhật thành công',
      data: config
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// Quản lý Ngày nghỉ
exports.getHolidays = async (req, res) => {
  try {
    const holidays = await cfgService.getHolidays();
    res.json({
      success: true,
      data: holidays
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};



exports.addHoliday = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Chỉ manager hoặc admin mới có quyền thêm ngày nghỉ' 
    });
  }

  try {
  const { startDate, endDate, name, note } = req.body;

    if (!startDate || !endDate || !name) {
      return res.status(400).json({
        success: false,
        message: 'startDate, endDate and name are required'
      });
    }

    const sd = new Date(startDate);
    const ed = new Date(endDate);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate must be valid dates and startDate <= endDate'
      });
    }

  const holiday = await cfgService.addHoliday({ name, startDate: sd, endDate: ed, note });
    res.status(201).json({
      success: true,
      message: 'Ngày nghỉ đã được thêm thành công',
      data: holiday
    });
  } catch (error) {
    console.error('Error updating holiday:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message,
      type: error.message.includes('lịch đã được sử dụng') ? 'SLOTS_IN_USE' : 'VALIDATION_ERROR'
    });
  }
};

// 🆕 Nhiệm vụ 2.1: Bulk create holidays
exports.addHolidays = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Chỉ manager hoặc admin mới có quyền thêm ngày nghỉ' 
    });
  }

  try {
    const { holidays } = req.body;

    if (!Array.isArray(holidays) || holidays.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'holidays phải là mảng và không rỗng'
      });
    }

    const result = await cfgService.addHolidays(holidays);
    
    const statusCode = result.success > 0 ? 201 : 400;
    res.status(statusCode).json({
      success: result.success > 0,
      message: `Tạo thành công ${result.success}/${holidays.length} ngày nghỉ`,
      data: result
    });
  } catch (error) {
    console.error('Error bulk adding holidays:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message
    });
  }
};

// 🆕 Get blocked date ranges for holiday DatePicker
exports.getBlockedDateRanges = async (req, res) => {
  try {
    const blockedData = await cfgService.getBlockedDateRanges();
    
    res.json({
      success: true,
      data: blockedData
    });
  } catch (error) {
    console.error('Error getting blocked date ranges:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

exports.removeHoliday = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false, 
      message: 'Chỉ manager hoặc admin mới có quyền xóa ngày nghỉ' 
    });
  }

  try {
    const { holidayId } = req.params;

    if (!holidayId) {
      return res.status(400).json({
        success: false,
        message: 'Holiday ID is required'
      });
    }

    await cfgService.removeHoliday(holidayId);
    res.json({
      success: true,
      message: 'Ngày nghỉ đã được xóa thành công'
    });
  } catch (error) {
    console.error('Error removing holiday:', error);
    res.status(400).json({
      success: false,
      message: error.message,
      type: error.message.includes('đã được sử dụng') ? 'HOLIDAY_IN_USE' : 'VALIDATION_ERROR'
    });
  }
};

// Cập nhật một ngày nghỉ theo id (cập nhật một phần)
exports.updateHoliday = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Chỉ manager hoặc admin mới có quyền cập nhật ngày nghỉ'
    });
  }

  try {
    const { holidayId } = req.params;
    const updates = req.body || {};

    if (!holidayId) {
      return res.status(400).json({ success: false, message: 'Yêu cầu ID ngày nghỉ' });
    }

    // Kiểm tra các cập nhật ngày tháng có thể
    if (updates.startDate && updates.endDate) {
      const sd = new Date(updates.startDate);
      const ed = new Date(updates.endDate);
      if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || ed < sd) {
        return res.status(400).json({ success: false, message: 'startDate and endDate must be valid and startDate <= endDate' });
      }
      updates.startDate = sd;
      updates.endDate = ed;
    }

    const updated = await cfgService.updateHolidayById(holidayId, updates);
    res.json({ success: true, message: 'Cập nhật kỳ nghỉ thành công', data: updated });
  } catch (error) {
    console.error('Error updating holiday:', error);
    res.status(400).json({ 
      success: false, 
      message: error.message,
      type: error.message.includes('lịch đã được sử dụng') ? 'SLOTS_IN_USE' : 'VALIDATION_ERROR'
    });
  }
};
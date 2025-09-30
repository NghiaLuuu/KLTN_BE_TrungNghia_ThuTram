const slotService = require('../services/slot.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// Assign staff to slots
exports.assignStaffToSlots = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép phân công nhân sự' 
    });
  }
  
  try {
    const {
      roomId,
      subRoomId,
      quarter,
      year,
      shifts,
      dentistIds,
      nurseIds
    } = req.body;

    // Enforce quarter-level assignment (phải phân công theo quý)
    if (!quarter || !year) {
      return res.status(400).json({ success: false, message: 'Yêu cầu phải gửi quarter và year để phân công theo quý' });
    }

    // Validate dentist and nurse IDs from Redis cache
    const { validateStaffIds } = require('../services/slot.service');
    await validateStaffIds(dentistIds || [], nurseIds || []);

    const result = await slotService.assignStaffToSlots({
      roomId,
      subRoomId,
      quarter: parseInt(quarter, 10),
      year: parseInt(year, 10),
      shifts,
      dentistIds,
      nurseIds
    });
    
    res.status(200).json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể phân công nhân sự' 
    });
  }
};

// Reassign staff to slots that already have staff assigned
exports.reassignStaffToSlots = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép phân công lại nhân sự' 
    });
  }
  
  try {
    const {
      roomId,
      subRoomId,
      quarter,
      year,
      shifts,
      dentistIds,
      nurseIds
    } = req.body;

    // Enforce quarter-level assignment (phải phân công theo quý)
    if (!quarter || !year) {
      return res.status(400).json({ success: false, message: 'Yêu cầu phải gửi quarter và year để phân công lại theo quý' });
    }

    // Validate dentist and nurse IDs from Redis cache
    const { validateStaffIds } = require('../services/slot.service');
    await validateStaffIds(dentistIds || [], nurseIds || []);

    const result = await slotService.reassignStaffToSlots({
      roomId,
      subRoomId,
      quarter: parseInt(quarter, 10),
      year: parseInt(year, 10),
      shifts,
      dentistIds,
      nurseIds
    });
    
    res.status(200).json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể phân công lại nhân sự' 
    });
  }
};

// Update staff for single or multiple slots
exports.updateSlotStaff = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép cập nhật nhân sự' 
    });
  }
  
  try {
    const { slotIds, dentistId, nurseId } = req.body;

    // Support both single slot (backward compatibility) and multiple slots
    if (!slotIds || (!Array.isArray(slotIds) && typeof slotIds !== 'string') || 
        (Array.isArray(slotIds) && slotIds.length === 0)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phải cung cấp slotIds (string cho 1 slot hoặc array cho nhiều slot)' 
      });
    }

    // Must provide at least one of dentistId or nurseId
    if (!dentistId && !nurseId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Phải cung cấp dentistId hoặc nurseId để cập nhật' 
      });
    }

    // Validate dentist and nurse IDs from Redis cache
    const { validateStaffIds } = require('../services/slot.service');
    const dentistIds = dentistId ? [dentistId] : [];
    const nurseIds = nurseId ? [nurseId] : [];
    await validateStaffIds(dentistIds, nurseIds);

    // Convert single slotId to array for unified processing
    const slotIdArray = Array.isArray(slotIds) ? slotIds : [slotIds];

    const updatedSlots = await slotService.updateSlotStaff({ 
      slotIds: slotIdArray, 
      dentistId, 
      nurseId 
    });
    
    res.json({
      success: true,
      message: `Cập nhật nhân sự cho ${updatedSlots.length} slot thành công`,
      data: updatedSlots
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể cập nhật nhân sự slot' 
    });
  }
};

// Get slots by shift and date for easy slot selection
exports.getSlotsByShiftAndDate = async (req, res) => {
  try {
    const { roomId, subRoomId, date, shiftName } = req.query;
    
    if (!roomId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'roomId, date và shiftName là bắt buộc'
      });
    }
    
    const slots = await slotService.getSlotsByShiftAndDate({
      roomId,
      subRoomId,
      date,
      shiftName
    });
    
    res.json({
      success: true,
      data: slots
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách slot theo ca' 
    });
  }
};

// Get room calendar with appointment counts (daily/weekly/monthly view)
exports.getRoomCalendar = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { subRoomId, viewType, startDate, page = 1, limit = 10 } = req.query;
    
    if (!roomId || !viewType) {
      return res.status(400).json({
        success: false,
        message: 'roomId và viewType (day|week|month) là bắt buộc'
      });
    }

    if (!['day', 'week', 'month'].includes(viewType)) {
      return res.status(400).json({
        success: false,
        message: 'viewType phải là: day, week hoặc month'
      });
    }

    // Validate pagination parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    
    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'page phải >= 1 và limit phải từ 1-100'
      });
    }
    
    const calendar = await slotService.getRoomCalendar({
      roomId,
      subRoomId,
      viewType,
      startDate,
      page: pageNum,
      limit: limitNum
    });
    
    res.json({
      success: true,
      data: calendar
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch phòng' 
    });
  }
};
module.exports = {
  assignStaffToSlots: exports.assignStaffToSlots,
  updateSlotStaff: exports.updateSlotStaff,
  getSlotsByShiftAndDate: exports.getSlotsByShiftAndDate,
  getRoomCalendar: exports.getRoomCalendar
};
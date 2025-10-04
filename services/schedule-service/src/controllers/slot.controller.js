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

    // Validate pagination parameters - allow negative pages for historical data
    const pageNum = parseInt(page, 10);
    let limitNum = parseInt(limit, 10);
    
    // ⭐ Enforce limit=1 for week and month views
    if (viewType === 'week' || viewType === 'month') {
      limitNum = 1;
    } else if (limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'limit phải từ 1-100'
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

// Get dentist calendar with appointment counts (daily/weekly/monthly view) with historical support
exports.getDentistCalendar = async (req, res) => {
  try {
    const { dentistId } = req.params;
    const { viewType, startDate, page = 1, limit = 10 } = req.query;
    
    if (!dentistId || !viewType) {
      return res.status(400).json({
        success: false,
        message: 'dentistId và viewType (day|week|month) là bắt buộc'
      });
    }

    if (!['day', 'week', 'month'].includes(viewType)) {
      return res.status(400).json({
        success: false,
        message: 'viewType phải là: day, week hoặc month'
      });
    }

    // Validate pagination parameters - allow negative pages for historical data
    const pageNum = parseInt(page, 10);
    let limitNum = parseInt(limit, 10);
    
    // ⭐ Enforce limit=1 for week and month views
    if (viewType === 'week' || viewType === 'month') {
      limitNum = 1;
    } else if (limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'limit phải từ 1-100'
      });
    }
    
    const calendar = await slotService.getDentistCalendar({
      dentistId,
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
      message: error.message || 'Không thể lấy lịch nha sỹ' 
    });
  }
};

// Get nurse calendar with appointment counts (daily/weekly/monthly view) with historical support
exports.getNurseCalendar = async (req, res) => {
  try {
    const { nurseId } = req.params;
    const { viewType, startDate, page = 1, limit = 10 } = req.query;
    
    if (!nurseId || !viewType) {
      return res.status(400).json({
        success: false,
        message: 'nurseId và viewType (day|week|month) là bắt buộc'
      });
    }

    if (!['day', 'week', 'month'].includes(viewType)) {
      return res.status(400).json({
        success: false,
        message: 'viewType phải là: day, week hoặc month'
      });
    }

    // Validate pagination parameters - allow negative pages for historical data
    const pageNum = parseInt(page, 10);
    let limitNum = parseInt(limit, 10);
    
    // ⭐ Enforce limit=1 for week and month views
    if (viewType === 'week' || viewType === 'month') {
      limitNum = 1;
    } else if (limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        message: 'limit phải từ 1-100'
      });
    }
    
    const calendar = await slotService.getNurseCalendar({
      nurseId,
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
      message: error.message || 'Không thể lấy lịch y tá' 
    });
  }
};

// Get available quarters and years for staff assignment
exports.getAvailableQuartersYears = async (req, res) => {
  try {
    const result = await slotService.getAvailableQuartersYears();
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách quý/năm' 
    });
  }
};

// Get available work shifts
exports.getAvailableShifts = async (req, res) => {
  try {
    const shifts = await slotService.getAvailableShifts();
    
    res.json({
      success: true,
      data: shifts
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách ca làm việc' 
    });
  }
};

// ⭐ NEW: Get slot details for a specific room/day/shift
exports.getRoomSlotDetails = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { subRoomId, date, shiftName } = req.query;
    
    if (!roomId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'roomId, date và shiftName là bắt buộc'
      });
    }

    const slots = await slotService.getRoomSlotDetails({
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
    res.status(400).json({ 
      success: false,
      message: error.message || 'Không thể lấy chi tiết slot phòng' 
    });
  }
};

// ⭐ NEW: Get slot details for a specific dentist/day/shift
exports.getDentistSlotDetails = async (req, res) => {
  try {
    const { dentistId } = req.params;
    const { date, shiftName } = req.query;
    
    if (!dentistId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'dentistId, date và shiftName là bắt buộc'
      });
    }

    const slots = await slotService.getDentistSlotDetails({
      dentistId,
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
      message: error.message || 'Không thể lấy chi tiết slot nha sỹ' 
    });
  }
};

// ⭐ NEW: Get slot details for a specific nurse/day/shift
exports.getNurseSlotDetails = async (req, res) => {
  try {
    const { nurseId } = req.params;
    const { date, shiftName } = req.query;
    
    if (!nurseId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'nurseId, date và shiftName là bắt buộc'
      });
    }

    const slots = await slotService.getNurseSlotDetails({
      nurseId,
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
      message: error.message || 'Không thể lấy chi tiết slot y tá' 
    });
  }
};

module.exports = {
  assignStaffToSlots: exports.assignStaffToSlots,
  reassignStaffToSlots: exports.reassignStaffToSlots,
  updateSlotStaff: exports.updateSlotStaff,
  getSlotsByShiftAndDate: exports.getSlotsByShiftAndDate,
  getRoomCalendar: exports.getRoomCalendar,
  getDentistCalendar: exports.getDentistCalendar,
  getNurseCalendar: exports.getNurseCalendar,
  getAvailableQuartersYears: exports.getAvailableQuartersYears,
  getAvailableShifts: exports.getAvailableShifts,
  getRoomSlotDetails: exports.getRoomSlotDetails,
  getDentistSlotDetails: exports.getDentistSlotDetails,
  getNurseSlotDetails: exports.getNurseSlotDetails
};
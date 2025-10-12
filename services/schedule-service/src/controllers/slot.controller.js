const slotService = require('../services/slot.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// Assign staff to slots
exports.assignStaffToSlots = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép phân công nhân sú' 
    });
  }
  
  try {
    const {
      roomId,
      subRoomId,
      quarter,
      year,
      shifts,
      slotIds, // 🆕 Array of specific slot IDs to assign
      dentistIds,
      nurseIds
    } = req.body;

    // 🆕 Support two modes:
    // Mode 1: Assign by selected slot IDs (new logic)
    // Mode 2: Assign by quarter/year + shifts (legacy logic)
    
    if (slotIds && Array.isArray(slotIds) && slotIds.length > 0) {
      // 🆕 NEW MODE: Assign to specific slots
      console.log('📋 Assign mode: Specific slots', { slotIds, dentistIds, nurseIds });
      
      // Validate dentist and nurse IDs from Redis cache
      const { validateStaffIds } = require('../services/slot.service');
      await validateStaffIds(dentistIds || [], nurseIds || []);

      const result = await slotService.assignStaffToSpecificSlots({
        slotIds,
        dentistIds,
        nurseIds,
        roomId, // Optional: for validation
        subRoomId // Optional: for validation
      });
      
      return res.status(200).json({
        success: true,
        data: result
      });
    } else {
      // 🔄 LEGACY MODE: Assign by quarter/year
      if (!quarter || !year) {
        return res.status(400).json({ 
          success: false, 
          message: 'Yêu cầu phải gửi slotIds (chọn slot cụ thể) hoặc quarter + year (phân công theo quý)' 
        });
      }

      console.log('📅 Assign mode: Quarter-based', { quarter, year, shifts });

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
      
      return res.status(200).json({
        success: true,
        data: result
      });
    }
    
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
      slotIds, // 🆕 Array of specific slot IDs to reassign
      oldStaffId, // 🆕 Old staff to replace
      newStaffId, // 🆕 New staff to assign
      role, // 🆕 'dentist' or 'nurse'
      dentistIds,
      nurseIds
    } = req.body;

    // 🆕 Support two modes:
    // Mode 1: Reassign by selected slot IDs (new logic for replacement)
    // Mode 2: Reassign by quarter/year + shifts (legacy logic)
    
    if (slotIds && Array.isArray(slotIds) && slotIds.length > 0) {
      // 🆕 NEW MODE: Reassign specific slots
      console.log('📋 Reassign mode: Specific slots', { slotIds, oldStaffId, newStaffId, role });
      
      if (!oldStaffId || !newStaffId || !role) {
        return res.status(400).json({
          success: false,
          message: 'Yêu cầu phải gửi oldStaffId, newStaffId và role (dentist/nurse) khi thay thế theo slot'
        });
      }

      if (!['dentist', 'nurse', 'doctor'].includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'role phải là "dentist" hoặc "nurse"'
        });
      }

      // Validate staff IDs from Redis cache
      const { validateStaffIds } = require('../services/slot.service');
      const staffRole = role === 'doctor' ? 'dentist' : role;
      if (staffRole === 'dentist') {
        await validateStaffIds([oldStaffId, newStaffId], []);
      } else {
        await validateStaffIds([], [oldStaffId, newStaffId]);
      }

      const result = await slotService.reassignStaffToSpecificSlots({
        slotIds,
        oldStaffId,
        newStaffId,
        role: staffRole
      });
      
      return res.status(200).json({
        success: true,
        data: result
      });
    } else {
      // 🔄 LEGACY MODE: Reassign by quarter/year
      if (!quarter || !year) {
        return res.status(400).json({ 
          success: false, 
          message: 'Yêu cầu phải gửi slotIds (thay thế slot cụ thể) hoặc quarter + year (phân công lại theo quý)' 
        });
      }

      console.log('📅 Reassign mode: Quarter-based', { quarter, year, shifts });

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
      
      return res.status(200).json({
        success: true,
        data: result
      });
    }
    
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
    const { subRoomId, viewType, startDate, page = 0, limit = 10, futureOnly } = req.query;
    
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
    
    // Parse futureOnly as boolean (default to false for backward compatibility)
    const futureOnlyBool = futureOnly === 'true' || futureOnly === '1';
    
    const calendar = await slotService.getRoomCalendar({
      roomId,
      subRoomId,
      viewType,
      startDate,
      page: pageNum,
      limit: limitNum,
      futureOnly: futureOnlyBool
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
    const { viewType, startDate, page = 0, limit = 10, futureOnly } = req.query;
    
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
    
    // Parse futureOnly as boolean
    const futureOnlyBool = futureOnly === 'true' || futureOnly === '1';
    
    const calendar = await slotService.getDentistCalendar({
      dentistId,
      viewType,
      startDate,
      page: pageNum,
      limit: limitNum,
      futureOnly: futureOnlyBool
    });
    
    res.json({
      success: true,
      data: calendar
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch nha sĩ' 
    });
  }
};

// Get nurse calendar with appointment counts (daily/weekly/monthly view) with historical support
exports.getNurseCalendar = async (req, res) => {
  try {
    const { nurseId } = req.params;
    const { viewType, startDate, page = 0, limit = 10, futureOnly } = req.query;
    
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
    
    // Parse futureOnly as boolean
    const futureOnlyBool = futureOnly === 'true' || futureOnly === '1';
    
    const calendar = await slotService.getNurseCalendar({
      nurseId,
      viewType,
      startDate,
      page: pageNum,
      limit: limitNum,
      futureOnly: futureOnlyBool
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

// 🆕 Check if staff members have future schedules
exports.checkStaffHasSchedule = async (req, res) => {
  try {
    const { staffIds, role } = req.body; // staffIds: array of user IDs, role: 'dentist' or 'nurse'
    
    if (!staffIds || !Array.isArray(staffIds) || staffIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'staffIds array is required'
      });
    }

    if (!role || !['dentist', 'nurse'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'role must be "dentist" or "nurse"'
      });
    }

    const result = await slotService.checkStaffHasSchedule(staffIds, role);
    
    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error checking staff schedules:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

// ⭐ NEW: Get FUTURE room slot details (for staff assignment)
exports.getRoomSlotDetailsFuture = async (req, res) => {
  console.log('🎯 CONTROLLER CALLED - getRoomSlotDetailsFuture (FUTURE ONLY)');
  
  try {
    const { roomId } = req.params;
    const { subRoomId, date, shiftName } = req.query;
    
    console.log('📥 Request params:', { roomId, subRoomId, date, shiftName });
    
    if (!roomId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'roomId, date và shiftName là bắt buộc'
      });
    }

    const result = await slotService.getRoomSlotDetailsFuture({
      roomId,
      subRoomId,
      date,
      shiftName
    });
    
    console.log('✅ Found', result.data.totalSlots, 'future slots');
    
    res.json(result);
    
  } catch (error) {
    console.error('❌ Controller error:', error.message);
    res.status(400).json({ 
      success: false,
      message: error.message || 'Không thể lấy slot tương lai của phòng' 
    });
  }
};

// ⭐ NEW: Get FUTURE dentist slot details (for staff replacement)
exports.getDentistSlotDetailsFuture = async (req, res) => {
  console.log('🎯 CONTROLLER CALLED - getDentistSlotDetailsFuture (FUTURE ONLY)');
  
  try {
    const { dentistId } = req.params;
    const { date, shiftName } = req.query;
    
    if (!dentistId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'dentistId, date và shiftName là bắt buộc'
      });
    }

    const result = await slotService.getDentistSlotDetailsFuture({
      dentistId,
      date,
      shiftName
    });
    
    console.log('✅ Found', result.data.totalSlots, 'future slots for dentist');
    
    res.json(result);
    
  } catch (error) {
    res.status(400).json({ 
      success: false,
      message: error.message || 'Không thể lấy slot tương lai của nha sĩ' 
    });
  }
};

// ⭐ NEW: Get FUTURE nurse slot details (for staff replacement)
exports.getNurseSlotDetailsFuture = async (req, res) => {
  console.log('🎯 CONTROLLER CALLED - getNurseSlotDetailsFuture (FUTURE ONLY)');
  
  try {
    const { nurseId } = req.params;
    const { date, shiftName } = req.query;
    
    if (!nurseId || !date || !shiftName) {
      return res.status(400).json({
        success: false,
        message: 'nurseId, date và shiftName là bắt buộc'
      });
    }

    const result = await slotService.getNurseSlotDetailsFuture({
      nurseId,
      date,
      shiftName
    });
    
    console.log('✅ Found', result.data.totalSlots, 'future slots for nurse');
    
    res.json(result);
    
  } catch (error) {
    res.status(400).json({ 
      success: false,
      message: error.message || 'Không thể lấy slot tương lai của y tá' 
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
  getNurseSlotDetails: exports.getNurseSlotDetails,
  getRoomSlotDetailsFuture: exports.getRoomSlotDetailsFuture,      // ⭐ NEW
  getDentistSlotDetailsFuture: exports.getDentistSlotDetailsFuture,  // ⭐ NEW
  getNurseSlotDetailsFuture: exports.getNurseSlotDetailsFuture,    // ⭐ NEW
  checkStaffHasSchedule: exports.checkStaffHasSchedule
};
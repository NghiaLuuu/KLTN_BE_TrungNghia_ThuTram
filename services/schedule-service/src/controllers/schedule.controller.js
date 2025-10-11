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

// 🆕 Generate schedule for specific room with shift selection (UPDATED: MONTHLY)
exports.generateRoomSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép tạo lịch' 
    });
  }
  
  try {
    const { 
      roomId, 
      subRoomId,
      fromMonth, // 1-12 (tháng bắt đầu)
      toMonth,   // 1-12 (tháng kết thúc)
      year, 
      startDate,
      shifts // Array: ['morning', 'afternoon', 'evening'] - ca nào được chọn để tạo
    } = req.body;
    
    // Validation
    if (!roomId || !fromMonth || !toMonth || !year || !startDate || !shifts || !Array.isArray(shifts)) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin: roomId, fromMonth, toMonth, year, startDate, và shifts là bắt buộc'
      });
    }
    
    if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12) {
      return res.status(400).json({
        success: false,
        message: 'Tháng phải từ 1-12'
      });
    }
    
    if (toMonth < fromMonth) {
      return res.status(400).json({
        success: false,
        message: 'Tháng kết thúc phải >= Tháng bắt đầu'
      });
    }
    
    if (shifts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Phải chọn ít nhất 1 ca để tạo lịch'
      });
    }
    
    const validShifts = ['morning', 'afternoon', 'evening'];
    const invalidShifts = shifts.filter(s => !validShifts.includes(s));
    if (invalidShifts.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Ca không hợp lệ: ${invalidShifts.join(', ')}. Chỉ chấp nhận: morning, afternoon, evening`
      });
    }
    
    const result = await scheduleService.generateRoomSchedule({
      roomId,
      subRoomId,
      fromMonth,
      toMonth,
      year,
      startDate,
      shifts,
      createdBy: req.user?._id || req.user?.id
    });
    
    res.status(201).json({
      success: true,
      message: result.message || 'Tạo lịch thành công',
      data: result
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể tạo lịch' 
    });
  }
};

// 🆕 Get holiday preview for schedule creation
exports.getHolidayPreview = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate và endDate là bắt buộc'
      });
    }
    
    const preview = await scheduleService.getHolidayPreview(
      new Date(startDate),
      new Date(endDate)
    );
    
    res.json({
      success: true,
      data: preview
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy thông tin ngày nghỉ'
    });
  }
};

// 🆕 Get room schedules with shift info (for create schedule UI)
exports.getRoomSchedulesWithShifts = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { subRoomId } = req.query;
    
    if (!roomId) {
      return res.status(400).json({
        success: false,
        message: 'Room ID là bắt buộc'
      });
    }
    
    const schedules = await scheduleService.getRoomSchedulesWithShifts(roomId, subRoomId);
    
    res.json({
      success: true,
      data: schedules
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy thông tin lịch'
    });
  }
};

// 🆕 Get schedule summary by room (for staff assignment page)
exports.getScheduleSummaryByRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { quarter, year } = req.query;
    
    if (!roomId) {
      return res.status(400).json({
        success: false,
        message: 'Room ID là bắt buộc'
      });
    }
    
    const summary = await scheduleService.getScheduleSummaryByRoom(roomId, quarter, year);
    
    res.json({
      success: true,
      data: summary
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy thông tin lịch' 
    });
  }
};

// 🆕 Get rooms with schedule summary (for staff assignment room list)
exports.getRoomsWithScheduleSummary = async (req, res) => {
  try {
    const { quarter, year, isActive } = req.query;
    
    const rooms = await scheduleService.getRoomsWithScheduleSummary({ quarter, year, isActive });
    
    res.json({
      success: true,
      data: rooms
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách phòng' 
    });
  }
};

// 🆕 Get slots by shift for assignment (monthly calendar view)
exports.getSlotsByShiftCalendar = async (req, res) => {
  try {
    const { roomId, subRoomId, shiftName, month, year } = req.query;
    
    if (!roomId || !shiftName || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'roomId, shiftName, month, và year là bắt buộc'
      });
    }
    
    const calendar = await scheduleService.getSlotsByShiftCalendar({
      roomId,
      subRoomId,
      shiftName,
      month: parseInt(month),
      year: parseInt(year)
    });
    
    res.json({
      success: true,
      data: calendar
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch theo ca' 
    });
  }
};

// 🆕 Get rooms for staff assignment (with shift summary)
exports.getRoomsForStaffAssignment = async (req, res) => {
  try {
    const { fromMonth, toMonth, year, isActive } = req.query;
    
    if (!fromMonth || !toMonth || !year) {
      return res.status(400).json({
        success: false,
        message: 'fromMonth, toMonth và year là bắt buộc'
      });
    }
    
    const rooms = await scheduleService.getRoomsForStaffAssignment({
      fromMonth: parseInt(fromMonth),
      toMonth: parseInt(toMonth),
      year: parseInt(year),
      isActive: isActive !== undefined ? isActive === 'true' : undefined
    });
    
    res.json({
      success: true,
      data: rooms
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách phòng' 
    });
  }
};

// 🆕 Get shift calendar for assignment (click vào ca)
exports.getShiftCalendarForAssignment = async (req, res) => {
  try {
    const { roomId, subRoomId, shiftName, month, year } = req.query;
    
    if (!roomId || !shiftName || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'roomId, shiftName, month, và year là bắt buộc'
      });
    }
    
    const calendar = await scheduleService.getShiftCalendarForAssignment({
      roomId,
      subRoomId,
      shiftName,
      month: parseInt(month),
      year: parseInt(year)
    });
    
    res.json({
      success: true,
      data: calendar
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch ca' 
    });
  }
};

// 🆕 Get slots for a specific day (click vào ngày)
exports.getSlotsByDayAndShift = async (req, res) => {
  try {
    const { roomId, subRoomId, shiftName, date } = req.query;
    
    if (!roomId || !shiftName || !date) {
      return res.status(400).json({
        success: false,
        message: 'roomId, shiftName, và date là bắt buộc'
      });
    }
    
    const slots = await scheduleService.getSlotsByDayAndShift({
      roomId,
      subRoomId,
      shiftName,
      date
    });
    
    res.json({
      success: true,
      data: slots
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy danh sách slot' 
    });
  }
};

// 🆕 Assign staff to slot (manager/admin only)
exports.assignStaffToSlot = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép phân công nhân sự' 
    });
  }
  
  try {
    const { slotId } = req.params;
    const { dentistId, nurseId } = req.body;
    
    if (!slotId) {
      return res.status(400).json({
        success: false,
        message: 'slotId là bắt buộc'
      });
    }
    
    const result = await scheduleService.assignStaffToSlot({
      slotId,
      dentistId,
      nurseId,
      updatedBy: req.user?._id || req.user?.id
    });
    
    res.json({
      success: true,
      message: 'Phân công nhân sự thành công',
      data: result
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể phân công nhân sự' 
    });
  }
};

// 🆕 Bulk assign staff to multiple slots
exports.bulkAssignStaff = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép phân công nhân sự' 
    });
  }
  
  try {
    const { slotIds, dentistId, nurseId } = req.body;
    
    if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'slotIds là bắt buộc và phải là mảng không rỗng'
      });
    }
    
    const results = await scheduleService.bulkAssignStaff({
      slotIds,
      dentistId,
      nurseId,
      updatedBy: req.user?._id || req.user?.id
    });
    
    res.json({
      success: true,
      message: `Phân công thành công ${results.success.length}/${slotIds.length} slots`,
      data: results
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể phân công nhân sự hàng loạt' 
    });
  }
};

// 🆕 CONTROLLER 1: Get Room Schedule Shifts
exports.getRoomScheduleShifts = async (req, res) => {
  try {
    const { roomId, subRoomId, month, year } = req.query;
    
    if (!roomId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'roomId, month và year là bắt buộc'
      });
    }
    
    const result = await scheduleService.getRoomScheduleShifts({
      roomId,
      subRoomId: subRoomId || null,
      month: parseInt(month),
      year: parseInt(year)
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy danh sách ca'
    });
  }
};

// 🆕 CONTROLLER 2: Get Staff Availability with Conflicts
exports.getStaffAvailabilityForShift = async (req, res) => {
  try {
    const { roomId, subRoomId, shiftName, month, year } = req.query;
    
    if (!roomId || !shiftName || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'roomId, shiftName, month và year là bắt buộc'
      });
    }
    
    const result = await scheduleService.getStaffAvailabilityForShift({
      roomId,
      subRoomId: subRoomId || null,
      shiftName,
      month: parseInt(month),
      year: parseInt(year)
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy danh sách nhân sự'
    });
  }
};

// 🆕 CONTROLLER 3: Get Staff Schedule
exports.getStaffSchedule = async (req, res) => {
  try {
    const { staffId, fromDate, toDate } = req.query;
    
    if (!staffId || !fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        message: 'staffId, fromDate và toDate là bắt buộc'
      });
    }
    
    console.log('🔍 scheduleService type:', typeof scheduleService);
    console.log('🔍 scheduleService.getStaffSchedule type:', typeof scheduleService.getStaffSchedule);
    console.log('🔍 scheduleService keys:', Object.keys(scheduleService).slice(0, 10));
    
    const result = await scheduleService.getStaffSchedule({
      staffId,
      fromDate,
      toDate
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('❌ Error in getStaffSchedule controller:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy lịch làm việc'
    });
  }
};

// 🆕 CONTROLLER 4: Get Available Replacement Staff
exports.getAvailableReplacementStaff = async (req, res) => {
  try {
    const { originalStaffId, role, slots, fromDate } = req.body;
    
    if (!originalStaffId || !role) {
      return res.status(400).json({
        success: false,
        message: 'originalStaffId và role là bắt buộc'
      });
    }
    
    const result = await scheduleService.getAvailableReplacementStaff({
      originalStaffId,
      role,
      slots: slots || [],
      fromDate: fromDate || null
    });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy danh sách nhân sự thay thế'
    });
  }
};

// 🆕 CONTROLLER 5: Replace Staff
exports.replaceStaff = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép thay thế nhân sự' 
    });
  }
  
  try {
    const { originalStaffId, replacementStaffId, slots, fromDate, replaceAll } = req.body;
    
    if (!originalStaffId || !replacementStaffId) {
      return res.status(400).json({
        success: false,
        message: 'originalStaffId và replacementStaffId là bắt buộc'
      });
    }
    
    if (!replaceAll && (!slots || slots.length === 0)) {
      return res.status(400).json({
        success: false,
        message: 'Phải chọn ít nhất 1 slot hoặc chọn replaceAll'
      });
    }
    
    if (replaceAll && !fromDate) {
      return res.status(400).json({
        success: false,
        message: 'fromDate là bắt buộc khi replaceAll = true'
      });
    }
    
    const result = await scheduleService.replaceStaff({
      originalStaffId,
      replacementStaffId,
      slots: slots || [],
      fromDate: fromDate || null,
      replaceAll: replaceAll || false
    });
    
    res.json({
      success: true,
      message: result.message,
      data: result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể thay thế nhân sự'
    });
  }
};

module.exports = {
  generateQuarterSchedule: exports.generateQuarterSchedule,
  getAvailableQuarters: exports.getAvailableQuarters,
  checkQuartersStatus: exports.checkQuartersStatus,
  getSchedulesByRoom: exports.getSchedulesByRoom,
  getSchedulesByDateRange: exports.getSchedulesByDateRange,
  getQuarterStatus: exports.getQuarterStatus,
  toggleScheduleActive: exports.toggleScheduleActive,
  generateRoomSchedule: exports.generateRoomSchedule,
  getHolidayPreview: exports.getHolidayPreview, // 🆕 
  getRoomSchedulesWithShifts: exports.getRoomSchedulesWithShifts,
  getScheduleSummaryByRoom: exports.getScheduleSummaryByRoom,
  getRoomsWithScheduleSummary: exports.getRoomsWithScheduleSummary,
  getSlotsByShiftCalendar: exports.getSlotsByShiftCalendar,
  getRoomsForStaffAssignment: exports.getRoomsForStaffAssignment,
  getShiftCalendarForAssignment: exports.getShiftCalendarForAssignment,
  getSlotsByDayAndShift: exports.getSlotsByDayAndShift,
  assignStaffToSlot: exports.assignStaffToSlot,
  bulkAssignStaff: exports.bulkAssignStaff,
  // 🆕 New APIs
  getRoomScheduleShifts: exports.getRoomScheduleShifts,
  getStaffAvailabilityForShift: exports.getStaffAvailabilityForShift,
  getStaffSchedule: exports.getStaffSchedule,
  getAvailableReplacementStaff: exports.getAvailableReplacementStaff,
  replaceStaff: exports.replaceStaff
};
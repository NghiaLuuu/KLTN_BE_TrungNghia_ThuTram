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
      selectedSubRoomIds, // 🆕 Array subRoomIds được chọn để tạo lịch (nếu null = all active)
      fromMonth, // 1-12 (tháng bắt đầu)
      toMonth,   // 1-12 (tháng kết thúc)
      fromYear,  // Năm bắt đầu (mới)
      toYear,    // Năm kết thúc (mới)
      year,      // Deprecated - giữ để backward compatible
      startDate,
      partialStartDate, // 🆕 Ngày bắt đầu tạo lịch (cho tạo thiếu ca/subroom)
      shifts // Array: ['morning', 'afternoon', 'evening'] - ca nào được chọn để tạo
    } = req.body;
    
    // 🆕 Backward compatibility: Nếu không có fromYear/toYear, dùng year
    const effectiveFromYear = fromYear || year;
    const effectiveToYear = toYear || year;
    
    // Validation
    if (!roomId || !fromMonth || !toMonth || !effectiveFromYear || !effectiveToYear || !startDate || !shifts || !Array.isArray(shifts)) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin: roomId, fromMonth, toMonth, fromYear/toYear (hoặc year), startDate, và shifts là bắt buộc'
      });
    }
    
    if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12) {
      return res.status(400).json({
        success: false,
        message: 'Tháng phải từ 1-12'
      });
    }
    
    // 🆕 Validation cho nhiều năm
    if (effectiveToYear < effectiveFromYear) {
      return res.status(400).json({
        success: false,
        message: 'Năm kết thúc phải >= Năm bắt đầu'
      });
    }
    
    if (effectiveToYear === effectiveFromYear && toMonth < fromMonth) {
      return res.status(400).json({
        success: false,
        message: 'Nếu cùng năm, tháng kết thúc phải >= Tháng bắt đầu'
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
    
    // 🆕 Validation cho selectedSubRoomIds
    if (selectedSubRoomIds && !Array.isArray(selectedSubRoomIds)) {
      return res.status(400).json({
        success: false,
        message: 'selectedSubRoomIds phải là mảng'
      });
    }
    
    if (selectedSubRoomIds && selectedSubRoomIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Phải chọn ít nhất 1 buồng để tạo lịch'
      });
    }
    
    // 🆕 Validation cho partialStartDate
    if (partialStartDate) {
      const partialDate = new Date(partialStartDate);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      if (partialDate < tomorrow) {
        return res.status(400).json({
          success: false,
          message: 'Ngày bắt đầu tạo lịch phải sau ngày hiện tại ít nhất 1 ngày'
        });
      }
      
      // Validation: partialStartDate phải <= endDate của schedule
      // (sẽ được check thêm trong service)
    }
    
    const result = await scheduleService.generateRoomSchedule({
      roomId,
      subRoomId,
      selectedSubRoomIds, // 🆕
      fromMonth,
      toMonth,
      fromYear: effectiveFromYear,
      toYear: effectiveToYear,
      year, // Giữ để backward compatible
      startDate,
      partialStartDate, // 🆕
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

// 🆕 Update schedule (reactive scheduling - toggle isActive, reactivate shifts/subrooms)
exports.updateSchedule = async (req, res) => {
  // Chỉ admin mới được phép edit schedule
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Chỉ admin mới được phép chỉnh sửa lịch'
    });
  }

  try {
    const { scheduleId } = req.params;
    const { isActive, reactivateShifts, deactivateShifts, reactivateSubRooms, toggleSubRoom, dateRange } = req.body; // 🔧 FIXED: Added toggleSubRoom and dateRange

    if (!scheduleId) {
      return res.status(400).json({
        success: false,
        message: 'Schedule ID là bắt buộc'
      });
    }

    // Validate reactivateShifts (nếu có)
    if (reactivateShifts && !Array.isArray(reactivateShifts)) {
      return res.status(400).json({
        success: false,
        message: 'reactivateShifts phải là mảng'
      });
    }
    
    // Validate deactivateShifts (nếu có)
    if (deactivateShifts && !Array.isArray(deactivateShifts)) {
      return res.status(400).json({
        success: false,
        message: 'deactivateShifts phải là mảng [{shiftKey, isActive}, ...]'
      });
    }

    // Validate reactivateSubRooms (nếu có)
    if (reactivateSubRooms && !Array.isArray(reactivateSubRooms)) {
      return res.status(400).json({
        success: false,
        message: 'reactivateSubRooms phải là mảng'
      });
    }

    // Call service to update schedule
    const result = await scheduleService.updateSchedule({
      scheduleId,
      isActive,
      reactivateShifts,
      deactivateShifts,
      reactivateSubRooms,
      toggleSubRoom, // 🔧 FIXED: Added toggleSubRoom
      dateRange, // 🆕 FIXED: Added dateRange
      updatedBy: req.user._id
    });

    res.json({
      success: true,
      message: 'Cập nhật lịch thành công',
      data: result
    });

  } catch (error) {
    console.error('❌ Error updating schedule:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể cập nhật lịch'
    });
  }
};

// 🆕 Add missing shifts to existing schedule
exports.addMissingShifts = async (req, res) => {
  // Chỉ admin mới được phép thêm ca thiếu
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Chỉ admin mới được phép thêm ca thiếu vào lịch'
    });
  }

  try {
    const { roomId, month, year, subRoomIds, selectedShifts, partialStartDate } = req.body;

    if (!roomId || !month || !year) {
      return res.status(400).json({
        success: false,
        message: 'roomId, month, year là bắt buộc'
      });
    }

    if (!selectedShifts || !Array.isArray(selectedShifts) || selectedShifts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Phải chọn ít nhất 1 ca để thêm'
      });
    }

    // Call service to add missing shifts
    const result = await scheduleService.addMissingShifts({
      roomId,
      month,
      year,
      subRoomIds: subRoomIds || [],
      selectedShifts,
      partialStartDate,
      updatedBy: req.user._id
    });

    res.json({
      success: true,
      message: result.message,
      data: result
    });

  } catch (error) {
    console.error('❌ Error adding missing shifts:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể thêm ca thiếu'
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

// 🆕 CONTROLLER 3.5: Check Conflicts for Selected Slots (Optimized)
exports.checkConflictsForSlots = async (req, res) => {
  try {
    const { slots } = req.body;
    
    if (!slots || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'slots array is required'
      });
    }
    
    console.log(`🔍 Checking conflicts for ${slots.length} slots`);
    
    const result = await scheduleService.checkConflictsForSlots({ slots });
    
    res.json({
      success: true,
      data: result
    });
    
  } catch (error) {
    console.error('❌ Error in checkConflictsForSlots controller:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể kiểm tra xung đột'
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

// 🆕 Get bulk room schedules info
// API: GET /api/schedules/rooms/bulk-shifts
// Query params: roomIds (comma-separated), fromMonth, toMonth, fromYear, toYear
exports.getBulkRoomSchedulesInfo = async (req, res) => {
  try {
    const { roomIds, fromMonth, toMonth, fromYear, toYear } = req.query;

    // Validate roomIds
    if (!roomIds) {
      return res.status(400).json({
        success: false,
        message: 'roomIds là bắt buộc'
      });
    }

    // Parse roomIds (comma-separated string to array)
    const roomIdsArray = roomIds.split(',').map(id => id.trim()).filter(Boolean);

    if (roomIdsArray.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Phải cung cấp ít nhất 1 roomId'
      });
    }

    // Validate month/year
    if (!fromMonth || !toMonth || !fromYear || !toYear) {
      return res.status(400).json({
        success: false,
        message: 'fromMonth, toMonth, fromYear, toYear là bắt buộc'
      });
    }

    const result = await scheduleService.getBulkRoomSchedulesInfo(
      roomIdsArray,
      parseInt(fromMonth),
      parseInt(toMonth),
      parseInt(fromYear),
      parseInt(toYear)
    );

    res.json(result);
  } catch (error) {
    console.error('Error getting bulk room schedules info:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể lấy thông tin lịch'
    });
  }
};

// 🆕 Generate schedules for multiple rooms
// API: POST /api/schedules/rooms/bulk-generate
// Body: { roomIds: string[], fromMonth, toMonth, fromYear, toYear, startDate, shifts: string[] }
exports.generateBulkRoomSchedules = async (req, res) => {
  // Check permission
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép tạo lịch'
    });
  }

  try {
    const {
      roomIds,
      fromMonth,
      toMonth,
      fromYear,
      toYear,
      startDate,
      shifts
    } = req.body;

    // Validate roomIds
    if (!roomIds || !Array.isArray(roomIds) || roomIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'roomIds phải là mảng và không được rỗng'
      });
    }

    // Validate other fields
    if (!fromMonth || !toMonth || !fromYear || !toYear || !startDate || !shifts) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin: fromMonth, toMonth, fromYear, toYear, startDate, shifts là bắt buộc'
      });
    }

    // Validate shifts
    if (!Array.isArray(shifts) || shifts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'shifts phải là mảng và không được rỗng'
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

    const result = await scheduleService.generateBulkRoomSchedules({
      roomIds,
      fromMonth: parseInt(fromMonth),
      toMonth: parseInt(toMonth),
      fromYear: parseInt(fromYear),
      toYear: parseInt(toYear),
      startDate,
      shifts,
      createdBy: req.user?._id || req.user?.id
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('Error generating bulk room schedules:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Không thể tạo lịch cho nhiều phòng'
    });
  }
};

// 🆕 Nhiệm vụ 2.3: Tạo lịch override trong ngày nghỉ
exports.createScheduleOverrideHoliday = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ manager/admin mới có quyền tạo lịch override ngày nghỉ'
    });
  }

  try {
    const result = await scheduleService.createScheduleOverrideHoliday({
      ...req.body,
      createdBy: req.user.userId
    });

    res.status(201).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error creating schedule override holiday:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// 🆕 Nhiệm vụ 2.4: Validate incomplete schedule
exports.validateIncompleteSchedule = async (req, res) => {
  try {
    const result = await scheduleService.validateIncompleteSchedule(req.query);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error validating incomplete schedule:', error);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

/**
 * 🆕 Validate holiday từ holidaySnapshot của schedule
 */
exports.validateHolidayFromSchedule = async (req, res) => {
  try {
    const { roomId, subRoomId, month, year, date } = req.query;
    
    const result = await scheduleService.validateHolidayFromSchedule({
      roomId,
      subRoomId,
      month: parseInt(month),
      year: parseInt(year),
      date
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error validateHolidayFromSchedule:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
};

/**
 * 🆕 Bulk disable schedule cho nhiều ngày/ca/buồng
 */
exports.bulkDisableSchedule = async (req, res) => {
  try {
    const { roomId, month, year, disableRules } = req.body;
    
    const result = await scheduleService.bulkDisableSchedule({
      roomId,
      month,
      year,
      disableRules
    });
    
    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error bulkDisableSchedule:', error);
    res.status(500).json({ 
      success: false,
      message: error.message 
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
  updateSchedule: exports.updateSchedule, // 🆕 Reactive scheduling
  addMissingShifts: exports.addMissingShifts, // 🆕 Add missing shifts
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
  checkConflictsForSlots: exports.checkConflictsForSlots, // ⚡ Optimized conflict check
  getAvailableReplacementStaff: exports.getAvailableReplacementStaff,
  replaceStaff: exports.replaceStaff,
  getBulkRoomSchedulesInfo: exports.getBulkRoomSchedulesInfo,
  generateBulkRoomSchedules: exports.generateBulkRoomSchedules,
  createScheduleOverrideHoliday: exports.createScheduleOverrideHoliday, // 🆕 Nhiệm vụ 2.3
  validateIncompleteSchedule: exports.validateIncompleteSchedule,       // 🆕 Nhiệm vụ 2.4
  validateHolidayFromSchedule: exports.validateHolidayFromSchedule,     // 🆕 Validate holiday từ holidaySnapshot
  bulkDisableSchedule: exports.bulkDisableSchedule                      // 🆕 Disable nhiều ngày/ca/buồng
}

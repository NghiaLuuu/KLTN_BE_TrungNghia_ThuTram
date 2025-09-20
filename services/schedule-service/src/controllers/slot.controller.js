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
      scheduleId,
      shifts,
      dentistIds,
      nurseIds
    } = req.body;

    // Enforce schedule-level assignment (phân công theo quý)
    if (!scheduleId) {
      return res.status(400).json({ success: false, message: 'Yêu cầu phải gửi scheduleId để phân công theo quý' });
    }

    const result = await slotService.assignStaffToSlots({
      roomId,
      subRoomId,
      scheduleId,
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

// Update staff for specific slot
exports.updateSlotStaff = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ 
      success: false,
      message: 'Chỉ quản lý hoặc admin mới được phép cập nhật nhân sự' 
    });
  }
  
  try {
  const { slotId } = req.params;
  const { dentistId, nurseId, groupSlotIds } = req.body;
    
  const updatedSlot = await slotService.updateSlotStaff(slotId, { dentistId, nurseId, groupSlotIds });
    
    res.json({
      success: true,
      message: 'Cập nhật nhân sự slot thành công',
      data: updatedSlot
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể cập nhật nhân sự slot' 
    });
  }
};

// Get available slots for booking
exports.getAvailableSlots = async (req, res) => {
  try {
    const {
      roomId,
      subRoomId,
      date,
      shiftName,
      serviceId
    } = req.query;
    
    if (!roomId || !date) {
      return res.status(400).json({
        success: false,
        message: 'Room ID và date là bắt buộc'
      });
    }
    
    const slots = await slotService.getAvailableSlots({
      roomId,
      subRoomId,
      date,
      shiftName,
      serviceId
    });
    
    res.json({
      success: true,
      data: slots
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy slot khả dụng' 
    });
  }
};

// Get slots by room and date range
exports.getSlotsByRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!roomId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Room ID, startDate và endDate là bắt buộc'
      });
    }
    
    const slots = await slotService.getSlotsByRoom(roomId, startDate, endDate);
    
    res.json({
      success: true,
      data: slots
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy slot theo phòng' 
    });
  }
};

// Get slots by staff and date range
exports.getSlotsByStaff = async (req, res) => {
  try {
    const { staffId, staffType } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!staffId || !staffType || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Staff ID, staff type, startDate và endDate là bắt buộc'
      });
    }
    
    const slots = await slotService.getSlotsByStaff(staffId, staffType, startDate, endDate);
    
    res.json({
      success: true,
      data: slots
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message || 'Không thể lấy lịch nhân viên' 
    });
  }
};

module.exports = {
  assignStaffToSlots: exports.assignStaffToSlots,
  updateSlotStaff: exports.updateSlotStaff,
  getAvailableSlots: exports.getAvailableSlots,
  getSlotsByRoom: exports.getSlotsByRoom,
  getSlotsByStaff: exports.getSlotsByStaff
};
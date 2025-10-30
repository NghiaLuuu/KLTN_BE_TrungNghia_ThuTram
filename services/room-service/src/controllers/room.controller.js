const roomService = require('../services/room.service');
const Room = require('../models/room.model');

// Chỉ cho phép admin hoặc manager
const isManagerOrAdmin = (user) => {
  if (!user) return false;
  const userRoles = user.roles || (user.role ? [user.role] : []); // Support both roles array and legacy role
  return userRoles.includes('manager') || userRoles.includes('admin');
};

exports.createRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const room = await roomService.createRoom(req.body);
    res.status(201).json(room);
  } catch (err) {
    res.status(400).json({ message: `Lỗi khi tạo phòng: ${err.message}` });
  }
};

exports.updateRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const room = await roomService.updateRoom(req.params.id, req.body);
    res.json(room);
  } catch (err) {
    res.status(400).json({ message: `Lỗi khi cập nhật phòng: ${err.message}` });
  }
};

exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const room = await roomService.toggleStatus(req.params.id);
    res.json(room);
  } catch (err) {
    res.status(404).json({ message: `Không tìm thấy phòng: ${err.message}` });
  }
};

// Xóa phòng
exports.deleteRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const result = await roomService.deleteRoom(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ✅ Ai cũng xem được danh sách phòng (phân trang)
exports.listRooms = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query; // query string
    const data = await roomService.listRooms(page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: `Lỗi khi lấy danh sách phòng: ${err.message}` });
  }
};

// ✅ Ai cũng tìm được phòng
exports.searchRoom = async (req, res) => {
  try {
    const { q = '', page = 1, limit = 10 } = req.query;
    const data = await roomService.searchRoom(q, page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: `Lỗi khi tìm phòng: ${err.message}` });
  }
};

exports.getRoomById = async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await roomService.getRoomWithSubRooms(roomId);

    res.status(200).json({ room });
  } catch (err) {
    console.error(err);
    res.status(404).json({ message: err.message });
  }
};

exports.getSubRoomById = async (req, res) => {
  try {
    const { subRoomId } = req.params;
    const result = await roomService.getSubRoomById(subRoomId);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};

exports.toggleSubRoomStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const { roomId, subRoomId } = req.params;
    const updatedRoom = await roomService.toggleSubRoomStatus(roomId, subRoomId);
    res.json(updatedRoom);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

// Thêm buồng con tự động
exports.addSubRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const { roomId } = req.params;
    const { count = 1 } = req.body;
    
    if (count <= 0 || count > 10) {
      return res.status(400).json({ message: 'Số lượng buồng phải từ 1 đến 10' });
    }

    const room = await roomService.addSubRoom(roomId, count);
    res.json({ 
      message: `Đã thêm ${count} buồng thành công`, 
      room 
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Xóa buồng con
exports.deleteSubRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Từ chối quyền: chỉ quản lý hoặc quản trị viên mới được phép' });
  }

  try {
    const { roomId, subRoomId } = req.params;
    const room = await roomService.deleteSubRoom(roomId, subRoomId);
    res.json({ 
      message: 'Đã xóa buồng thành công', 
      room 
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// 🆕 Lấy danh sách rooms với thông tin schedule (cho trang tạo lịch)
exports.getRoomsForSchedule = async (req, res) => {
  try {
    const { page = 1, limit = 20, isActive } = req.query;
    
    // Filter theo trạng thái active nếu có
    const filter = {};
    if (isActive !== undefined && isActive !== 'undefined') {
      filter.isActive = isActive === 'true';
    }
    
    const data = await roomService.getRoomsWithScheduleInfo(filter, page, limit);
    
    res.json({
      success: true,
      data: data
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: `Lỗi khi lấy danh sách phòng: ${err.message}` 
    });
  }
};

// 🆕 Update room schedule info (called by schedule service)
exports.updateRoomScheduleInfo = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { lastScheduleGenerated, hasBeenUsed } = req.body;
    
    const room = await roomService.updateRoomScheduleInfo(roomId, {
      lastScheduleGenerated,
      hasBeenUsed
    });
    
    res.json({ success: true, room });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// 🆕 Sync all rooms' schedule info from schedule service
exports.syncAllRoomsScheduleInfo = async (req, res) => {
  try {
    const rooms = await roomService.getAllRooms({});
    const { sendRpcRequest } = require('../utils/rabbitClient');
    
    let syncCount = 0;
    const results = [];
    
    for (const room of rooms) {
      try {
        // Request schedule info from schedule-service via RPC
        const scheduleInfo = await sendRpcRequest('schedule.get_room_info', {
          roomId: room._id.toString()
        }, 10000);
        
        if (scheduleInfo && scheduleInfo.hasBeenUsed) {
          await roomService.updateRoomScheduleInfo(room._id, {
            lastScheduleGenerated: scheduleInfo.lastScheduleGenerated,
            hasBeenUsed: scheduleInfo.hasBeenUsed
          });
          syncCount++;
          results.push({ roomId: room._id, name: room.name, synced: true });
        } else {
          results.push({ roomId: room._id, name: room.name, synced: false, reason: 'No schedule' });
        }
      } catch (error) {
        results.push({ roomId: room._id, name: room.name, synced: false, error: error.message });
      }
    }
    
    res.json({ 
      success: true, 
      message: `Synced ${syncCount}/${rooms.length} rooms`,
      results 
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: `Lỗi khi sync: ${err.message}` 
    });
  }
};

// Get room types enum
exports.getRoomTypes = async (req, res) => {
  try {
    res.json({
      success: true,
      data: Room.ROOM_TYPES
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: `Lỗi khi lấy room types: ${err.message}` 
    });
  }
};

// Get active rooms (isActive = true)
exports.getActiveRooms = async (req, res) => {
  try {
    const activeRooms = await Room.find({ isActive: true })
      .select('_id name type isActive hasSubrooms description')
      .sort({ name: 1 });

    res.json({
      success: true,
      data: activeRooms,
      total: activeRooms.length
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: `Lỗi khi lấy danh sách phòng active: ${err.message}` 
    });
  }
};

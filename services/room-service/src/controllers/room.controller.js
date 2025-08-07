const roomService = require('../services/room.service');

// Chỉ cho phép admin hoặc manager
const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

exports.createRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const room = await roomService.createRoom(req.body);
    res.status(201).json(room);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateRoom = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const room = await roomService.updateRoom(req.params.id, req.body);
    res.json(room);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Permission denied: manager or admin only' });
  }

  try {
    const room = await roomService.toggleStatus(req.params.id);
    res.json(room);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
};

// ✅ Ai cũng xem được danh sách phòng
exports.listRooms = async (req, res) => {
  try {
    const rooms = await roomService.listRooms();
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ✅ Ai cũng tìm được phòng
exports.searchRoom = async (req, res) => {
  try {
    const rooms = await roomService.searchRoom(req.query.q || '');
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

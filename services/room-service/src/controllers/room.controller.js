const roomService = require('../services/room.service');

// Chỉ cho phép admin hoặc manager
const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
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

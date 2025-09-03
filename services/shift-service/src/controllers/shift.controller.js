const shiftService = require('../services/shift.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// ✅ Tạo ca làm việc
exports.createShift = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const newShift = await shiftService.createShift(req.body);
    res.status(201).json(newShift);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể tạo ca làm việc' });
  }
};

// ✅ Cập nhật ca làm việc
exports.updateShift = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const updated = await shiftService.updateShift(req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Không thể cập nhật ca làm việc' });
  }
};

// ✅ Đổi trạng thái ca làm việc
exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }

  try {
    const toggled = await shiftService.toggleStatus(req.params.id);
    res.json(toggled);
  } catch (err) {
    res.status(404).json({ message: err.message || 'Không tìm thấy ca làm việc' });
  }
};

// ✅ Lấy danh sách ca làm việc (có phân trang)
exports.listShifts = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const data = await shiftService.listShifts(page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server khi lấy danh sách ca làm việc' });
  }
};

// ✅ Tìm kiếm ca làm việc (có phân trang)
exports.searchShift = async (req, res) => {
  try {
    const { q = '', page = 1, limit = 10 } = req.query;
    const data = await shiftService.searchShift(q, page, limit);
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Lỗi server khi tìm kiếm ca làm việc' });
  }
};

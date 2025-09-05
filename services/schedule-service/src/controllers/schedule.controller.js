const scheduleService = require('../services/schedule.service');

const isManagerOrAdmin = (user) => {
  return user && (user.role === 'manager' || user.role === 'admin');
};

// ✅ Tạo lịch
exports.createSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }
  try {
    const schedule = await scheduleService.createSchedule(req.body);
    res.status(201).json(schedule);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Không thể tạo lịch làm việc' });
  }
};

// ✅ Cập nhật lịch
exports.updateSchedule = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }
  try {
    const schedule = await scheduleService.updateSchedule(req.params.id, req.body);
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Không thể cập nhật lịch làm việc' });
  }
};

// ✅ Đổi trạng thái lịch
exports.toggleStatus = async (req, res) => {
  if (!isManagerOrAdmin(req.user)) {
    return res.status(403).json({ message: 'Chỉ quản lý hoặc admin mới được phép' });
  }
  try {
    const schedule = await scheduleService.toggleStatus(req.params.id);
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Không thể thay đổi trạng thái lịch' });
  }
};



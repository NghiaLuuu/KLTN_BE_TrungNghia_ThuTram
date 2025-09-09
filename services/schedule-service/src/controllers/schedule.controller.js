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

exports.getSchedules = async (req, res) => {
  try {
    const { roomId, shiftIds, page, limit } = req.query;

    // Chuyển shiftIds từ query string thành array
    const shiftArray = shiftIds ? shiftIds.split(',') : [];

    const result = await scheduleService.listSchedules({
      roomId,
      shiftIds: shiftArray,
      page: page || 1,
      limit: limit || 1
    });

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};


exports.getScheduleDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const schedule = await scheduleService.getScheduleById(id);
    res.status(200).json(schedule);
  } catch (err) {
    console.error(err);
    res.status(404).json({ message: err.message });
  }
};

exports.getScheduleSlots = async (req, res) => {
  try {
    const { id } = req.params;
    let { page = 1, limit } = req.query;

    // Nếu limit không truyền thì để undefined
    limit = limit ? Number(limit) : undefined;

    const result = await scheduleService.getSlotsByScheduleId({
      scheduleId: id,
      page: Number(page),
      limit
    });

    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(404).json({ message: err.message });
  }
};

exports.getRoomSchedulesSummary = async (req, res) => {
  try {
    const { roomId } = req.params;
    const summary = await scheduleService.getRoomSchedulesSummary(roomId);
    res.status(200).json(summary);
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message });
  }
};


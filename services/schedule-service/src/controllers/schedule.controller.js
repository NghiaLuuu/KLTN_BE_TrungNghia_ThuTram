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


exports.getSubRoomSchedule = async (req, res) => {
  try {
    const { subRoomId, range, page = 1 } = req.query;

    if (!subRoomId) {
      return res.status(400).json({ message: "Thiếu subRoomId" });
    }

    const now = new Date();
    let startDate, endDate;
    const pageNum = Number.isNaN(parseInt(page, 10)) ? 1 : parseInt(page, 10);


    if (range === "week") {
      const day = now.getDay(); // CN=0, T2=1 ... T7=6
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      monday.setHours(0, 0, 0, 0);

      // dịch theo page (cho phép âm)
      startDate = new Date(monday);
      startDate.setDate(monday.getDate() + (pageNum - 1) * 7);

      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      // Điều chỉnh: bỏ thứ 2 & CN
      startDate.setDate(startDate.getDate() + 1);
      endDate.setDate(endDate.getDate());
    } 
    else if (range === "month") {
      // Tháng hiện tại
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // dịch theo page (cho phép âm)
      firstOfMonth.setMonth(firstOfMonth.getMonth() + (pageNum - 1));

      startDate = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 2, 0, 0, 0, 0);
      endDate = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    } 
    else {
      return res.status(400).json({ message: "range phải là 'week' hoặc 'month'" });
    }

    const result = await scheduleService.getSubRoomSchedule({
      subRoomId,
      startDate,
      endDate,
    });

    res.status(200).json({
      page: pageNum,
      range,
      startDate,
      endDate,
      result,
    });
  } catch (err) {
    console.error("❌ getSubRoomSchedule error:", err);
    res.status(400).json({ message: err.message });
  }
};

// scheduleController.js
exports.getStaffSchedule = async (req, res) => {
  try {
    const { staffId, range, page = 1 } = req.query;
    if (!staffId) return res.status(400).json({ message: "Thiếu staffId" });

    const now = new Date();
    let startDate, endDate;
    const pageNum = parseInt(page, 10) || 1;

    if (range === "week") {
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      monday.setHours(0, 0, 0, 0);

      startDate = new Date(monday);
      startDate.setDate(monday.getDate() + (pageNum - 1) * 7);

      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);

      startDate.setDate(startDate.getDate() + 1); // bỏ CN
    } else if (range === "month") {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      firstOfMonth.setMonth(firstOfMonth.getMonth() + (pageNum - 1));

      startDate = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth(), 2, 0, 0, 0, 0);
      endDate = new Date(firstOfMonth.getFullYear(), firstOfMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    } else {
      return res.status(400).json({ message: "range phải là 'week' hoặc 'month'" });
    }

    const result = await scheduleService.getStaffSchedule({ staffId, startDate, endDate });

    res.status(200).json({
      page: pageNum,
      range,
      startDate,
      endDate,
      result
    });
  } catch (err) {
    console.error("❌ getStaffSchedule error:", err);
    res.status(400).json({ message: err.message });
  }
};

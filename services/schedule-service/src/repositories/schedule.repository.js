const Schedule = require('../models/schedule.model');
const Slot = require('../models/slot.model'); 
const mongoose = require('mongoose');

// 🔹 Tạo schedule
exports.createSchedule = async (data) => {
  return await Schedule.create(data);
};

// 🔹 Alias để tương thích với service (create)
exports.create = async (data) => {
  return await Schedule.create(data);
};

// 🔹 Tìm theo id (raw document, không populate)
exports.findById = async (id) => {
  return await Schedule.findById(id);
};

// 🔹 Update schedule
exports.updateSchedule = async (id, data) => {
  return await Schedule.findByIdAndUpdate(id, data, { new: true });
};

// 🔹 Tìm schedule theo staff + ngày
exports.findByStaffAndDate = async (staffId, date) => {
  if (!mongoose.Types.ObjectId.isValid(staffId)) {
    throw new Error('Invalid staff ID');
  }

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return await Schedule.find({
    date: { $gte: startOfDay, $lte: endOfDay },
    $or: [
      { dentistIds: { $in: [staffId] } },
      { nurseIds: { $in: [staffId] } }
    ]
  });
};

// 🔹 Thêm slots vào schedule
exports.appendSlots = async (scheduleId, slotIds) => {
  return await Schedule.findByIdAndUpdate(
    scheduleId,
    { $push: { slots: { $each: slotIds } } },
    { new: true }
  );
};

// 🔹 Tìm 1 schedule
exports.findOne = async (filter) => {
  return await Schedule.findOne(filter);
};

// 🔹 Lấy tất cả schedules (có filter roomId, phân trang)
// Note: shiftIds was removed from the schema. We accept the arg for compatibility but do not
// filter by it; callers should filter by room/date or by workShifts on the service layer.
exports.findSchedules = async ({ roomId, /* shiftIds ignored */ skip = 0, limit = 10 }) => {
  const filter = {};
  if (roomId) filter.roomId = roomId;

  const schedules = await Schedule.find(filter)
    .sort({ startDate: -1 })
    .skip(skip)
    .limit(limit);

  const total = await Schedule.countDocuments(filter);

  return { schedules, total };
};

// 🔹 Lấy schedule theo id (raw document)
exports.findScheduleById = async (id) => {
  return await Schedule.findById(id);
};

// 🔹 Alias để tương thích với RPC (getScheduleById)
exports.getScheduleById = async (id) => {
  return await Schedule.findById(id);
};

// 🔹 Lấy slots theo scheduleId (có phân trang)
exports.findSlotsByScheduleId = async (scheduleId, page = 1, limit) => {
  const filter = { scheduleId };

  if (limit) {
    const skip = (page - 1) * limit;
    const slots = await Slot.find(filter).sort({ startTime: 1 }).skip(skip).limit(limit);
    const total = await Slot.countDocuments(filter);
    return {
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      slots
    };
  } else {
    const slots = await Slot.find(filter).sort({ startTime: 1 });
    return {
      total: slots.length,
      totalPages: 1,
      page: 1,
      limit: slots.length,
      slots
    };
  }
};

// 🔹 Lấy tất cả schedules (không filter)
exports.findAll = async () => {
  return await Schedule.find({}).lean();
};

// 🔹 Lấy schedules theo roomId (chỉ active, có populate slots)
exports.findByRoomId = async (roomId) => {
  return Schedule.find({ roomId, isActive: true })
    .lean();
};

// 🔹 Lấy schedules theo subRoom (lọc theo khoảng ngày)
exports.findBySubRoomId = async (subRoomId, startDate, endDate) => {
  return Schedule.find({
    isActive: true,
    startDate: { $lte: endDate },
    endDate: { $gte: startDate }
  })
    .lean();
};

// Tìm theo danh sách id
exports.findByIds = async (scheduleIds) => {
  return Schedule.find({ _id: { $in: scheduleIds }, isActive: true }).lean();
};

// 🔹 Tìm schedule theo roomId và ngày cụ thể (Vietnam timezone)
exports.findByRoomAndDate = async (roomId, date) => {
  const base = new Date(date);
  const vn = new Date(base.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const yyyy = vn.getFullYear();
  const mm = String(vn.getMonth() + 1).padStart(2, '0');
  const dd = String(vn.getDate()).padStart(2, '0');
  const vnStr = `${yyyy}-${mm}-${dd}`;

  // Ưu tiên filter theo dateVNStr để đúng theo ngày VN
  const byVN = await Schedule.findOne({ roomId, dateVNStr: vnStr }).lean();
  if (byVN) return byVN;

  // No fallback: we rely solely on dateVNStr to avoid TZ ambiguity
  return null;
};

// 🔹 Tìm schedules theo roomId và khoảng ngày (Vietnam timezone)
exports.findByRoomAndDateRange = async (roomId, startDate, endDate) => {
  const sBase = new Date(startDate);
  const eBase = new Date(endDate);
  const sVN = new Date(sBase.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const eVN = new Date(eBase.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

  const sStr = `${sVN.getFullYear()}-${String(sVN.getMonth() + 1).padStart(2, '0')}-${String(sVN.getDate()).padStart(2, '0')}`;
  const eStr = `${eVN.getFullYear()}-${String(eVN.getMonth() + 1).padStart(2, '0')}-${String(eVN.getDate()).padStart(2, '0')}`;

  // Ưu tiên theo dateVNStr
  const byVN = await Schedule.find({ roomId, dateVNStr: { $gte: sStr, $lte: eStr } }).lean();
  if (byVN && byVN.length > 0) return byVN;

  // No fallback to Date fields
  return [];
};

// 🔹 Lấy schedules theo khoảng ngày (tất cả phòng)
exports.findByDateRange = async (startDate, endDate) => {
  const sBase = new Date(startDate);
  const eBase = new Date(endDate);
  const sVN = new Date(sBase.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const eVN = new Date(eBase.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

  const sStr = `${sVN.getFullYear()}-${String(sVN.getMonth() + 1).padStart(2, '0')}-${String(sVN.getDate()).padStart(2, '0')}`;
  const eStr = `${eVN.getFullYear()}-${String(eVN.getMonth() + 1).padStart(2, '0')}-${String(eVN.getDate()).padStart(2, '0')}`;

  const byVN = await Schedule.find({ dateVNStr: { $gte: sStr, $lte: eStr } }).lean();
  if (byVN && byVN.length > 0) return byVN;

  return [];
};


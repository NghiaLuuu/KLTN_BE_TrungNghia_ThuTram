const Schedule = require('../models/schedule.model');
const Slot = require('../models/slot.model'); 
const mongoose = require('mongoose');

// 🔹 Tạo schedule
exports.createSchedule = async (data) => {
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

// 🔹 Lấy tất cả schedules (có filter roomId, shiftIds, phân trang)
exports.findSchedules = async ({ roomId, shiftIds = [], skip = 0, limit = 10 }) => {
  const filter = {};
  if (roomId) filter.roomId = roomId;
  if (shiftIds.length > 0) filter.shiftIds = { $in: shiftIds };

  const schedules = await Schedule.find(filter)
    .populate('slots')
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
  return Schedule.find({ roomId, status: 'active' })
    .populate('slots')
    .lean();
};

// 🔹 Lấy schedules theo subRoom (lọc theo khoảng ngày, có populate slots)
exports.findBySubRoomId = async (subRoomId, startDate, endDate) => {
  return Schedule.find({
    status: 'active',
    startDate: { $lte: endDate },
    endDate: { $gte: startDate }
  })
    .populate({
      path: 'slots',
      match: { subRoomId }
    })
    .lean();
};

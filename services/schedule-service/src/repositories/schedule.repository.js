const Schedule = require('../models/schedule.model');
const Slot = require('../models/slot.model'); 

const mongoose = require('mongoose');

exports.createSchedule = async (data) => {
  return await Schedule.create(data);
};

exports.findById = async (id) => {
  return await Schedule.findById(id); // không populate
};

exports.updateSchedule = async (id, data) => {
  return await Schedule.findByIdAndUpdate(id, data, { new: true });
};

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

exports.getScheduleById = async (scheduleId) => {
  if (!mongoose.Types.ObjectId.isValid(scheduleId)) return null;

  try {
    return await Schedule.findById(scheduleId);
  } catch (err) {
    console.error('Error in getScheduleById:', err);
    return null;
  }
};

exports.appendSlots = async (scheduleId, slotIds) => {
  return await Schedule.findByIdAndUpdate(
    scheduleId,
    { $push: { slots: { $each: slotIds } } },
    { new: true }
  );
};

exports.findOne = async (filter) => {
  return await Schedule.findOne(filter); // không populate
};

exports.findByRoomId = async (roomId) => {
  return await Schedule.find({ roomId });
};


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

exports.findScheduleById = async (id) => {
  const schedule = await Schedule.findById(id); // chỉ lấy raw document
  return schedule;
};

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
    // Nếu limit không truyền → trả hết
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

const Schedule = require('../models/schedule.model');
const mongoose = require('mongoose');

exports.createSchedule = async (data) => {
  return await Schedule.create(data);
};

exports.findById = async (id) => {
  return await Schedule.findById(id).populate('slots'); 
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
      { dentistIds: { $in: [staffId] } }, // tìm nếu là nha sĩ
      { nurseIds: { $in: [staffId] } }    // tìm nếu là y tá
    ]
  }).populate('slots');
};

exports.getScheduleById = async (scheduleId) => {
  if (!mongoose.Types.ObjectId.isValid(scheduleId)) return null;

  try {
    const schedule = await Schedule.findById(scheduleId)
      .populate('dentistIds', 'name role')   // populate thông tin nha sĩ nếu cần
      .populate('nurseIds', 'name role')     // populate thông tin y tá nếu cần
      .populate('roomId', 'name type');      // populate thông tin phòng nếu cần
    return schedule;
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
  return await Schedule.findOne(filter).populate('slots');
};
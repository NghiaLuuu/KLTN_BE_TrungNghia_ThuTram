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

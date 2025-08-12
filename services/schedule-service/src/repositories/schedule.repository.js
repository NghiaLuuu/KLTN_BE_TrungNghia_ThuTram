const Schedule = require('../models/schedule.model');


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
  // Lấy các schedule trong ngày này mà có staffId (dentist hoặc nurse)
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return await Schedule.find({
    date: { $gte: startOfDay, $lte: endOfDay },
    $or: [
      { dentistIds: staffId },
      { nurseIds: staffId }
    ]
  }).populate('slots');
};

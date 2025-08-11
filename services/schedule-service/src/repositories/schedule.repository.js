const Schedule = require('../models/schedule.model');

exports.createSchedule = async (data) => {
  return await Schedule.create(data);
};

exports.findById = async (id) => {
  return await Schedule.findById(id);
};

exports.updateSchedule = async (id, updateData) => {
  return await Schedule.findByIdAndUpdate(id, updateData, { new: true });
};

exports.toggleStatus = async (id) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) return null;
  schedule.status = schedule.status === 'active' ? 'inactive' : 'active';
  return await schedule.save();
};

exports.findByStaffAndDate = async (staffId, date) => {
  return await Schedule.find({
    $or: [
      { dentistIds: staffId },
      { nurseIds: staffId }
    ],
    date: new Date(date)
  }).populate('roomId dentistIds nurseIds');
};

exports.assignStaffToShift = async (id, { dentistIds = [], nurseIds = [] }) => {
  const schedule = await Schedule.findById(id);
  if (!schedule) return null;

  schedule.dentistIds = [...new Set([...schedule.dentistIds, ...dentistIds])];
  schedule.nurseIds = [...new Set([...schedule.nurseIds, ...nurseIds])];

  return await schedule.save();
};

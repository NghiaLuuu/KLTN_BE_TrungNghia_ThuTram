const scheduleRepo = require('../repositories/schedule.repository');

exports.createSchedule = async (data) => {
  return await scheduleRepo.createSchedule(data);
};

exports.updateSchedule = async (id, data) => {
  return await scheduleRepo.updateSchedule(id, data);
};

exports.toggleStatus = async (id) => {
  return await scheduleRepo.toggleStatus(id);
};

exports.viewByStaff = async (staffId, date) => {
  return await scheduleRepo.findByStaffAndDate(staffId, date);
};

exports.assignStaffToShift = async (scheduleId, staffData) => {
  return await scheduleRepo.assignStaffToShift(scheduleId, staffData);
};

exports.generateRecurring = async (type, baseData, occurrences) => {
  const schedules = [];
  let date = new Date(baseData.date);

  for (let i = 0; i < occurrences; i++) {
    schedules.push(await scheduleRepo.createSchedule({
      ...baseData,
      date: new Date(date)
    }));

    if (type === 'weekly') {
      date.setDate(date.getDate() + 7);
    } else if (type === 'monthly') {
      date.setMonth(date.getMonth() + 1);
    }
  }
  return schedules;
};

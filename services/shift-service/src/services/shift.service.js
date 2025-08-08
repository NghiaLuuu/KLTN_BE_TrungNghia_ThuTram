const shiftRepo = require('../repositories/shift.repository');

exports.createShift = async (data) => {
  return await shiftRepo.createShift(data);
};

exports.updateShift = async (shiftId, data) => {
  return await shiftRepo.updateShift(shiftId, data);
};

exports.toggleStatus = async (id) => {
  return await shiftRepo.toggleStatus(id);
};

exports.listShifts = async () => {
  return await shiftRepo.listShifts();
};

exports.searchShift = async (keyword) => {
  return await shiftRepo.searchShift(keyword);
};

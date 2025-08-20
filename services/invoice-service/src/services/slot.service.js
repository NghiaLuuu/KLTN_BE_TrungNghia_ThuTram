const slotRepo = require('../repositories/slot.repository');

module.exports.createSlot = async (data) => {
  return await slotRepo.createSlot(data);
};

module.exports.setDuration = async (id, duration) => {
  return await slotRepo.setDuration(id, duration);
};

module.exports.updateStatus = async (id, status) => {
  return await slotRepo.updateStatus(id, status);
};

module.exports.updateInfo = async (id, data) => {
  return await slotRepo.updateInfo(id, data);
};

module.exports.getSlots = async (filter = {}) => {
  return await slotRepo.getSlots(filter);
};

module.exports.getSlotById = async (id) => {
  return await slotRepo.getSlotById(id);
};

module.exports.deleteSlot = async (id) => {
  return await slotRepo.deleteSlot(id);
};

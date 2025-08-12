const Slot = require('../models/slot.model');

// Create new slot
module.exports.createSlot = async (data) => {
  const slot = new Slot(data);
  return await slot.save();
};

// Set duration
module.exports.setDuration = async (id, duration) => {
  return await Slot.findByIdAndUpdate(
    id,
    { duration },
    { new: true }
  );
};

// Update status
module.exports.updateStatus = async (id, status) => {
  return await Slot.findByIdAndUpdate(
    id,
    { status },
    { new: true }
  );
};

// Update info
module.exports.updateInfo = async (id, data) => {
  return await Slot.findByIdAndUpdate(
    id,
    data,
    { new: true }
  );
};

// Get slots (with optional filter)
module.exports.getSlots = async (filter) => {
  return await Slot.find(filter);
};

// Get slot by ID
module.exports.getSlotById = async (id) => {
  return await Slot.findById(id);
};

// Delete slot by ID
module.exports.deleteSlot = async (id) => {
  const result = await Slot.findByIdAndDelete(id);
  return result;
};

// Xóa nhiều slot theo điều kiện
module.exports.deleteMany = async (filter) => {
  return await Slot.deleteMany(filter);
};

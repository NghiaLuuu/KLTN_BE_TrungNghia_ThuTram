const Slot = require('../models/slot.model');


exports.findSlots = async (filter) => {
  return await Slot.find(filter); 
};

exports.updateManySlots = async (filter, updateData) => {
  return await Slot.updateMany(filter, { $set: updateData });
};

exports.updateSlot = async (id, updateData) => {
  return await Slot.findByIdAndUpdate(id, updateData, { new: true });
};


// Tìm 1 slot theo id
exports.findById = async (id) => {
  return await Slot.findById(id);
};


// ✅ Tạo nhiều slot
exports.insertMany = async (slots) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error("slots must be a non-empty array");
  }
  return await Slot.insertMany(slots);
};

exports.deleteMany = async (filter) => {
  return await Slot.deleteMany(filter);
};
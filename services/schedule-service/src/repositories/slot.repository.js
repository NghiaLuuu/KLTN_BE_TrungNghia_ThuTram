const Slot = require('../models/slot.model');


exports.findSlots = async (filter, skip = 0, limit = 10) => {
  return await Slot.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ date: 1, startTime: 1 }); // gợi ý: sort theo ngày + giờ
};

exports.countSlots = async (filter) => {
  return await Slot.countDocuments(filter);
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

// Cập nhật nhiều slot
exports.updateMany = async (filter, updateData) => {
  return await Slot.updateMany(filter, updateData);
};

exports.find = async (query) => {
  return await Slot.find(query);
};

exports.findSlotsByDentistFromNow = async (dentistId, fromTime) => {
  return Slot.find({
    dentistId: dentistId,
    startTime: { $gte: fromTime }, // chỉ lấy từ thời gian hiện tại trở đi
    status: 'available'
  }).sort({ startTime: 1 }).lean();
};
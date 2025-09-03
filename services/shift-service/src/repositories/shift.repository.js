const Shift = require('../models/shift.model');

exports.createShift = async (data) => {
  const shift = new Shift(data);
  return await shift.save();
};

exports.updateShift = async (shiftId, updateData) => {
  return await Shift.findByIdAndUpdate(
    shiftId,
    updateData,
    { new: true, runValidators: true }
  );
};

exports.toggleStatus = async (id) => {
  const shift = await Shift.findById(id);
  if (!shift) throw new Error('Shift not found');
  shift.isActive = !shift.isActive;
  return await shift.save();
};

// ✅ danh sách có phân trang
exports.listShifts = async (skip = 0, limit = 10) => {
  return await Shift.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

exports.countShifts = async () => {
  return await Shift.countDocuments();
};

// search shifts by name
exports.searchShift = async (keyword, skip = 0, limit = 10) => {
  return await Shift.find({
    name: { $regex: keyword, $options: 'i' }
  })
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
};

exports.countSearchShift = async (keyword) => {
  return await Shift.countDocuments({
    name: { $regex: keyword, $options: 'i' }
  });
};

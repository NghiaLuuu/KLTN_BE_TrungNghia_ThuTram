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

exports.listShifts = async () => {
  return await Shift.find();
};

exports.searchShift = async (keyword) => {
  return await Shift.find({
    $or: [
      { name: new RegExp(keyword, 'i') },
      { code: new RegExp(keyword, 'i') },
    ],
  });
};

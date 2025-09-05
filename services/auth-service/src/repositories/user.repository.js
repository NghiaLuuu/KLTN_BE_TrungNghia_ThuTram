// user.repository.js
const User = require('../models/user.model');

exports.findByEmail = (email) => User.findOne({ email });
exports.findByPhone = (phone) => User.findOne({ phone });

exports.findById = async (id) => {
  return await User.findById(id); 
};

exports.saveUser = (user) => user.save();

exports.updateById = async (id, data) => {
  // Loại bỏ các field không được phép cập nhật
  const { password, email, role, ...allowedData } = data;

  return await User.findByIdAndUpdate(
    id,
    { $set: allowedData },
    { new: true, runValidators: true }
  ).select('-password');
};


exports.updateRefreshTokens = async (user, refreshTokens) => {
  user.refreshTokens = refreshTokens;
  return await user.save();
};

exports.listUsers = async () => {
  return await User.find({ role: { $ne: 'patient' } }).select('-password');
};


exports.getUserById = async (id) => {
  return User.findById(id).lean();
};



// ✅ Lấy user theo role + phân trang
exports.getUsersByRole = async (role, skip = 0, limit = 10) => {
  return await User.find({ role })
    .select('-password')
    .skip(skip)
    .limit(limit);
};
exports.countByRole = async (role) => {
  return await User.countDocuments({ role });
};

exports.getAllStaff = async (skip = 0, limit = 10) => {
  // Lấy tất cả user trừ patient
  return await User.find({ role: { $ne: 'patient' } })
    .select('-password')
    .skip(skip)
    .limit(limit);
};

exports.countAllStaff = async () => {
  return await User.countDocuments({ role: { $ne: 'patient' } });
};
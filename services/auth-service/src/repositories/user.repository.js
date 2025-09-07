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

// Lấy user theo id
exports.getUserById = async (id) => {
  return await User.findById(id).select('-password').lean();
};

// Cập nhật user theo id, nhưng KHÔNG cập nhật password
exports.updateByIdExcludePassword = async (id, data) => {
  // Loại bỏ password nếu có
  const { password, ...allowedData } = data;

  // Cập nhật
  return await User.findByIdAndUpdate(
    id,
    { $set: allowedData },
    { new: true, runValidators: true }
  ).select('-password'); // trả về user nhưng ẩn password
};

// Tìm nhân viên theo nhiều tiêu chí, trừ patient
exports.searchStaff = async (criteria, skip = 0, limit = 10) => {
  const query = { role: { $ne: 'patient' } };

  if (criteria.fullName) query.fullName = { $regex: criteria.fullName, $options: 'i' };
  if (criteria.email) query.email = { $regex: criteria.email, $options: 'i' };
  if (criteria.phone) query.phone = { $regex: criteria.phone, $options: 'i' };
  if (criteria.role) query.role = criteria.role; // ví dụ 'dentist'
  if (criteria.gender) query.gender = criteria.gender;
  if (criteria.type) query.type = criteria.type;

  return await User.find(query)
    .select('-password')
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
};

// Đếm tổng số kết quả phù hợp
exports.countStaff = async (criteria) => {
  const query = { role: { $ne: 'patient' } };

  if (criteria.fullName) query.fullName = { $regex: criteria.fullName, $options: 'i' };
  if (criteria.email) query.email = { $regex: criteria.email, $options: 'i' };
  if (criteria.phone) query.phone = { $regex: criteria.phone, $options: 'i' };
  if (criteria.role) query.role = criteria.role;
  if (criteria.gender) query.gender = criteria.gender;
  if (criteria.type) query.type = criteria.type;

  return await User.countDocuments(query);
};

exports.findUsersByIds = async (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return User.find({ _id: { $in: ids } }, '_id fullName role'); // Chỉ lấy _id, fullName, role
};



// user.repository.js
const User = require('../models/user.model');

exports.findByEmail = (email) => User.findOne({ email });
exports.findByPhone = (phone) => User.findOne({ phone });

exports.findById = async (id) => {
  return await User.findById(id); 
};

exports.saveUser = (user) => user.save();

exports.updateById = async (id, data) => {
  return await User.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true }).select('-password');
};

exports.updateRefreshTokens = async (user, refreshTokens) => {
  user.refreshTokens = refreshTokens;
  return await user.save();
};

exports.listUsers = async () => {
  return await User.find({ role: { $ne: 'patient' } }).select('-password');
};


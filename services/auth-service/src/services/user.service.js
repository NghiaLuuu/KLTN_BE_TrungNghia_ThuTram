const userRepo = require('../repositories/user.repository');

exports.getProfile = async (userId) => {
  return await userRepo.findById(userId);
};

exports.updateProfile = async (userId, data) => {
  return await userRepo.updateById(userId, data);
};

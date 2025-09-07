const userRepo = require('../repositories/user.repository');
const redis = require('../utils/redis.client');
const bcrypt = require('bcrypt');
const USER_CACHE_KEY = 'users_cache';

async function initUserCache() {
  const users = await userRepo.listUsers(); // cần có method listUsers trong repository
  const filtered = users.filter(user => user.role !== 'patient');
  await redis.set(USER_CACHE_KEY, JSON.stringify(filtered));
  console.log(`✅ Cache nhân viên đã được tải: ${filtered.length} nhân viên`);
}

exports.createUser = async (data) => {
  const user = await userRepo.createUser(data);
  await refreshUserCache();
  return user;
};

exports.updateUser = async (userId, data) => {
  const updated = await userRepo.updateById(userId, data);
  if (!updated) throw new Error('Không tìm thấy người dùng để cập nhật');
  await refreshUserCache();
  return updated;
};

exports.listUsers = async () => {
  let cached = await redis.get(USER_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const users = await userRepo.listUsers();
  const filtered = users.filter(user => user.role !== 'patient');
  await redis.set(USER_CACHE_KEY, JSON.stringify(filtered));
  return filtered;
};

exports.getProfile = async (userId) => {
  if (!userId) throw new Error('Thiếu mã người dùng');

  // Lấy tất cả user từ cache
  let users = await redis.get(USER_CACHE_KEY);
  if (users) {
    users = JSON.parse(users);
    const user = users.find(u => u._id.toString() === userId.toString());
    if (user) return user;
  }

  // Nếu không tìm thấy trong cache hoặc cache trống, lấy trực tiếp từ DB
  const userFromDb = await userRepo.findById(userId);
  if (!userFromDb) throw new Error('Không tìm thấy người dùng');

  return userFromDb;
};

exports.searchUser = async (keyword) => {
  const users = await this.listUsers();
  return users.filter(user =>
    user.name?.toLowerCase().includes(keyword.toLowerCase())
  );
};

async function refreshUserCache() {
  const users = await userRepo.listUsers();
  const filtered = users.filter(user => user.role !== 'patient');
  await redis.set(USER_CACHE_KEY, JSON.stringify(filtered));
  console.log(`♻ Cache người dùng đã được làm mới: ${filtered.length} người dùng`);
}

exports.getUsersByRole = async (role, page = 1, limit = 10) => {
  if (!role) throw new Error('Thiếu vai trò để lọc người dùng');

  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    userRepo.getUsersByRole(role, skip, limit),
    userRepo.countByRole(role),
  ]);

  if (total === 0) throw new Error(`Không tìm thấy người dùng với vai trò "${role}"`);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
  };
};

exports.getAllStaff = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    userRepo.getAllStaff(skip, limit),
    userRepo.countAllStaff(),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
  };
};

exports.searchStaff = async (criteria = {}, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    userRepo.searchStaff(criteria, skip, limit),
    userRepo.countStaff(criteria),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
  };
};



// Cập nhật thông tin user theo id (admin/manager, giữ nguyên field không truyền)
exports.updateProfileByAdmin = async (currentUser, userId, data) => {
  // Kiểm tra quyền
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Bạn không có quyền thực hiện chức năng này');
  }

  // Lấy user hiện tại
  const existingUser = await userRepo.findById(userId);
  if (!existingUser) {
    throw new Error('Không tìm thấy người dùng để cập nhật');
  }

  // Merge dữ liệu mới vào dữ liệu cũ
  const updatedData = { ...existingUser.toObject(), ...data };

  // Cập nhật user nhưng không thay đổi password
  const updatedUser = await userRepo.updateByIdExcludePassword(userId, updatedData);
  if (!updatedUser) {
    throw new Error('Không thể cập nhật người dùng');
  }

  // Cập nhật cache nếu có
  await refreshUserCache();

  return updatedUser;
};


// Lấy thông tin user theo id
exports.getUserById = async (currentUser, userId) => {
  // Nếu muốn, kiểm tra quyền: chỉ admin/manager mới được xem user khác
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser._id.toString() !== userId) {
    throw new Error('Bạn không có quyền truy cập thông tin người dùng này');
  }

  const user = await userRepo.getUserById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  return user;
};

exports.getStaffByIds = async (ids) => {
  const users = await userRepo.findUsersByIds(ids);

  // map fullName -> name để đúng response yêu cầu
  const staff = users.map(u => ({
    _id: u._id,
    name: u.fullName,
    role: u.role
  }));

  return { staff };
};


exports.refreshUserCache = refreshUserCache;

initUserCache().catch(err => console.error('❌ Lỗi khi tải cache người dùng:', err));

const userRepo = require('../repositories/user.repository');
const redis = require('../utils/redis.client');

const USER_CACHE_KEY = 'users_cache';

async function initUserCache() {
  const users = await userRepo.listUsers(); // cần có method listUsers trong repository
  const filtered = users.filter(user => user.role !== 'patient');
  await redis.set(USER_CACHE_KEY, JSON.stringify(filtered));
  console.log(`✅ User cache loaded: ${filtered.length} users`);
}

exports.createUser = async (data) => {
  const user = await userRepo.createUser(data);
  await refreshUserCache();
  return user;
};

exports.updateUser = async (userId, data) => {
  const updated = await userRepo.updateById(userId, data);
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
  if (!userId) throw new Error('UserId is required');

  // Lấy tất cả user từ cache
  let users = await redis.get(USER_CACHE_KEY);
  if (users) {
    users = JSON.parse(users);
    const user = users.find(u => u._id.toString() === userId.toString());
    if (user) return user;
  }

  // Nếu không tìm thấy trong cache hoặc cache trống, lấy trực tiếp từ DB
  const userFromDb = await userRepo.findById(userId);
  if (!userFromDb) throw new Error('User not found');

  return userFromDb;
};

exports.searchUser = async (keyword) => {
  const users = await this.listUsers();
  return users.filter(user =>
    user.name.toLowerCase().includes(keyword.toLowerCase())
  );
};

async function refreshUserCache() {
  const users = await userRepo.listUsers();
  const filtered = users.filter(user => user.role !== 'patient');
  await redis.set(USER_CACHE_KEY, JSON.stringify(filtered));
  console.log(`♻ User cache refreshed: ${filtered.length} users`);
}

exports.getUsersByRole = async (role) => {
  if (!role) throw new Error('Role is required');
  return await userRepo.getUsersByRole(role);
};


exports.refreshUserCache = refreshUserCache;

initUserCache().catch(err => console.error('❌ Failed to load user cache:', err));

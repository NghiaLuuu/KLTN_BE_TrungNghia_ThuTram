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

initUserCache().catch(err => console.error('❌ Failed to load user cache:', err));

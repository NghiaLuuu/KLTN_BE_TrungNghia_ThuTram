/**
 * ⚡ In-memory cache helper for frequently accessed data
 * Reduces Redis calls and improves performance
 */

const redisClient = require('./redis.client'); // ⚡ FIX: Correct path

// In-memory cache with TTL
const cache = {
  users: { data: null, timestamp: 0, ttl: 60000 }, // 1 minute
  rooms: { data: null, timestamp: 0, ttl: 60000 }  // 1 minute
};

/**
 * Get users from memory cache or Redis
 * @returns {Promise<Array>} Array of user objects
 */
async function getCachedUsers() {
  const now = Date.now();
  
  // Check memory cache first
  if (cache.users.data && (now - cache.users.timestamp) < cache.users.ttl) {
    return cache.users.data;
  }
  
  // Fetch from Redis
  const usersCache = await redisClient.get('users_cache');
  let users = usersCache ? JSON.parse(usersCache) : [];
  
  // If still empty, fetch from DB
  if (users.length === 0) {
    const User = require('../models/user.model');
    const usersFromDB = await User.find({ 
      role: { $in: ['dentist', 'nurse', 'admin', 'manager'] },
      isActive: true 
    }).select('_id name fullName employeeCode role').lean();
    
    users = usersFromDB.map(u => ({
      _id: u._id.toString(),
      name: u.name,
      fullName: u.fullName || u.name,
      employeeCode: u.employeeCode,
      role: u.role
    }));
  }
  
  // Update memory cache
  cache.users.data = users;
  cache.users.timestamp = now;
  
  return users;
}

/**
 * Get rooms from memory cache or Redis
 * @returns {Promise<Array>} Array of room objects
 */
async function getCachedRooms() {
  const now = Date.now();
  
  // Check memory cache first
  if (cache.rooms.data && (now - cache.rooms.timestamp) < cache.rooms.ttl) {
    return cache.rooms.data;
  }
  
  // Fetch from Redis
  const roomsCache = await redisClient.get('rooms_cache');
  let rooms = roomsCache ? JSON.parse(roomsCache) : [];
  
  // If still empty, fetch from DB
  if (rooms.length === 0) {
    const Room = require('../models/room.model');
    const roomsFromDB = await Room.find({ isActive: true }).lean();
    rooms = roomsFromDB.map(r => ({
      _id: r._id.toString(),
      name: r.name,
      hasSubRooms: r.hasSubRooms,
      subRooms: r.subRooms || []
    }));
  }
  
  // Update memory cache
  cache.rooms.data = rooms;
  cache.rooms.timestamp = now;
  
  return rooms;
}

/**
 * Clear memory cache (for testing or manual refresh)
 */
function clearCache() {
  cache.users.data = null;
  cache.users.timestamp = 0;
  cache.rooms.data = null;
  cache.rooms.timestamp = 0;
}

module.exports = {
  getCachedUsers,
  getCachedRooms,
  clearCache
};

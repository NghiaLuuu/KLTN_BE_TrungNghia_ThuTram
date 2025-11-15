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
 * ⚡ Uses auth-service's Redis cache (users_cache) - no direct DB query
 * @returns {Promise<Array>} Array of user objects from auth-service cache
 */
async function getCachedUsers() {
  const now = Date.now();
  
  // Check memory cache first
  if (cache.users.data && (now - cache.users.timestamp) < cache.users.ttl) {
    return cache.users.data;
  }
  
  // Fetch from Redis (auth-service maintains this cache)
  const usersCache = await redisClient.get('users_cache');
  let users = usersCache ? JSON.parse(usersCache) : [];
  
  // ⚠️ If Redis cache is empty, auth-service needs to refresh it
  // No fallback to direct DB query - rely on auth-service cache
  if (users.length === 0) {
    console.warn('⚠️ users_cache is empty in Redis. Auth-service should refresh the cache.');
    return [];
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
  
  // Fetch from Redis (room-service maintains this cache)
  const roomsCache = await redisClient.get('rooms_cache');
  let rooms = roomsCache ? JSON.parse(roomsCache) : [];
  
  // ⚠️ If Redis cache is empty, room-service needs to refresh it
  // No fallback to direct DB query - schedule-service shouldn't query room DB
  if (rooms.length === 0) {
    console.warn('⚠️ rooms_cache is empty in Redis. Room-service should refresh the cache.');
    return [];
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

/**
 * Filter users by criteria from cached users
 * @param {Object} criteria - Filter criteria
 * @param {Array|String} criteria.role - Role(s) to filter (string or array)
 * @param {Boolean} criteria.isActive - Active status filter
 * @param {String} criteria.excludeId - User ID to exclude
 * @param {Array} criteria.fields - Fields to select (default: all)
 * @returns {Promise<Array>} Filtered user array
 */
async function filterCachedUsers(criteria = {}) {
  const allUsers = await getCachedUsers();
  
  let filtered = allUsers;
  
  // Filter by role
  if (criteria.role) {
    const roles = Array.isArray(criteria.role) ? criteria.role : [criteria.role];
    filtered = filtered.filter(u => roles.includes(u.role));
  }
  
  // Filter by isActive
  if (criteria.isActive !== undefined) {
    filtered = filtered.filter(u => u.isActive === criteria.isActive);
  }
  
  // Exclude specific user ID
  if (criteria.excludeId) {
    filtered = filtered.filter(u => u._id.toString() !== criteria.excludeId.toString());
  }
  
  // ⚡ Map fullName to firstName/lastName for compatibility
  // Auth-service uses fullName, but some code expects firstName/lastName
  filtered = filtered.map(u => {
    const userCopy = { ...u };
    
    // If firstName/lastName are requested but don't exist, derive from fullName
    if (criteria.fields && (criteria.fields.includes('firstName') || criteria.fields.includes('lastName'))) {
      if (!userCopy.firstName || !userCopy.lastName) {
        const nameParts = (userCopy.fullName || '').trim().split(' ');
        userCopy.firstName = nameParts.length > 0 ? nameParts[0] : '';
        userCopy.lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
      }
    }
    
    return userCopy;
  });
  
  // Select specific fields
  if (criteria.fields && criteria.fields.length > 0) {
    filtered = filtered.map(u => {
      const selected = {};
      criteria.fields.forEach(field => {
        if (u[field] !== undefined) {
          selected[field] = u[field];
        }
      });
      return selected;
    });
  }
  
  return filtered;
}

module.exports = {
  getCachedUsers,
  getCachedRooms,
  clearCache,
  filterCachedUsers
};

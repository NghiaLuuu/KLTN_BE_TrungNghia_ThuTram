/**
 * ⚡ In-memory cache helper for frequently accessed data
 * Redis cache layer removed - now calling APIs directly with memory cache
 */

const { sendRpcRequest } = require('./rabbitmq.client'); // ⚡ Import for API calls

// In-memory cache with TTL
const cache = {
  users: { data: null, timestamp: 0, ttl: 60000 }, // 1 minute
  rooms: { data: null, timestamp: 0, ttl: 60000 }  // 1 minute
};

/**
 * Get users directly from auth-service API with memory cache
 * Redis cache layer removed - calling API directly
 * @returns {Promise<Array>} Array of user objects
 */
async function getCachedUsers() {
  const now = Date.now();
  
  // 1️⃣ Check memory cache first (fastest)
  if (cache.users.data && (now - cache.users.timestamp) < cache.users.ttl) {
    return cache.users.data;
  }
  
  // 2️⃣ Call auth-service API directly (Redis cache layer removed)
  try {
    const { sendRpcRequest } = require('./rabbitmq.client');
    const usersData = await sendRpcRequest('auth_queue', {
      action: 'getAllUsers'
    }, 5000);
    
    if (usersData && usersData.success && Array.isArray(usersData.data)) {
      // Update memory cache
      cache.users.data = usersData.data;
      cache.users.timestamp = now;
      
      return usersData.data;
    } else {
      console.error('❌ Invalid response from auth-service:', usersData);
      return [];
    }
  } catch (apiError) {
    console.error('❌ Cannot get users from auth-service:', apiError.message);
    return [];
  }
}

/**
 * Get rooms directly from room-service API with memory cache
 * Redis cache layer removed - calling API directly
 * @returns {Promise<Array>} Array of room objects
 */
async function getCachedRooms() {
  const now = Date.now();
  
  // 1️⃣ Check memory cache first (fastest)
  if (cache.rooms.data && (now - cache.rooms.timestamp) < cache.rooms.ttl) {
    return cache.rooms.data;
  }
  
  // 2️⃣ Call room-service API directly (Redis cache layer removed)
  try {
    const { sendRpcRequest } = require('./rabbitmq.client');
    const roomsData = await sendRpcRequest('room_queue', {
      action: 'getAllRooms'
    }, 5000);
    
    if (roomsData && roomsData.success && Array.isArray(roomsData.data)) {
      // Update memory cache
      cache.rooms.data = roomsData.data;
      cache.rooms.timestamp = now;
      
      return roomsData.data;
    } else {
      console.error('❌ Invalid response from room-service:', roomsData);
      return [];
    }
  } catch (apiError) {
    console.error('❌ Cannot get rooms from room-service:', apiError.message);
    return [];
  }
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

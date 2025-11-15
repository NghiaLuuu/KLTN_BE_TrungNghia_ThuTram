const RPCClient = require('../config/rpc.config');

/**
 * Fetch user information from auth-service via RPC
 * @param {Array<string>} userIds - Array of user IDs to fetch
 * @returns {Map<string, Object>} Map of userId to user info
 */
async function getUsersInfo(userIds) {
  if (!userIds || userIds.length === 0) {
    return new Map();
  }

  console.log(`🔍 [userHelper] Fetching info for ${userIds.length} users:`, userIds);

  try {
    // OPTION 1: Try using existing RPC client if connected
    if (RPCClient.isConnected) {
      console.log(`📤 [userHelper] Using existing RPC client`);
      try {
        // This won't work because RPCClient sends {method, params} but auth needs {action, payload}
        // So we fall through to direct connection below
        throw new Error('Need direct connection for auth-service format');
      } catch (rpcError) {
        console.log(`⚠️ [userHelper] RPC client incompatible, using direct connection`);
      }
    }
    
    // OPTION 2: Create direct RabbitMQ connection
    const amqp = require('amqplib');
    
    console.log(`🔌 [userHelper] Creating direct RabbitMQ connection to:`, process.env.RABBITMQ_URL);
    
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
    const channel = await connection.createChannel();
    const replyQueue = await channel.assertQueue('', { exclusive: true });
    
    const correlationId = `${Date.now()}.${Math.random()}`;
    
    // Auth-service expects { action, payload } format
    const message = JSON.stringify({
      action: 'getUsersByIds',
      payload: { userIds }
    });
    
    console.log(`📤 [userHelper] Sending RPC request to auth_queue with ${userIds.length} IDs`);
    
    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('❌ [userHelper] RPC timeout after 10s');
        channel.close();
        connection.close();
        reject(new Error('RPC timeout'));
      }, 10000);
      
      channel.consume(replyQueue.queue, (msg) => {
        if (msg && msg.properties.correlationId === correlationId) {
          clearTimeout(timeout);
          const response = JSON.parse(msg.content.toString());
          channel.close();
          connection.close();
          resolve(response);
        }
      }, { noAck: true });
    });
    
    channel.sendToQueue('auth_queue', Buffer.from(message), {
      correlationId,
      replyTo: replyQueue.queue
    });
    
    const users = await responsePromise;
    
    console.log(`✅ [userHelper] Received response:`, users ? `${Array.isArray(users) ? users.length : 'non-array'} users` : 'null');
    
    // Create map of userId -> user info
    const userMap = new Map();
    if (users && Array.isArray(users)) {
      users.forEach(user => {
        userMap.set(user._id.toString(), {
          fullName: user.fullName || user.name || 'N/A',
          employeeCode: user.employeeCode || null,
          email: user.email || null,
          phone: user.phone || null,
          roles: user.roles || []
        });
      });
      console.log(`📋 [userHelper] Created map with ${userMap.size} users`);
    } else {
      console.warn('⚠️ [userHelper] Invalid response format:', typeof users);
    }
    
    return userMap;
  } catch (error) {
    console.error('❌ Error fetching users from auth-service:', error.message);
    console.error('Stack:', error.stack);
    return new Map();
  }
}

/**
 * Get display name for dentist (fullName + employeeCode)
 * @param {Object} userInfo - User info object
 * @returns {string} Display name
 */
function getDentistDisplayName(userInfo) {
  if (!userInfo) return 'N/A';
  
  const name = userInfo.fullName || 'Nha sỹ';
  const code = userInfo.employeeCode;
  
  return code ? `${name} (${code})` : name;
}

/**
 * Enrich dentist data with names from auth-service
 * @param {Array<Object>} dentistStats - Array of dentist statistics
 * @returns {Array<Object>} Enriched data with dentist names
 */
async function enrichDentistData(dentistStats) {
  console.log('\n========== ENRICH DENTIST DATA ==========');
  
  if (!dentistStats || dentistStats.length === 0) {
    console.log('⚠️ [enrichDentistData] No dentist stats to enrich');
    return [];
  }

  console.log(`🔄 [enrichDentistData] Enriching ${dentistStats.length} dentist records`);
  console.log(`📋 [enrichDentistData] Input data:`, JSON.stringify(dentistStats, null, 2));

  // Extract dentist IDs
  const dentistIds = dentistStats.map(item => item.dentistId.toString()).filter(Boolean);
  
  console.log(`📋 [enrichDentistData] Dentist IDs:`, dentistIds);
  
  // Fetch user info
  let userMap;
  try {
    userMap = await getUsersInfo(dentistIds);
  } catch (error) {
    console.error('❌ [enrichDentistData] Failed to fetch user info, using fallback names:', error.message);
    userMap = new Map(); // Empty map, will use fallback
  }
  
  // Enrich data
  const enriched = dentistStats.map(item => {
    const userInfo = userMap.get(item.dentistId.toString());
    let displayName;
    
    if (userInfo && userInfo.fullName) {
      // Use real name with employee code
      displayName = getDentistDisplayName(userInfo);
      console.log(`👤 [enrichDentistData] ${item.dentistId} → ${displayName} (from auth-service)`);
    } else {
      // Fallback to ID-based name
      displayName = `Nha sỹ ${item.dentistId.toString().slice(-4)}`;
      console.warn(`⚠️ [enrichDentistData] ${item.dentistId} → ${displayName} (FALLBACK - no user info)`);
    }
    
    return {
      ...item,
      dentistName: displayName,
      dentistFullName: userInfo?.fullName || 'N/A',
      dentistEmployeeCode: userInfo?.employeeCode || null
    };
  });
  
  console.log(`✅ [enrichDentistData] Enriched ${enriched.length} records`);
  console.log(`📋 [enrichDentistData] Output data:`, JSON.stringify(enriched, null, 2));
  console.log('========================================\n');
  
  return enriched;
}

module.exports = {
  getUsersInfo,
  getDentistDisplayName,
  enrichDentistData
};

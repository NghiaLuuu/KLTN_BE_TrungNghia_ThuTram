/**
 * Multi-Database Connection Manager
 * Manages connections to different microservice databases
 */
const mongoose = require('mongoose');

// Store database connections
const connections = {};

/**
 * Collection to Database mapping
 * Defines which collection belongs to which microservice database
 */
const COLLECTION_DB_MAP = {
  users: 'auth',       // auth-service database
  services: 'service', // service-service database
  slots: 'schedule',   // schedule-service database
  rooms: 'room'        // room-service database
};

/**
 * Get database URI for a specific microservice
 */
function getDatabaseURI(serviceName) {
  const uriMap = {
    auth: process.env.AUTH_DB_URI,
    service: process.env.SERVICE_DB_URI,
    schedule: process.env.SCHEDULE_DB_URI,
    room: process.env.ROOM_DB_URI
  };

  const uri = uriMap[serviceName];
  if (!uri) {
    throw new Error(`No database URI found for service: ${serviceName}`);
  }
  return uri;
}

/**
 * Get or create connection to a specific microservice database
 */
async function getConnection(serviceName) {
  // Return existing connection if already created
  if (connections[serviceName]) {
    return connections[serviceName];
  }

  // Create new connection
  const uri = getDatabaseURI(serviceName);
  console.log(`🔗 Creating connection to ${serviceName} database...`);
  
  const connection = mongoose.createConnection(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000
  });

  // Wait for connection to be ready
  await new Promise((resolve, reject) => {
    connection.once('open', resolve);
    connection.once('error', reject);
  });

  console.log(`✅ Connected to ${serviceName} database`);
  connections[serviceName] = connection;
  return connection;
}

/**
 * Get connection for a specific collection
 */
async function getConnectionForCollection(collectionName) {
  const serviceName = COLLECTION_DB_MAP[collectionName];
  
  if (!serviceName) {
    throw new Error(`No database mapping found for collection: ${collectionName}`);
  }

  return await getConnection(serviceName);
}

/**
 * Close all database connections
 */
async function closeAllConnections() {
  const serviceNames = Object.keys(connections);
  console.log(`🔌 Closing ${serviceNames.length} database connections...`);
  
  for (const serviceName of serviceNames) {
    await connections[serviceName].close();
    console.log(`✅ Closed ${serviceName} connection`);
  }
  
  // Clear connections object
  Object.keys(connections).forEach(key => delete connections[key]);
}

/**
 * Get all registered models for schema extraction
 */
function getRegisteredModels() {
  const models = {};
  
  for (const [serviceName, connection] of Object.entries(connections)) {
    const serviceModels = connection.models;
    for (const [modelName, model] of Object.entries(serviceModels)) {
      models[modelName] = model;
    }
  }
  
  return models;
}

module.exports = {
  COLLECTION_DB_MAP,
  getDatabaseURI,
  getConnection,
  getConnectionForCollection,
  closeAllConnections,
  getRegisteredModels
};

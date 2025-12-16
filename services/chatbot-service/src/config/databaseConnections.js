/**
 * Quản lý kết nối đa cơ sở dữ liệu
 * Quản lý các kết nối đến các database của các microservice khác nhau
 */
const mongoose = require('mongoose');

// Lưu trữ các kết nối database
const connections = {};

/**
 * Ánh xạ Collection sang Database
 * Xác định collection nào thuộc database của microservice nào
 */
const COLLECTION_DB_MAP = {
  users: 'auth',       // database auth-service
  services: 'service', // database service-service
  slots: 'schedule',   // database schedule-service
  rooms: 'room'        // database room-service
};

/**
 * Lấy URI database cho microservice cụ thể
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
 * Lấy hoặc tạo kết nối đến database của microservice cụ thể
 */
async function getConnection(serviceName) {
  // Trả về kết nối hiện có nếu đã được tạo
  if (connections[serviceName]) {
    return connections[serviceName];
  }

  // Tạo kết nối mới
  const uri = getDatabaseURI(serviceName);
  console.log(`🔗 Đang tạo kết nối đến database ${serviceName}...`);
  
  const connection = mongoose.createConnection(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000
  });

  // Đợi kết nối sẵn sàng
  await new Promise((resolve, reject) => {
    connection.once('open', resolve);
    connection.once('error', reject);
  });

  console.log(`✅ Đã kết nối đến database ${serviceName}`);
  connections[serviceName] = connection;
  return connection;
}

/**
 * Lấy kết nối cho collection cụ thể
 */
async function getConnectionForCollection(collectionName) {
  const serviceName = COLLECTION_DB_MAP[collectionName];
  
  if (!serviceName) {
    throw new Error(`No database mapping found for collection: ${collectionName}`);
  }

  return await getConnection(serviceName);
}

/**
 * Đóng tất cả kết nối database
 */
async function closeAllConnections() {
  const serviceNames = Object.keys(connections);
  console.log(`🔌 Đang đóng ${serviceNames.length} kết nối database...`);
  
  for (const serviceName of serviceNames) {
    await connections[serviceName].close();
    console.log(`✅ Đã đóng kết nối ${serviceName}`);
  }
  
  // Xóa object connections
  Object.keys(connections).forEach(key => delete connections[key]);
}

/**
 * Lấy tất cả model đã đăng ký để trích xuất schema
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

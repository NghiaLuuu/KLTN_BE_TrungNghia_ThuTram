/**
 * 🗄️ Database Models Registry
 * 
 * Load all Mongoose models from other services' schemas
 * This allows Query Engine to understand database structure
 * 
 * NOW: Register models to CORRECT database connections!
 */

const mongoose = require('mongoose');
const { getConnection } = require('../config/databaseConnections');

/**
 * Register Slot model (from schedule-service)
 */
async function registerSlotModel() {
  const connection = await getConnection('schedule');
  if (connection.models.Slot) return connection.models.Slot;

  const slotSchema = new mongoose.Schema({
    date: {
      type: String,
      required: true,
      description: 'Ngày khám (YYYY-MM-DD)'
    },
    startTime: {
      type: String,
      required: true,
      description: 'Giờ bắt đầu (HH:mm)'
    },
    endTime: {
      type: String,
      required: true,
      description: 'Giờ kết thúc (HH:mm)'
    },
    dentistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      description: 'ID Nha sĩ'
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      description: 'ID phòng khám'
    },
    roomType: {
      type: String,
      enum: ['EXAM', 'SURGERY', 'X_RAY'],
      description: 'Loại phòng'
    },
    isAvailable: {
      type: Boolean,
      default: true,
      description: 'Còn trống không'
    },
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      description: 'ID cuộc hẹn (nếu đã đặt)'
    }
  }, { collection: 'slots' });

  return connection.model('Slot', slotSchema);
}

/**
 * Register Room model (from room-service)
 */
async function registerRoomModel() {
  const connection = await getConnection('room');
  if (connection.models.Room) return connection.models.Room;

  const roomSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      description: 'Tên phòng'
    },
    roomType: {
      type: String,
      enum: ['EXAM', 'SURGERY', 'X_RAY', 'WAITING'],
      required: true,
      description: 'Loại phòng'
    },
    floor: {
      type: Number,
      description: 'Tầng'
    },
    capacity: {
      type: Number,
      description: 'Sức chứa'
    },
    isActive: {
      type: Boolean,
      default: true,
      description: 'Đang hoạt động'
    },
    hasSubRooms: {
      type: Boolean,
      default: false,
      description: 'Có phòng con không'
    },
    subRooms: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      description: 'Danh sách phòng con'
    }]
  }, { collection: 'rooms' });

  return connection.model('Room', roomSchema);
}

/**
 * Register Service model (from service-service)
 */
async function registerServiceModel() {
  const connection = await getConnection('service');
  if (connection.models.Service) return connection.models.Service;

  const serviceSchema = new mongoose.Schema({
    name: {
      type: String,
      required: true,
      description: 'Tên dịch vụ'
    },
    category: {
      type: String,
      description: 'Danh mục'
    },
    description: {
      type: String,
      description: 'Mô tả'
    },
    basePrice: {
      type: Number,
      description: 'Giá cơ bản'
    },
    duration: {
      type: Number,
      description: 'Thời gian thực hiện (phút)'
    },
    isActive: {
      type: Boolean,
      default: true,
      description: 'Đang hoạt động'
    },
    serviceAddOns: [{
      name: String,
      description: String,
      effectivePrice: Number,
      duration: Number
    }]
  }, { collection: 'services' });

  return connection.model('Service', serviceSchema);
}

/**
 * Register User model (from auth-service)
 */
async function registerUserModel() {
  const connection = await getConnection('auth');
  if (connection.models.User) return connection.models.User;

  const userSchema = new mongoose.Schema({
    fullName: {
      type: String,
      required: true,
      description: 'Họ và tên'
    },
    email: {
      type: String,
      required: true,
      unique: true,
      description: 'Email'
    },
    phone: {
      type: String,
      description: 'Số điện thoại'
    },
    roles: [{
      type: String,
      enum: ['ADMIN', 'DENTIST', 'MANAGER', 'RECEPTIONIST', 'CUSTOMER'],
      description: 'Vai trò'
    }],
    specialization: {
      type: String,
      description: 'Chuyên môn (cho Nha sĩ)'
    },
    experience: {
      type: Number,
      description: 'Số năm kinh nghiệm'
    },
    isActive: {
      type: Boolean,
      default: true,
      description: 'Tài khoản đang hoạt động'
    }
  }, { collection: 'users' });

  return connection.model('User', userSchema);
}

/**
 * Register all models at once (NOW ASYNC!)
 */
async function registerAllModels() {
  console.log('📦 Registering database models for Query Engine...');
  
  const models = {
    Slot: await registerSlotModel(),
    Room: await registerRoomModel(),
    Service: await registerServiceModel(),
    User: await registerUserModel()
  };

  console.log(`✅ Registered ${Object.keys(models).length} models: ${Object.keys(models).join(', ')}`);
  return models;
}

module.exports = {
  registerSlotModel,
  registerRoomModel,
  registerServiceModel,
  registerUserModel,
  registerAllModels
};

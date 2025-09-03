const roomRepo = require('../repositories/room.repository');
const redis = require('../utils/redis.client');

const ROOM_CACHE_KEY = 'rooms_cache';

async function initRoomCache() {
  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  console.log(`✅ Đã tải bộ nhớ đệm phòng: ${rooms.length} phòng`);
}

exports.createRoom = async (data) => {
  const room = await roomRepo.createRoom(data);
  await refreshRoomCache();
  return room;
};

exports.updateRoom = async (roomId, data) => {
  const updated = await roomRepo.updateRoom(roomId, data);
  await refreshRoomCache();
  return updated;
};

exports.toggleStatus = async (roomId) => {
  const toggled = await roomRepo.toggleStatus(roomId);
  await refreshRoomCache();
  return toggled;
};

exports.listRooms = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [rooms, total] = await Promise.all([
    roomRepo.listRooms(skip, limit),
    roomRepo.countRooms()
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    rooms
  };
};

exports.searchRoom = async (keyword, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [rooms, total] = await Promise.all([
    roomRepo.searchRoom(keyword, skip, limit),
    roomRepo.countSearchRoom(keyword)
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    rooms
  };
};

async function refreshRoomCache() {
  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  console.log(`♻ Đã làm mới bộ nhớ đệm phòng: ${rooms.length} phòng`);
}

initRoomCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm phòng:', err));

const roomRepo = require('../repositories/room.repository');
const redis = require('../utils/redis.client');

const ROOM_CACHE_KEY = 'rooms_cache';

async function initRoomCache() {
  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  console.log(`✅ Room cache loaded: ${rooms.length} rooms`);
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

exports.listRooms = async () => {
  let cached = await redis.get(ROOM_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  return rooms;
};

exports.searchRoom = async (keyword) => {
  const rooms = await this.listRooms();
  return rooms.filter(room =>
    room.name.toLowerCase().includes(keyword.toLowerCase())
  );
};

async function refreshRoomCache() {
  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  console.log(`♻ Room cache refreshed: ${rooms.length} rooms`);
}

initRoomCache().catch(err => console.error('❌ Failed to load room cache:', err));

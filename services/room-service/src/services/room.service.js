const roomRepo = require('../repositories/room.repository');
const redis = require('../utils/redis.client');
const {publishToQueue} = require('../utils/rabbitClient')
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

exports.updateRoom = async (roomId, updateData) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  // Lưu danh sách subRooms cũ để so sánh
  const oldSubRooms = room.subRooms.map(sr => sr._id.toString());

  // Update field
  if (updateData.name) room.name = updateData.name;
  if (updateData.isActive !== undefined) room.isActive = updateData.isActive;

  // Update subRooms
  if (Array.isArray(updateData.subRooms)) {
    for (const subUpdate of updateData.subRooms) {
      let subRoom = null;

      if (subUpdate._id) {
        subRoom = room.subRooms.id(subUpdate._id);
      }

      if (!subRoom && subUpdate.name) {
        subRoom = room.subRooms.find(sr => sr.name === subUpdate.name);
      }

      if (subRoom) {
        subRoom.name = subUpdate.name || subRoom.name;
        subRoom.maxDoctors = subUpdate.maxDoctors ?? subRoom.maxDoctors;
        subRoom.maxNurses = subUpdate.maxNurses ?? subRoom.maxNurses;
      } else {
        room.subRooms.push(subUpdate);
      }
    }
  }

  await room.save();

  // So sánh danh sách mới và cũ
  const newSubRooms = room.subRooms.map(sr => sr._id.toString());
  const added = newSubRooms.filter(id => !oldSubRooms.includes(id));

  // 🔹 Nếu có subRoom mới → gửi event 1 lần với mảng subRoomIds
  if (added.length > 0) {
    try {
      await publishToQueue('schedule_queue', {
        action: 'subRoomAdded',
        payload: {
          roomId: room._id.toString(),
          subRoomIds: added
        }
      });
      console.log(`📤 Đã gửi sự kiện subRoomAdded cho room ${room._id}, subRooms: ${added.join(', ')}`);
    } catch (err) {
      console.error('❌ Gửi sự kiện subRoomAdded thất bại:', err.message);
    }
  }

  return room;
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

exports.getRoomWithSubRooms = async (roomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  return room; // trả về cả room object, đã bao gồm mảng subRooms
};

async function refreshRoomCache() {
  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  console.log(`♻ Đã làm mới bộ nhớ đệm phòng: ${rooms.length} phòng`);
}

initRoomCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm phòng:', err));

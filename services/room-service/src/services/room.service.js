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
  // Tách subRoomCount khỏi data chính
  const { subRoomCount, ...roomData } = data;
  
  // Tạo room trước
  const room = await roomRepo.createRoom(roomData);
  
  // Nếu có yêu cầu tạo subroom
  if (subRoomCount && subRoomCount > 0) {
    if (subRoomCount > 20) {
      throw new Error('Số lượng buồng con không được vượt quá 20');
    }
    
    // Xóa maxDoctors/maxNurses nếu có subroom
    if (room.maxDoctors || room.maxNurses) {
      room.maxDoctors = undefined;
      room.maxNurses = undefined;
    }
    
    // Tạo các subroom
    for (let i = 1; i <= subRoomCount; i++) {
      room.subRooms.push({
        name: `Buồng ${i}`,
        isActive: true
      });
    }
    
    await room.save();
    
    // Gửi event cho schedule service
    if (room.subRooms.length > 0) {
      try {
        const subRoomIds = room.subRooms.map(sr => sr._id.toString());
        await publishToQueue('schedule_queue', {
          action: 'subRoomAdded',
          payload: {
            roomId: room._id.toString(),
            subRoomIds: subRoomIds
          }
        });
        console.log(`📤 Đã gửi sự kiện subRoomAdded cho ${subRoomCount} buồng mới`);
      } catch (err) {
        console.error('❌ Gửi sự kiện subRoomAdded thất bại:', err.message);
      }
    }
  }
  
  await refreshRoomCache();
  return room;
};

exports.updateRoom = async (roomId, updateData) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  // Lưu danh sách subRooms cũ để so sánh
  const oldSubRooms = room.subRooms.map(sr => sr._id.toString());

  // Update basic fields
  if (updateData.name) room.name = updateData.name;
  if (updateData.isActive !== undefined) room.isActive = updateData.isActive;
  
  // Update maxDoctors/maxNurses chỉ khi không có subrooms
  if (room.subRooms.length === 0) {
    if (updateData.maxDoctors !== undefined) room.maxDoctors = updateData.maxDoctors;
    if (updateData.maxNurses !== undefined) room.maxNurses = updateData.maxNurses;
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

  await refreshRoomCache();
  return room;
};




exports.toggleStatus = async (roomId) => {
  const toggled = await roomRepo.toggleStatus(roomId);
  await refreshRoomCache();
  return toggled;
};

// Xóa room (kiểm tra đã sử dụng chưa)
exports.deleteRoom = async (roomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  // TODO: Kiểm tra room có đang được sử dụng không
  // Cần gọi API tới schedule-service để kiểm tra
  throw new Error("Chức năng xóa phòng chưa được implement - cần kiểm tra với schedule-service trước");
  
  // Code sẽ được implement sau khi có schedule-service:
  // const isInUse = await checkRoomUsage(roomId);
  // if (isInUse) {
  //   throw new Error("Không thể xóa phòng đang được sử dụng");
  // }
  
  // await roomRepo.deleteRoom(roomId);
  // await refreshRoomCache();
  // return { message: "Đã xóa phòng thành công" };
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

exports.getSubRoomById = async (subRoomId) => {
  const room = await roomRepo.findRoomBySubRoomId(subRoomId);
  if (!room) throw new Error("Không tìm thấy phòng chứa subRoom này");

  const subRoom = room.subRooms.id(subRoomId);
  if (!subRoom) throw new Error("Không tìm thấy subRoom");

  return {
    room
  };
};

exports.toggleSubRoomStatus = async (roomId, subRoomId) => {
  const toggledRoom = await roomRepo.toggleSubRoomStatus(roomId, subRoomId);
  await refreshRoomCache();
  return toggledRoom;
};

// Tạo subroom tự động với tên "Buồng X"
exports.addSubRoom = async (roomId, count = 1) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  // Nếu có maxDoctors/maxNurses thì xóa khi thêm subroom
  if (room.maxDoctors || room.maxNurses) {
    room.maxDoctors = undefined;
    room.maxNurses = undefined;
  }

  // Tìm số buồng lớn nhất hiện tại
  let maxNumber = 0;
  room.subRooms.forEach(sr => {
    const match = sr.name.match(/^Buồng (\d+)$/);
    if (match) {
      maxNumber = Math.max(maxNumber, parseInt(match[1]));
    }
  });

  // Thêm các buồng mới
  const newSubRooms = [];
  for (let i = 1; i <= count; i++) {
    const newNumber = maxNumber + i;
    const newSubRoom = {
      name: `Buồng ${newNumber}`,
      isActive: true
    };
    room.subRooms.push(newSubRoom);
    newSubRooms.push(newSubRoom);
  }

  await room.save();
  
  // Gửi event cho schedule service
  try {
    const addedIds = newSubRooms.map(sr => room.subRooms[room.subRooms.length - count + newSubRooms.indexOf(sr)]._id.toString());
    await publishToQueue('schedule_queue', {
      action: 'subRoomAdded',
      payload: {
        roomId: room._id.toString(),
        subRoomIds: addedIds
      }
    });
    console.log(`📤 Đã gửi sự kiện subRoomAdded cho ${count} buồng mới`);
  } catch (err) {
    console.error('❌ Gửi sự kiện subRoomAdded thất bại:', err.message);
  }

  await refreshRoomCache();
  return room;
};

// Xóa subroom (kiểm tra chưa sử dụng)
exports.deleteSubRoom = async (roomId, subRoomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  const subRoom = room.subRooms.id(subRoomId);
  if (!subRoom) throw new Error("Không tìm thấy buồng");

  // TODO: Kiểm tra subroom có đang được sử dụng không
  // Cần gọi API tới schedule-service để kiểm tra
  throw new Error("Chức năng xóa buồng chưa được implement - cần kiểm tra với schedule-service trước");
  
  // Code sẽ được implement sau khi có schedule-service:
  // const isInUse = await checkSubRoomUsage(subRoomId);
  // if (isInUse) {
  //   throw new Error("Không thể xóa buồng đang được sử dụng");
  // }
  
  // // Xóa subroom
  // room.subRooms.pull(subRoomId);
  
  // // Nếu không còn subroom nào thì có thể set lại maxDoctors/maxNurses
  // if (room.subRooms.length === 0) {
  //   // Có thể set default values hoặc để undefined
  // }

  // await room.save();

  // // Gửi event xóa subroom
  // try {
  //   await publishToQueue('schedule_queue', {
  //     action: 'subRoomDeleted',
  //     payload: {
  //       roomId: room._id.toString(),
  //       subRoomId: subRoomId
  //     }
  //   });
  //   console.log(`📤 Đã gửi sự kiện subRoomDeleted cho subRoom ${subRoomId}`);
  // } catch (err) {
  //   console.error('❌ Gửi sự kiện subRoomDeleted thất bại:', err.message);
  // }

  // await refreshRoomCache();
  // return room;
};


async function refreshRoomCache() {
  const rooms = await roomRepo.listRooms();
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms));
  console.log(`♻ Đã làm mới bộ nhớ đệm phòng: ${rooms.length} phòng`);
}

initRoomCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm phòng:', err));

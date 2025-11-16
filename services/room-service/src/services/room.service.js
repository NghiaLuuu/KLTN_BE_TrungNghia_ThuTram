const roomRepo = require('../repositories/room.repository');
const redis = require('../utils/redis.client');
const {publishToQueue, sendRpcRequest} = require('../utils/rabbitClient')
const ROOM_CACHE_KEY = 'rooms_cache';

async function initRoomCache() {
  const rooms = await roomRepo.getAllRooms();
  // Set cache với TTL 1 giờ (3600s) để tránh bị evict nhưng vẫn auto-refresh
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms), { EX: 3600 });
  console.log(`✅ Đã tải bộ nhớ đệm phòng: ${rooms.length} phòng (TTL: 1h)`);
}

// 🆕 Helper: Tự động cập nhật isActive của room dựa trên trạng thái subrooms
async function updateRoomActiveStatusBasedOnSubRooms(room) {
  // Chỉ áp dụng cho room có subrooms
  if (!room.hasSubRooms || !room.subRooms || room.subRooms.length === 0) {
    return;
  }

  // Kiểm tra có ít nhất 1 subroom active không
  const hasActiveSubRoom = room.subRooms.some(subRoom => subRoom.isActive === true);

  // Cập nhật isActive của room
  const oldStatus = room.isActive;
  room.isActive = hasActiveSubRoom;

  // Chỉ save nếu có thay đổi
  if (oldStatus !== room.isActive) {
    await room.save();
    console.log(`🔄 Room ${room.name} (${room._id}): isActive changed from ${oldStatus} to ${room.isActive}`);
    console.log(`   Reason: ${hasActiveSubRoom ? 'Có ít nhất 1 subroom active' : 'Tất cả subrooms đều inactive'}`);
  }
}

async function refreshRoomCache() {
  const rooms = await roomRepo.getAllRooms();
  // Set cache với TTL 1 giờ
  await redis.set(ROOM_CACHE_KEY, JSON.stringify(rooms), { EX: 3600 });
  console.log(`♻ Đã làm mới bộ nhớ đệm phòng: ${rooms.length} phòng (TTL: 1h)`);
}

exports.createRoom = async (data) => {
  const { subRoomCount, ...roomData } = data;

  // Validate roomType
  if (!roomData.roomType) {
    throw new Error('roomType là bắt buộc');
  }

  // Nếu có subRooms
  if (subRoomCount && subRoomCount > 0) {
    

    roomData.hasSubRooms = true;

    // Xóa maxDoctors/maxNurses nếu truyền nhầm
    delete roomData.maxDoctors;
    delete roomData.maxNurses;

    // Tạo luôn subRooms trước khi create để qua validation
    roomData.subRooms = Array.from({ length: subRoomCount }, (_, i) => ({
      name: `Buồng ${i + 1}`,
      isActive: true
    }));

    const room = await roomRepo.createRoom(roomData);

    // ❌ KHÔNG gửi event tạo lịch tự động nữa
    // Lịch sẽ được tạo thủ công từ giao diện Schedule Management

    await refreshRoomCache();
    return room;
  }

  // Nếu không có subRooms
  roomData.hasSubRooms = false;

  // Kiểm tra maxDoctors và maxNurses phải được cung cấp (cho phép giá trị 0)
  if (roomData.maxDoctors === undefined || roomData.maxDoctors === null || 
      roomData.maxNurses === undefined || roomData.maxNurses === null) {
    throw new Error('Phòng không có buồng con phải có maxDoctors và maxNurses');
  }

  delete roomData.subRooms;

  const room = await roomRepo.createRoom(roomData);
  
  // ❌ KHÔNG gửi event tạo lịch tự động nữa
  // Lịch sẽ được tạo thủ công từ giao diện Schedule Management

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
  if (updateData.roomType) room.roomType = updateData.roomType;
  if (updateData.isActive !== undefined) room.isActive = updateData.isActive;
  
  // Kiểm tra xem có thay đổi loại phòng không
  if (updateData.hasSubRooms !== undefined && updateData.hasSubRooms !== room.hasSubRooms) {
    // Thay đổi loại phòng
    if (updateData.hasSubRooms) {
      // Chuyển từ phòng thường -> phòng có subrooms
      room.hasSubRooms = true;
      room.maxDoctors = undefined;
      room.maxNurses = undefined;
      
      // Nếu không có subrooms thì tạo ít nhất 1
      if (!room.subRooms || room.subRooms.length === 0) {
        room.subRooms = [{
          name: 'Buồng 1',
          isActive: true
        }];
      }
    } else {
      // Chuyển từ phòng có subrooms -> phòng thường
      room.hasSubRooms = false;
      room.subRooms = [];
      
      // Phải có maxDoctors và maxNurses (cho phép giá trị 0)
      if (updateData.maxDoctors === undefined || updateData.maxDoctors === null ||
          updateData.maxNurses === undefined || updateData.maxNurses === null) {
        throw new Error('Phòng không có buồng con phải có maxDoctors và maxNurses');
      }
      room.maxDoctors = updateData.maxDoctors;
      room.maxNurses = updateData.maxNurses;
    }
  } else {
    // Không thay đổi loại phòng, chỉ update theo loại hiện tại
    if (room.hasSubRooms) {
      // Phòng có subrooms: không được update maxDoctors/maxNurses
      if (updateData.maxDoctors !== undefined || updateData.maxNurses !== undefined) {
        throw new Error('Phòng có buồng con không được cập nhật maxDoctors hoặc maxNurses');
      }
    } else {
      // Phòng thường: có thể update maxDoctors/maxNurses
      if (updateData.maxDoctors !== undefined) room.maxDoctors = updateData.maxDoctors;
      if (updateData.maxNurses !== undefined) room.maxNurses = updateData.maxNurses;
      
      // Không được update subRooms
      if (updateData.subRooms !== undefined) {
        throw new Error('Phòng không có buồng con không được cập nhật subRooms');
      }
    }
  }

  await room.save();

  // So sánh danh sách subRooms mới và cũ (chỉ khi có subrooms)
  if (room.hasSubRooms) {
    const newSubRooms = room.subRooms.map(sr => sr._id.toString());
    const added = newSubRooms.filter(id => !oldSubRooms.includes(id));

    // Nếu có subRoom mới → gửi event
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
  }

  await refreshRoomCache();
  return room;
};

exports.toggleStatus = async (roomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");
  
  // 🆕 Validation: Nếu room có subrooms và đang tắt, muốn bật lại phải có ít nhất 1 subroom active
  if (!room.isActive && room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    const hasActiveSubRoom = room.subRooms.some(subRoom => subRoom.isActive === true);
    
    if (!hasActiveSubRoom) {
      throw new Error("Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. Vui lòng bật ít nhất 1 buồng trước.");
    }
  }
  
  const toggled = await roomRepo.toggleStatus(roomId);
  await refreshRoomCache();
  return toggled;
};

// Xóa room (kiểm tra đã sử dụng chưa)
exports.deleteRoom = async (roomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");

  // 🔹 Kiểm tra phòng đã được sử dụng chưa
  if (room.hasBeenUsed) {
    throw new Error("Không thể xóa phòng đã được sử dụng trong hệ thống");
  }

  // 🔹 Kiểm tra subRooms đã được sử dụng chưa (nếu có)
  if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    const usedSubRooms = room.subRooms.filter(subRoom => subRoom.hasBeenUsed);
    if (usedSubRooms.length > 0) {
      const usedNames = usedSubRooms.map(sr => sr.name).join(', ');
      throw new Error(`Không thể xóa phòng vì các buồng con đã được sử dụng: ${usedNames}`);
    }
  }
  
  await roomRepo.deleteRoom(roomId);
  await refreshRoomCache();
  return { message: "Đã xóa phòng thành công" };
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
  
  // 🆕 Tự động cập nhật isActive của room dựa trên subrooms
  await updateRoomActiveStatusBasedOnSubRooms(toggledRoom);
  
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

  // 🆕 Tự động bật lại room nếu đang tắt (vì vừa thêm subroom mới có isActive=true)
  if (!room.isActive) {
    room.isActive = true;
    console.log(`🔄 Room ${room.name} (${room._id}): isActive changed to true (thêm subroom mới)`);
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

  // 🔹 Kiểm tra subroom đã được sử dụng chưa
  if (subRoom.hasBeenUsed) {
    throw new Error("Không thể xóa buồng đã được sử dụng trong hệ thống");
  }
  
  // Xóa subroom
  room.subRooms.pull(subRoomId);
  
  // Nếu không còn subroom nào thì chuyển về phòng không có subrooms
  if (room.subRooms.length === 0) {
    room.hasSubRooms = false;
    room.maxDoctors = 1; // default value
    room.maxNurses = 1;  // default value
  } else {
    // 🆕 Nếu còn subrooms, cập nhật isActive của room dựa trên subrooms còn lại
    await updateRoomActiveStatusBasedOnSubRooms(room);
  }

  await room.save();
  await refreshRoomCache();
  return room;
};

// 🆕 Lấy rooms với thông tin schedule (cho trang tạo lịch)
exports.getRoomsWithScheduleInfo = async (filter = {}, page = 1, limit = 20) => {
  const skip = (page - 1) * limit;
  const rooms = await roomRepo.findRoomsWithScheduleInfo(filter, skip, limit);
  const total = await roomRepo.countRooms(filter);
  
  return {
    rooms,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / limit)
  };
};

// 🆕 Update room schedule info (được gọi bởi schedule service)
exports.updateRoomScheduleInfo = async (roomId, scheduleInfo) => {
  const room = await roomRepo.findById(roomId);
  if (!room) {
    throw new Error('Không tìm thấy phòng');
  }
  
  if (scheduleInfo.hasBeenUsed !== undefined) {
    room.hasBeenUsed = scheduleInfo.hasBeenUsed;
  }
  if (scheduleInfo.lastScheduleGenerated !== undefined) {
    room.lastScheduleGenerated = scheduleInfo.lastScheduleGenerated;
  }
  
  await room.save();
  await refreshRoomCache();
  return room;
};

// 🆕 Mark subroom as used (được gọi khi tạo schedule cho subroom)
exports.markSubRoomAsUsed = async (roomId, subRoomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) {
    throw new Error('Không tìm thấy phòng');
  }
  
  const subRoom = room.subRooms.id(subRoomId);
  if (!subRoom) {
    throw new Error('Không tìm thấy buồng');
  }
  
  // Update hasBeenUsed for subroom
  subRoom.hasBeenUsed = true;
  
  // Also mark parent room as used
  room.hasBeenUsed = true;
  
  await room.save();
  await refreshRoomCache();
  
  console.log(`✅ Marked subRoom ${subRoom.name} (${subRoomId}) as used`);
  return room;
};

// Export initRoomCache for manual initialization
exports.initRoomCache = initRoomCache;

// Auto-initialize cache on service start (fallback)
initRoomCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm phòng:', err));

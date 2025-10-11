const Room = require('../models/room.model');

exports.createRoom = async (data) => {
  return await Room.create(data);
};

exports.updateRoom = async (roomId, updateData) => {
  return await Room.findByIdAndUpdate(
    roomId,
    updateData,
    { new: true, runValidators: true }
  );
};

exports.toggleStatus = async (roomId) => {
  const room = await Room.findById(roomId);
  if (!room) throw new Error('Room not found');
  room.isActive = !room.isActive;
  return await room.save();
};

exports.listRooms = async (skip = 0, limit = 10) => {
  return await Room.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

exports.getAllRooms = async () => {
  return await Room.find().sort({ createdAt: -1 }).lean();
};

exports.countRooms = async () => {
  return await Room.countDocuments();
};

exports.searchRoom = async (keyword, skip = 0, limit = 10) => {
  return await Room.find({
    name: { $regex: keyword, $options: 'i' }
  })
    .skip(skip)
    .limit(limit);
};

exports.countSearchRoom = async (keyword) => {
  return await Room.countDocuments({
    name: { $regex: keyword, $options: 'i' }
  });
};

exports.findById = async (roomId) => {
  return await Room.findById(roomId);
};

exports.findById = async (roomId) => {
  if (!roomId) throw new Error("Thiếu roomId");

  const room = await Room.findById(roomId).select('-__v'); // chọn tất cả fields trừ __v
  return room; // trả về document Room hoặc null
};

exports.findRoomBySubRoomId = async (subRoomId) => {
  if (!subRoomId) throw new Error("Thiếu subRoomId");

  // Tìm phòng chứa subRoom
  const room = await Room.findOne({ "subRooms._id": subRoomId });
  return room; // có thể null nếu không tìm thấy
};

exports.toggleSubRoomStatus = async (roomId, subRoomId) => {
  const room = await Room.findById(roomId);
  if (!room) throw new Error('Room not found');

  const subRoom = room.subRooms.id(subRoomId);
  if (!subRoom) throw new Error('SubRoom not found');

  subRoom.isActive = !subRoom.isActive;
  await room.save();
  return room;
};

exports.deleteRoom = async (roomId) => {
  return await Room.findByIdAndDelete(roomId);
};

// 🔄 Update hasBeenUsed when room/subroom is assigned to slot
exports.markRoomAsUsed = async (roomId) => {
  return await Room.findByIdAndUpdate(
    roomId,
    { hasBeenUsed: true },
    { new: true }
  );
};

exports.markSubRoomAsUsed = async (roomId, subRoomId) => {
  return await Room.findOneAndUpdate(
    { 
      _id: roomId,
      'subRooms._id': subRoomId 
    },
    { 
      $set: {
        'subRooms.$.hasBeenUsed': true,
        hasBeenUsed: true // mark parent room as used too
      }
    },
    { new: true }
  );
};

// 🆕 Find rooms with schedule info
exports.findRoomsWithScheduleInfo = async (filter, skip, limit) => {
  return await Room.find(filter)
    .sort({ hasSchedule: -1, scheduleEndDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
};

// 🆕 Count rooms with filter
exports.countRooms = async (filter = {}) => {
  return await Room.countDocuments(filter);
};

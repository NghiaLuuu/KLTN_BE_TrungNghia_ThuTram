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

exports.listRooms = async () => {
  return await Room.find().sort({ createdAt: -1 });
};

exports.searchRoom = async (keyword) => {
  return await Room.find({
    name: { $regex: keyword, $options: 'i' }
  });
};

exports.findById = async (roomId) => {
  return await Room.findById(roomId);
};

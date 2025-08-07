const roomRepo = require('../repositories/room.repository');

exports.createRoom = async (data) => {
  return await roomRepo.createRoom(data);
};

exports.updateRoom = async (roomId, data) => {
  return await roomRepo.updateRoom(roomId, data);
};

exports.toggleStatus = async (roomId) => {
  return await roomRepo.toggleStatus(roomId);
};

exports.listRooms = async () => {
  return await roomRepo.listRooms();
};

exports.searchRoom = async (keyword) => {
  return await roomRepo.searchRoom(keyword);
};

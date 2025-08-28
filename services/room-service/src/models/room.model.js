const mongoose = require('mongoose');

const subRoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  maxDoctors: {
    type: Number,
    required: true,
    min: 1,
  },
  maxNurses: {
    type: Number,
    required: true,
    min: 1,
  }
}, { _id: true });

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  subRooms: [subRoomSchema], // mỗi buồng có số lượng bác sĩ/y tá riêng
}, {
  timestamps: true,
});

module.exports = mongoose.model('Room', roomSchema);

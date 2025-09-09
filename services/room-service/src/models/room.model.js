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
  },
  isActive: {
    type: Boolean,
    default: true, // mặc định bật
  }
}, { _id: true });

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true, // tên phòng phải duy nhất
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  subRooms: [subRoomSchema],
}, {
  timestamps: true,
});

// 🔹 Hàm dùng chung để check duplicate subRoom
function checkDuplicateSubRooms(subRooms, next) {
  if (!Array.isArray(subRooms)) return next();
  const names = subRooms.map(sr => sr.name.trim().toLowerCase());
  const hasDuplicate = names.some((name, idx) => names.indexOf(name) !== idx);
  if (hasDuplicate) {
    return next(new Error("Tên buồng không được trùng trong cùng một phòng"));
  }
  next();
}

// ✅ Check khi create hoặc save
roomSchema.pre("save", function (next) {
  checkDuplicateSubRooms(this.subRooms, next);
});

// ✅ Check khi update (findOneAndUpdate, findByIdAndUpdate)
roomSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();

  // Nếu update có $set.subRooms hoặc subRooms
  const subRooms = update?.$set?.subRooms || update?.subRooms;
  if (subRooms) {
    checkDuplicateSubRooms(subRooms, next);
  } else {
    next();
  }
});

module.exports = mongoose.model("Room", roomSchema);

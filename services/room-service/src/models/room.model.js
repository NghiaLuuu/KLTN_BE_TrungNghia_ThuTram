const mongoose = require('mongoose');

// ---------------- SubRoom Schema ----------------
const subRoomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Chỉ cho phép format "Buồng X" where X là số
        return /^Buồng \d+$/.test(v);
      },
      message: 'Tên buồng phải có định dạng "Buồng X" (X là số)'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
  }
}, { _id: true });

// ---------------- Room Schema ----------------
const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true, // index MongoDB, vẫn giữ để performance
  },
  // Chỉ áp dụng cho phòng KHÔNG có subroom
  maxDoctors: {
    type: Number,
    min: 1,
    validate: {
      validator: function(v) {
        // Nếu có subroom thì không được có maxDoctors
        if (this.subRooms && this.subRooms.length > 0 && v !== undefined) {
          return false;
        }
        return true;
      },
      message: 'Phòng có buồng con không được thiết lập maxDoctors'
    }
  },
  maxNurses: {
    type: Number,
    min: 1,
    validate: {
      validator: function(v) {
        // Nếu có subroom thì không được có maxNurses
        if (this.subRooms && this.subRooms.length > 0 && v !== undefined) {
          return false;
        }
        return true;
      },
      message: 'Phòng có buồng con không được thiết lập maxNurses'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  subRooms: [subRoomSchema],
}, {
  timestamps: true,
});

// ---------------- Helper ----------------
function checkDuplicateSubRooms(subRooms, next) {
  if (!Array.isArray(subRooms)) return next();
  const names = subRooms.map(sr => sr.name.trim().toLowerCase());
  const hasDuplicate = names.some((name, idx) => names.indexOf(name) !== idx);
  if (hasDuplicate) {
    return next(new Error("Tên buồng không được trùng trong cùng một phòng"));
  }
  next();
}

// ---------------- Pre-save ----------------
roomSchema.pre('save', async function(next) {
  const room = this;

  // 1️⃣ Check duplicate subRoom
  checkDuplicateSubRooms(room.subRooms, (err) => {
    if (err) return next(err);
  });

  // 2️⃣ Check duplicate Room.name
  const existing = await mongoose.models.Room.findOne({ name: room.name });
  if (existing && existing._id.toString() !== room._id.toString()) {
    return next(new Error(`Phòng "${room.name}" đã tồn tại`));
  }

  next();
});

// ---------------- Pre-update (findOneAndUpdate) ----------------
roomSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();

  // 1️⃣ Check subRooms trùng
  const subRooms = update?.$set?.subRooms || update?.subRooms;
  if (subRooms) {
    checkDuplicateSubRooms(subRooms, (err) => {
      if (err) return next(err);
    });
  }

  // 2️⃣ Check Room.name trùng
  const newName = update?.$set?.name;
  if (newName) {
    const existing = await mongoose.models.Room.findOne({ name: newName });
    if (existing && existing._id.toString() !== this.getQuery()._id.toString()) {
      return next(new Error(`Phòng "${newName}" đã tồn tại`));
    }
  }

  next();
});

module.exports = mongoose.model('Room', roomSchema);

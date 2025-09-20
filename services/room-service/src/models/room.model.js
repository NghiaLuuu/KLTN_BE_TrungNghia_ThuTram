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
  // Trường phân biệt loại phòng
  hasSubRooms: {
    type: Boolean,
    required: true,
    default: false,
  },
  // Chỉ áp dụng cho phòng KHÔNG có subroom (hasSubRooms = false)
  maxDoctors: {
    type: Number,
    min: 0,
    required: function() {
      return !this.hasSubRooms;
    },
    validate: {
      validator: function(v) {
        // Nếu hasSubRooms = true thì không được có maxDoctors
        if (this.hasSubRooms && v !== undefined) {
          return false;
        }
        // Nếu hasSubRooms = false thì phải có maxDoctors
        if (!this.hasSubRooms && (v === undefined || v === null)) {
          return false;
        }
        return true;
      },
      message: 'Phòng không có buồng con phải có maxDoctors, phòng có buồng con không được có maxDoctors'
    }
  },
  maxNurses: {
    type: Number,
    min: 0,
    required: function() {
      return !this.hasSubRooms;
    },
    validate: {
      validator: function(v) {
        // Nếu hasSubRooms = true thì không được có maxNurses
        if (this.hasSubRooms && v !== undefined) {
          return false;
        }
        // Nếu hasSubRooms = false thì phải có maxNurses
        if (!this.hasSubRooms && (v === undefined || v === null)) {
          return false;
        }
        return true;
      },
      message: 'Phòng không có buồng con phải có maxNurses, phòng có buồng con không được có maxNurses'
    }
  },
  // Chỉ áp dụng cho phòng CÓ subroom (hasSubRooms = true)
  subRooms: {
    type: [subRoomSchema],
    validate: {
      validator: function(v) {
        // Nếu hasSubRooms = true thì phải có ít nhất 1 subroom
        if (this.hasSubRooms && (!v || v.length === 0)) {
          return false;
        }
        // Nếu hasSubRooms = false thì không được có subroom
        if (!this.hasSubRooms && v && v.length > 0) {
          return false;
        }
        return true;
      },
      message: 'Phòng có buồng con phải có ít nhất 1 buồng, phòng không có buồng con không được có subRooms'
    }
  },
  isActive: {
    type: Boolean,
    default: true,
  },
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

  // 1️⃣ Validate hasSubRooms logic
  if (room.hasSubRooms) {
    // Phòng có subrooms: phải có ít nhất 1 subroom, không được có maxDoctors/maxNurses
    if (!room.subRooms || room.subRooms.length === 0) {
      return next(new Error('Phòng có buồng con phải có ít nhất 1 buồng'));
    }
    if (room.maxDoctors !== undefined || room.maxNurses !== undefined) {
      return next(new Error('Phòng có buồng con không được có maxDoctors hoặc maxNurses'));
    }
  } else {
    // Phòng không có subrooms: phải có maxDoctors/maxNurses, không được có subrooms
    if (!room.maxDoctors || !room.maxNurses) {
      return next(new Error('Phòng không có buồng con phải có maxDoctors và maxNurses'));
    }
    if (room.subRooms && room.subRooms.length > 0) {
      return next(new Error('Phòng không có buồng con không được có subRooms'));
    }
  }

  // 2️⃣ Check duplicate subRoom (chỉ nếu có subrooms)
  if (room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    checkDuplicateSubRooms(room.subRooms, (err) => {
      if (err) return next(err);
    });
  }

  // 3️⃣ Check duplicate Room.name
  const existing = await mongoose.models.Room.findOne({ name: room.name });
  if (existing && existing._id.toString() !== room._id.toString()) {
    return next(new Error(`Phòng "${room.name}" đã tồn tại`));
  }

  next();
});

// ---------------- Pre-update (findOneAndUpdate) ----------------
roomSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();

  // Lấy document hiện tại để kiểm tra
  const currentDoc = await this.model.findOne(this.getQuery());
  if (!currentDoc) {
    return next(new Error('Không tìm thấy phòng để cập nhật'));
  }

  // Tạo object merged để validate
  const merged = { ...currentDoc.toObject(), ...update.$set, ...update };
  
  // 1️⃣ Validate hasSubRooms logic
  if (merged.hasSubRooms) {
    // Phòng có subrooms: phải có ít nhất 1 subroom, không được có maxDoctors/maxNurses
    if (!merged.subRooms || merged.subRooms.length === 0) {
      return next(new Error('Phòng có buồng con phải có ít nhất 1 buồng'));
    }
    if (merged.maxDoctors !== undefined || merged.maxNurses !== undefined) {
      return next(new Error('Phòng có buồng con không được có maxDoctors hoặc maxNurses'));
    }
  } else {
    // Phòng không có subrooms: phải có maxDoctors/maxNurses, không được có subrooms
    if (!merged.maxDoctors || !merged.maxNurses) {
      return next(new Error('Phòng không có buồng con phải có maxDoctors và maxNurses'));
    }
    if (merged.subRooms && merged.subRooms.length > 0) {
      return next(new Error('Phòng không có buồng con không được có subRooms'));
    }
  }

  // 2️⃣ Check subRooms trùng (chỉ nếu có subrooms)
  const subRooms = update?.$set?.subRooms || update?.subRooms;
  if (merged.hasSubRooms && subRooms && subRooms.length > 0) {
    checkDuplicateSubRooms(subRooms, (err) => {
      if (err) return next(err);
    });
  }

  // 3️⃣ Check Room.name trùng
  const newName = update?.$set?.name || update?.name;
  if (newName && newName !== currentDoc.name) {
    const existing = await mongoose.models.Room.findOne({ name: newName });
    if (existing && existing._id.toString() !== currentDoc._id.toString()) {
      return next(new Error(`Phòng "${newName}" đã tồn tại`));
    }
  }

  next();
});

module.exports = mongoose.model('Room', roomSchema);

const Slot = require('../models/slot.model');


exports.findSlots = async (filter, skip = 0, limit = 10) => {
  return await Slot.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ date: 1, startTime: 1 }); // gợi ý: sort theo ngày + giờ
};

exports.countSlots = async (filter) => {
  return await Slot.countDocuments(filter);
};

exports.updateManySlots = async (filter, updateData) => {
  return await Slot.updateMany(filter, { $set: updateData });
};

exports.updateSlot = async (id, updateData) => {
  return await Slot.findByIdAndUpdate(id, updateData, { new: true });
};


// Tìm 1 slot theo id
exports.findById = async (id) => {
  return await Slot.findById(id);
};


// ✅ Tạo nhiều slot
exports.insertMany = async (slots) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error("slots must be a non-empty array");
  }
  return await Slot.insertMany(slots);
};

exports.deleteMany = async (filter) => {
  return await Slot.deleteMany(filter);
};

// Cập nhật nhiều slot
exports.updateMany = async (filter, updateData) => {
  return await Slot.updateMany(filter, updateData);
};

exports.find = async (query) => {
  return await Slot.find(query);
};

exports.findSlotsByDentistFromNow = async (dentistId, fromTime) => {
  return Slot.find({
    dentistId: dentistId,
    startTime: { $gte: fromTime }, // chỉ lấy từ thời gian hiện tại trở đi
    status: 'available'
  }).sort({ startTime: 1 }).lean();
};

// Cập nhật trạng thái slot
exports.updateSlotsStatus = async (slotIds, status) => {
  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    throw new Error("slotIds phải là mảng không rỗng");
  }

  return await Slot.updateMany(
    { _id: { $in: slotIds } },
    { $set: { status } }
  );
};


exports.findSlotsByEmployee = async ({ employeeId, startDate, endDate }) => {
  if (!employeeId) {
    throw new Error('Thiếu employeeId');
  }

  const filter = {
    $or: [
      { dentistId: { $in: [employeeId] } },
      { nurseId: { $in: [employeeId] } }
    ]
  };

  // Nếu truyền startDate / endDate thì lọc theo date
  if (startDate || endDate) {
    filter.date = {};
    if (startDate) filter.date.$gte = new Date(startDate);
    if (endDate) filter.date.$lte = new Date(endDate);
  }

  const slots = await Slot.find(filter).sort({ date: 1, startTime: 1 });

  return slots;
};

exports.findSlotsByScheduleId = async (scheduleId, page = 1, limit) => {
  const filter = { scheduleId };
  let slots;

  if (limit) {
    const skip = (page - 1) * limit;
    slots = await Slot.find(filter).sort({ startTime: 1 }).skip(skip).limit(limit);
    const total = await Slot.countDocuments(filter);
    return {
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      slots
    };
  } else {
    slots = await Slot.find(filter).sort({ startTime: 1 });
    return {
      total: slots.length,
      totalPages: 1,
      page: 1,
      limit: slots.length,
      slots
    };
  }
};

exports.findByIds = async (ids) => {
  return Slot.find({ _id: { $in: ids } });
};


exports.findWithSelect = async (filter, fields) => {
  return await Slot.find(filter).select(fields);
};

exports.getSlots = async (filter = {}) => {
  return await Slot.find(filter)
    .sort({ startTime: 1 }) // sắp xếp theo giờ bắt đầu
    .lean();
};

exports.findBySubRoomId = async (subRoomId, startDate, endDate) => {
  return Slot.find({
    subRoomId,
    date: { $gte: startDate, $lte: endDate }
  }).sort({ startTime: 1 }).lean();
};

// slotRepo.js
exports.findByStaffId = async (staffId, startDate, endDate) => {
  return Slot.find({
    $or: [
      { dentistId: staffId },
      { nurseId: staffId }
    ],
    date: { $gte: startDate, $lte: endDate }
  })
  .sort({ startTime: 1 })
  .lean();
};

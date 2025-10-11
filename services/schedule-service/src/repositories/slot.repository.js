const Slot = require('../models/slot.model');


exports.findSlots = async (filter, skip = 0, limit = 10) => {
  return await Slot.find(filter)
    .skip(skip)
    .limit(limit)
    .sort({ startTime: 1 });
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

// Alias for compatibility with services
exports.updateById = async (id, updateData) => {
  return await Slot.findByIdAndUpdate(id, updateData, { new: true });
};


// Tìm 1 slot theo id
exports.findById = async (id) => {
  return await Slot.findById(id);
};

// Alias for RPC
exports.getSlotById = async (id) => {
  return await Slot.findById(id).lean();
};


// ✅ Tạo nhiều slot
exports.insertMany = async (slots) => {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new Error("slots must be a non-empty array");
  }
  return await Slot.insertMany(slots);
};

// Alias for compatibility with service
exports.createMany = async (slots) => {
  return exports.insertMany(slots);
};

// Another alias used in service code
exports.createManySlots = async (slots) => {
  return exports.insertMany(slots);
};

exports.deleteMany = async (filter) => {
  return await Slot.deleteMany(filter);
};

// Delete all slots by scheduleId
exports.deleteByScheduleId = async (scheduleId) => {
  return await Slot.deleteMany({ scheduleId });
};

// Cập nhật nhiều slot
exports.updateMany = async (filter, updateData) => {
  return await Slot.updateMany(filter, updateData);
};

exports.find = async (query) => {
  return await Slot.find(query);
};

exports.findWithPopulate = (query, populateOptions = []) => {
  let q = Slot.find(query);

  const optionsArray = Array.isArray(populateOptions) ? populateOptions : [populateOptions];
  optionsArray
    .filter(Boolean)
    .forEach((opt) => {
      q = q.populate(opt);
    });

  return q;
};

// Find slots by room and date range (inclusive)
exports.findByRoomAndDateRange = async (roomId, startDate, endDate) => {
  return await Slot.find({
    roomId,
    startTime: { $gte: new Date(startDate), $lte: new Date(endDate) }
  }).sort({ startTime: 1 }).lean();
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
    filter.startTime = {};
    if (startDate) filter.startTime.$gte = new Date(startDate);
    if (endDate) filter.startTime.$lte = new Date(endDate);
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

// Update appointmentId for slot
exports.updateAppointmentId = async (slotId, appointmentId) => {
  return await Slot.findByIdAndUpdate(
    slotId,
    { $set: { appointmentId } },
    { new: true }
  );
};

exports.getSlots = async (filter = {}) => {
  return await Slot.find(filter)
    .sort({ startTime: 1 }) // sắp xếp theo giờ bắt đầu
    .lean();
};

exports.findBySubRoomId = async (subRoomId, startDate, endDate) => {
  return Slot.find({
    subRoomId,
    startTime: { $gte: startDate, $lte: endDate }
  }).sort({ startTime: 1 }).lean();
};

// Find any slots for a staff that overlap a given time range
// Overlap condition: slot.startTime < endDate && slot.endTime > startDate
exports.findByStaffId = async (staffId, startDate, endDate) => {
  return Slot.find({
    $or: [
      { dentist: staffId },
      { nurse: staffId }
    ],
    startTime: { $lt: endDate },
    endTime: { $gt: startDate }
  })
  .sort({ startTime: 1 })
  .lean();
};

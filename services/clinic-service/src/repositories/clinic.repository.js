const Clinic = require('../models/clinic.model');

// Create once
exports.initSingleton = async (data) => {
  const existing = await Clinic.getSingleton();
  if (existing) throw new Error('Clinic đã tồn tại');

  const doc = new Clinic({ 
    ...data, 
    isDefault: true
    // workShifts sẽ lấy từ data.workShifts do client gửi lên
  });

  return doc.save();
};



exports.getSingleton = async () => {
  return await Clinic.findOne({ singletonKey: 'CLINIC_SINGLETON' });
};

exports.updateSingleton = async (updateData, updatedBy) => {
  const setObj = { ...updateData };
  if (updatedBy) setObj.updatedBy = updatedBy;

  return await Clinic.findOneAndUpdate(
    { singletonKey: 'CLINIC_SINGLETON' },
    { $set: setObj },
    { new: true, runValidators: true }
  ).lean();
};

exports.findOne = async () => {
  return await Clinic.findOne({ singletonKey: 'CLINIC_SINGLETON' }).lean();
};

// WORK SHIFT MANAGEMENT
// Get all shifts
exports.getWorkShifts = async () => {
  const clinic = await Clinic.findOne({ singletonKey: 'CLINIC_SINGLETON' }).lean();
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');
  return clinic.workShifts || [];
};

// Create single shift
exports.createWorkShift = async (shiftData) => {
  const clinic = await Clinic.findOne({ singletonKey: 'CLINIC_SINGLETON' });
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');

  // Check duplicate name (case-insensitive)
  const existingShift = clinic.workShifts.find(s => 
    s.name.toLowerCase().trim() === shiftData.name.toLowerCase().trim()
  );
  if (existingShift) {
    throw new Error(`Ca làm việc "${shiftData.name}" đã tồn tại`);
  }

  // Check time overlap with existing shifts
  const [newStartH, newStartM] = shiftData.startTime.split(':').map(Number);
  const [newEndH, newEndM] = shiftData.endTime.split(':').map(Number);
  const newStart = newStartH * 60 + newStartM;
  const newEnd = newEndH * 60 + newEndM;

  for (const existingShift of clinic.workShifts) {
    const [existStartH, existStartM] = existingShift.startTime.split(':').map(Number);
    const [existEndH, existEndM] = existingShift.endTime.split(':').map(Number);
    const existStart = existStartH * 60 + existStartM;
    const existEnd = existEndH * 60 + existEndM;

    // Check for overlap: new shift overlaps if newStart < existEnd && newEnd > existStart
    if (newStart < existEnd && newEnd > existStart) {
      throw new Error(
        `Ca "${shiftData.name}" (${shiftData.startTime}-${shiftData.endTime}) bị trùng giờ với ca "${existingShift.name}" (${existingShift.startTime}-${existingShift.endTime})`
      );
    }
  }

  return await Clinic.findOneAndUpdate(
    { singletonKey: 'CLINIC_SINGLETON' },
    { $push: { workShifts: shiftData } },
    { new: true, runValidators: true }
  ).lean();
};

// Create multiple shifts
exports.createMultipleWorkShifts = async (shiftsData) => {
  const clinic = await Clinic.findOne({ singletonKey: 'CLINIC_SINGLETON' });
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');

  // Check for duplicates with existing shifts (case-insensitive)
  const existingNames = new Set(clinic.workShifts.map(s => s.name.toLowerCase().trim()));
  for (const shift of shiftsData) {
    if (existingNames.has(shift.name.toLowerCase().trim())) {
      throw new Error(`Ca làm việc "${shift.name}" đã tồn tại`);
    }
  }

  // Check for time overlaps with existing shifts
  for (const newShift of shiftsData) {
    const [newStartH, newStartM] = newShift.startTime.split(':').map(Number);
    const [newEndH, newEndM] = newShift.endTime.split(':').map(Number);
    const newStart = newStartH * 60 + newStartM;
    const newEnd = newEndH * 60 + newEndM;

    for (const existingShift of clinic.workShifts) {
      const [existStartH, existStartM] = existingShift.startTime.split(':').map(Number);
      const [existEndH, existEndM] = existingShift.endTime.split(':').map(Number);
      const existStart = existStartH * 60 + existStartM;
      const existEnd = existEndH * 60 + existEndM;

      if (newStart < existEnd && newEnd > existStart) {
        throw new Error(
          `Ca "${newShift.name}" (${newShift.startTime}-${newShift.endTime}) bị trùng giờ với ca đã tồn tại "${existingShift.name}" (${existingShift.startTime}-${existingShift.endTime})`
        );
      }
    }
  }

  return await Clinic.findOneAndUpdate(
    { singletonKey: 'CLINIC_SINGLETON' },
    { $push: { workShifts: { $each: shiftsData } } },
    { new: true, runValidators: true }
  ).lean();
};

// Update shift by name
exports.updateWorkShifts = async (shifts) => {
  const clinic = await Clinic.findOne({ singletonKey: 'CLINIC_SINGLETON' });
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');

  const setObj = {};

  // 1. Check duplicate name ngay trong request
  const requestedNames = shifts
    .map(s => (s.name ? s.name.toLowerCase().trim() : s.oldName.toLowerCase().trim()));
  const duplicateInRequest = requestedNames.filter((n, i) => requestedNames.indexOf(n) !== i);
  if (duplicateInRequest.length > 0) {
    throw new Error(`Trong dữ liệu gửi lên có ca trùng tên: ${[...new Set(duplicateInRequest)].join(', ')}`);
  }

  for (const shift of shifts) {
    const index = clinic.workShifts.findIndex(
      s => s.name.toLowerCase().trim() === shift.oldName.toLowerCase().trim()
    );
    if (index === -1) throw new Error(`Không tìm thấy ca "${shift.oldName}"`);

    // 2. Check trùng với ca khác trong DB (ngoài ca đang update)
    if (shift.name && shift.name.toLowerCase().trim() !== shift.oldName.toLowerCase().trim()) {
      const exists = clinic.workShifts.find(
        (s, i) =>
          i !== index && s.name.toLowerCase().trim() === shift.name.toLowerCase().trim()
      );
      if (exists) throw new Error(`Ca "${shift.name}" đã tồn tại trong hệ thống`);
    }

    // 3. Build update object
    if (shift.name !== undefined) setObj[`workShifts.${index}.name`] = shift.name;
    if (shift.startTime !== undefined) setObj[`workShifts.${index}.startTime`] = shift.startTime;
    if (shift.endTime !== undefined) setObj[`workShifts.${index}.endTime`] = shift.endTime;
    if (shift.isActive !== undefined) setObj[`workShifts.${index}.isActive`] = shift.isActive;
  }

  return await Clinic.findOneAndUpdate(
    { singletonKey: 'CLINIC_SINGLETON' },
    { $set: setObj },
    { new: true, runValidators: true }
  ).lean();
};

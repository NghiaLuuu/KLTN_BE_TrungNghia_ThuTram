const clinicRepo = require('../repositories/clinic.repository');
const redis = require('../utils/redis.client');

const CLINIC_CACHE_KEY = 'clinic_singleton';

const refreshCache = async () => {
  try {
    const clinic = await clinicRepo.getSingleton();
    if (clinic) {
      await redis.set(CLINIC_CACHE_KEY, JSON.stringify(clinic), 'EX', 3600);
    }
  } catch (e) {
    console.error('❌ Lỗi refresh cache:', e);
  }
};

// Init once
exports.initClinic = async (currentUser, data) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền khởi tạo Clinic');
  }

  // Validate workShifts requirement
  if (!data.workShifts || !Array.isArray(data.workShifts) || data.workShifts.length === 0) {
    throw new Error('Phải cung cấp ít nhất một ca làm việc khi khởi tạo');
  }

  // Validate allowed shift names
  const allowedShifts = ['Ca sáng', 'Ca chiều', 'Ca tối'];
  for (const shift of data.workShifts) {
    if (!shift.name || !allowedShifts.includes(shift.name)) {
      throw new Error(`Tên ca chỉ được phép là: ${allowedShifts.join(', ')}`);
    }
    
    // Validate required fields
    if (!shift.startTime || !shift.endTime) {
      throw new Error(`Ca "${shift.name}" phải có startTime và endTime`);
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(shift.startTime) || !timeRegex.test(shift.endTime)) {
      throw new Error(`Ca "${shift.name}": Định dạng thời gian không hợp lệ (HH:MM)`);
    }

    // Validate time range
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    if (startMinutes >= endMinutes) {
      throw new Error(`Ca "${shift.name}": Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc`);
    }
  }

  data.createdBy = currentUser._id;
  const clinic = await clinicRepo.initSingleton(data);
  await refreshCache();
  return clinic;
};

// Get singleton
exports.getClinic = async () => {
  const cached = await redis.get(CLINIC_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const clinic = await clinicRepo.getSingleton();
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');

  await refreshCache();
  return clinic;
};

// Update singleton
exports.updateClinic = async (currentUser, updateData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật Clinic');
  }

  const setObj = {};
  if (updateData.contactInfo && typeof updateData.contactInfo === 'object') {
    const allowed = ['hotline', 'email'];
    for (const key of allowed) {
      if (updateData.contactInfo[key] !== undefined) {
        setObj[`contactInfo.${key}`] = updateData.contactInfo[key];
      }
    }
  }

  if (Object.keys(setObj).length === 0) {
    throw new Error('Không có trường nào để cập nhật');
  }

  const clinic = await clinicRepo.updateSingleton(setObj, currentUser._id);
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');
  await refreshCache();
  return clinic;
};

// Toggle isActive
exports.toggleIsActive = async (currentUser) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Bạn không có quyền cập nhật trạng thái');
  }

  const clinic = await clinicRepo.findOne();
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');

  const newStatus = !clinic.isActive;
  const updated = await clinicRepo.updateSingleton({ isActive: newStatus }, currentUser._id);
  await refreshCache();

  return { message: 'Cập nhật trạng thái thành công', clinic: updated };
};

// Public info
exports.getPublicClinicInfo = async () => {
  const clinic = await this.getClinic();
  return {
    contactInfo: clinic.contactInfo,
    isActive: clinic.isActive
  };
};

// WORK SHIFT MANAGEMENT
// Get all work shifts
exports.getWorkShifts = async () => {
  return await clinicRepo.getWorkShifts();
};

// Create single work shift
exports.createWorkShift = async (currentUser, shiftData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền tạo ca làm việc');
  }

  // Validate required fields
  if (!shiftData.name || !shiftData.startTime || !shiftData.endTime) {
    throw new Error('Thiếu thông tin bắt buộc: name, startTime, endTime');
  }

  // Trim and validate enum name
  shiftData.name = shiftData.name.trim();
  const allowedShifts = ['Ca sáng', 'Ca chiều', 'Ca tối'];
  if (!allowedShifts.includes(shiftData.name)) {
    throw new Error(`Tên ca chỉ được phép là: ${allowedShifts.join(', ')}`);
  }

  // Validate time format
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(shiftData.startTime) || !timeRegex.test(shiftData.endTime)) {
    throw new Error('Định dạng thời gian không hợp lệ (HH:MM)');
  }

  // Validate time range
  const [sh, sm] = shiftData.startTime.split(':').map(Number);
  const [eh, em] = shiftData.endTime.split(':').map(Number);
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (startMinutes >= endMinutes) {
    throw new Error('Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc');
  }

  const clinic = await clinicRepo.createWorkShift(shiftData);
  await refreshCache();
  return { message: 'Tạo ca làm việc thành công', clinic };
};

// Create multiple work shifts
exports.createMultipleWorkShifts = async (currentUser, shiftsData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền tạo ca làm việc');
  }

  if (!Array.isArray(shiftsData) || shiftsData.length === 0) {
    throw new Error('Danh sách ca làm việc không hợp lệ');
  }

  // Validate each shift
  const shiftNames = new Set();
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
  const allowedShifts = ['Ca sáng', 'Ca chiều', 'Ca tối'];

  for (const shift of shiftsData) {
    // Check required fields
    if (!shift.name || !shift.startTime || !shift.endTime) {
      throw new Error('Mỗi ca làm việc phải có name, startTime, endTime');
    }

    // Trim and validate enum name
    shift.name = shift.name.trim();
    if (!allowedShifts.includes(shift.name)) {
      throw new Error(`Tên ca "${shift.name}" không hợp lệ. Chỉ được phép: ${allowedShifts.join(', ')}`);
    }

    const normalizedName = shift.name.toLowerCase();

    // Check duplicate names in the request (case-insensitive)
    if (shiftNames.has(normalizedName)) {
      throw new Error(`Tên ca "${shift.name}" bị trùng lặp trong danh sách`);
    }
    shiftNames.add(normalizedName);

    // Validate time format
    if (!timeRegex.test(shift.startTime) || !timeRegex.test(shift.endTime)) {
      throw new Error(`Ca "${shift.name}": Định dạng thời gian không hợp lệ (HH:MM)`);
    }

    // Validate time range
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    if (startMinutes >= endMinutes) {
      throw new Error(`Ca "${shift.name}": Thời gian bắt đầu phải nhỏ hơn thời gian kết thúc`);
    }
  }

  // Check for time overlaps between new shifts
  const sortedShifts = [...shiftsData].sort((a, b) => {
    const aStart = a.startTime.split(':').map(Number);
    const bStart = b.startTime.split(':').map(Number);
    return (aStart[0] * 60 + aStart[1]) - (bStart[0] * 60 + bStart[1]);
  });

  for (let i = 0; i < sortedShifts.length - 1; i++) {
    const current = sortedShifts[i];
    const next = sortedShifts[i + 1];

    const [ch, cm] = current.endTime.split(':').map(Number);
    const [nh, nm] = next.startTime.split(':').map(Number);

    const currentEnd = ch * 60 + cm;
    const nextStart = nh * 60 + nm;

    if (currentEnd > nextStart) {
      throw new Error(
        `Ca "${current.name}" (${current.startTime}-${current.endTime}) bị trùng giờ với ca "${next.name}" (${next.startTime}-${next.endTime})`
      );
    }
  }

  const clinic = await clinicRepo.createMultipleWorkShifts(shiftsData);
  await refreshCache();
  return { message: 'Tạo các ca làm việc thành công', clinic };
};

// Update work shift by name
exports.updateWorkShifts = async (currentUser, shifts) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật ca làm việc');
  }

  if (!Array.isArray(shifts) || shifts.length === 0) {
    throw new Error('Danh sách ca làm việc không hợp lệ');
  }

  // Lấy clinic singleton
  const clinic = await clinicRepo.getSingleton();
  if (!clinic) throw new Error('Chưa khởi tạo Clinic');

  // Update theo tên
  shifts.forEach(updateShift => {
    const target = clinic.workShifts.find(s => s.name === updateShift.name);
    if (!target) throw new Error(`Không tìm thấy ca "${updateShift.name}"`);

    // Chỉ cho update thời gian + trạng thái
    if (updateShift.startTime) target.startTime = updateShift.startTime;
    if (updateShift.endTime) target.endTime = updateShift.endTime;
    if (updateShift.isActive !== undefined) target.isActive = updateShift.isActive;
  });

  clinic.updatedBy = currentUser._id;
  await clinic.save();

  return clinic;
};



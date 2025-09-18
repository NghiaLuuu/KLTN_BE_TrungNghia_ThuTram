const orgRepo = require('../repositories/organization.repository');
const redis = require('../utils/redis.client');

const ORG_CACHE_KEY = 'organization_singleton';
const WORK_CONFIG_CACHE_KEY = 'work_configuration_singleton';

const refreshOrgCache = async () => {
  try {
    const org = await orgRepo.getSingleton();
    if (org) {
      await redis.set(ORG_CACHE_KEY, JSON.stringify(org), 'EX', 3600);
      const workConfig = await orgRepo.getWorkConfiguration();
      await redis.set(WORK_CONFIG_CACHE_KEY, JSON.stringify(workConfig), 'EX', 3600);
    }
  } catch (e) {
    console.error('❌ Lỗi refresh cache:', e);
  }
};

// Helpers
const timeToMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

const validateNoShiftOverlap = (shifts) => {
  // Expect array of { name, startTime, endTime }
  const ranges = shifts.map(s => ({
    name: s.name,
    start: timeToMinutes(s.startTime),
    end: timeToMinutes(s.endTime)
  }));
  // Basic bounds
  for (const r of ranges) {
    if (isNaN(r.start) || isNaN(r.end)) throw new Error(`Ca ${r.name}: thời gian không hợp lệ`);
    if (r.start < 0 || r.end > 24 * 60) throw new Error(`Ca ${r.name}: thời gian ngoài phạm vi 00:00-24:00`);
    if (r.start >= r.end) throw new Error(`Ca ${r.name}: giờ bắt đầu phải < giờ kết thúc`);
  }
  // Sort by start and ensure no overlap
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1];
    const cur = ranges[i];
    if (prev.end > cur.start) {
      throw new Error(`Các ca làm việc bị chồng lấp giữa ${prev.name} và ${cur.name}`);
    }
  }
};

const startOfDay = (d) => {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
};

const dateRangeOverlap = (aStart, aEnd, bStart, bEnd) => {
  return aStart <= bEnd && bStart <= aEnd;
};

const mmdd = (d) => {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const expandRangeDays = (start, end) => {
  const out = [];
  const d = new Date(start);
  while (d <= end) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
};

const buildRecurringSet = (start, end) => {
  const set = new Set();
  for (const d of expandRangeDays(start, end)) {
    set.add(mmdd(d));
  }
  return set;
};

// INIT ONCE
exports.initOrganization = async (currentUser, orgData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền khởi tạo Organization');
  }
  orgData.createdBy = currentUser._id;
  const organization = await orgRepo.initSingleton(orgData);
  await refreshOrgCache();
  return organization;
};

// GET/UPDATE SINGLETON
exports.getOrganization = async () => {
  const cached = await redis.get(ORG_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const org = await orgRepo.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');

  await redis.set(ORG_CACHE_KEY, JSON.stringify(org), 'EX', 3600);
  return org;
};

exports.updateOrganization = async (currentUser, updateData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật Organization');
  }

  // Only allow: name, address.*, contactInfo.*, logo
  const setObj = {};

  if (updateData.name !== undefined) {
    if (typeof updateData.name !== 'string' || !updateData.name.trim()) throw new Error('Tên không hợp lệ');
    setObj.name = updateData.name.trim();
  }

  if (updateData.address && typeof updateData.address === 'object') {
    const allowed = ['street', 'ward', 'district', 'city', 'zipCode', 'fullAddress'];
    for (const key of allowed) {
      if (updateData.address[key] !== undefined) setObj[`address.${key}`] = updateData.address[key];
    }
  }

  if (updateData.contactInfo && typeof updateData.contactInfo === 'object') {
    const allowed = ['hotline', 'email', 'website'];
    for (const key of allowed) {
      if (updateData.contactInfo[key] !== undefined) setObj[`contactInfo.${key}`] = updateData.contactInfo[key];
    }
  }

  if (updateData.logo !== undefined) {
    if (updateData.logo !== null && typeof updateData.logo !== 'string') throw new Error('Logo phải là URL hoặc null');
    setObj.logo = updateData.logo;
  }

  if (Object.keys(setObj).length === 0) {
    throw new Error('Không có trường nào để cập nhật');
  }

  const organization = await orgRepo.updateSingleton(setObj, currentUser._id);
  if (!organization) throw new Error('Chưa khởi tạo Organization');
  await refreshOrgCache();
  return organization;
};

// Upload logo to S3 and save URL
exports.uploadLogo = async (currentUser, file) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật logo');
  }
  if (!file || !file.buffer) throw new Error('Không có file upload');

  // Lazy import to avoid circular deps
  const { uploadToS3 } = require('./s3.service');
  const url = await uploadToS3(file.buffer, file.originalname, file.mimetype, 'logos');
  const organization = await orgRepo.updateSingleton({ logo: url }, currentUser._id);
  await refreshOrgCache();
  return { message: 'Cập nhật logo thành công', organization };
};

// 🔹 Update only isActive flag
exports.toggleIsActive = async (currentUser) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Bạn không có quyền cập nhật trạng thái phòng khám');
  }

  // lấy organization hiện tại
  const organization = await orgRepo.findOne({ singletonKey: 'ORGANIZATION_SINGLETON' });
  if (!organization) throw new Error('Chưa khởi tạo Organization');

  // đảo trạng thái
  const newStatus = !organization.isActive;

  // cập nhật lại
  const updated = await orgRepo.updateSingleton({ isActive: newStatus }, currentUser._id);

  await refreshOrgCache();
  return { 
    message: 'Cập nhật trạng thái thành công', 
    organization: updated 
  };
};


// READ CONFIGS
exports.getWorkConfiguration = async () => {
  const cached = await redis.get(WORK_CONFIG_CACHE_KEY);
  if (cached) return JSON.parse(cached);
  const conf = await orgRepo.getWorkConfiguration();
  await redis.set(WORK_CONFIG_CACHE_KEY, JSON.stringify(conf), 'EX', 3600);
  return conf;
};

exports.getFinancialConfiguration = async () => orgRepo.getFinancialConfiguration();
exports.getCancellationPolicy = async () => orgRepo.getCancellationPolicy();
exports.getStaffAllocationRules = async () => orgRepo.getStaffAllocationRules();

// UPDATE CONFIGS
exports.updateWorkConfiguration = async (currentUser, workConfig) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật cấu hình lịch');
  }

  const data = {};

  if (workConfig.unitDuration !== undefined) {
    if (![10, 15, 20, 30, 45, 60].includes(workConfig.unitDuration))
      throw new Error('Thời lượng slot không hợp lệ');
    data.unitDuration = workConfig.unitDuration;
  }

  if (workConfig.maxBookingDays !== undefined) {
    if (workConfig.maxBookingDays < 1 || workConfig.maxBookingDays > 365)
      throw new Error('Số ngày đặt lịch phải từ 1 đến 365');
    data.maxBookingDays = workConfig.maxBookingDays;
  }

  if (workConfig.maxGenerateScheduleMonths !== undefined) {
    if (workConfig.maxGenerateScheduleMonths < 1 || workConfig.maxGenerateScheduleMonths > 12)
      throw new Error('Số tháng tạo lịch phải từ 1 đến 12');
    data.maxGenerateScheduleMonths = workConfig.maxGenerateScheduleMonths;
  }

  if (workConfig.timezone !== undefined) data.timezone = workConfig.timezone;

  // Accept workShifts array -> validate structure and no duplicate names
  if (Array.isArray(workConfig.workShifts)) {
    const names = new Set();
    for (const shift of workConfig.workShifts) {
      if (!shift.name || !shift.startTime || !shift.endTime) {
        throw new Error('Mỗi shift phải có name, startTime và endTime');
      }
      // validate time format HH:MM
      const timeRe = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRe.test(shift.startTime) || !timeRe.test(shift.endTime)) {
        throw new Error(`Shift ${shift.name}: thời gian không hợp lệ (HH:MM)`);
      }
      const [sh, sm] = shift.startTime.split(':').map(Number);
      const [eh, em] = shift.endTime.split(':').map(Number);
      if (sh * 60 + sm >= eh * 60 + em) {
        throw new Error(`Ca ${shift.displayName || shift.name}: giờ bắt đầu phải < giờ kết thúc`);
      }
      if (names.has(shift.name)) throw new Error('Duplicate shift name trong workShifts');
      names.add(shift.name);
    }
    data.workShifts = workConfig.workShifts;
    // ensure no overlap among provided shifts
    validateNoShiftOverlap(data.workShifts);
  }

  const organization = await orgRepo.updateSingleton(data, currentUser._id);
  if (!organization) throw new Error('Chưa khởi tạo Organization');
  await refreshOrgCache();
  return { message: 'Cập nhật cấu hình lịch thành công', organization };
};

exports.updateFinancialConfiguration = async (currentUser, financialConfig) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật tài chính');
  }

  if (!financialConfig || typeof financialConfig !== 'object') {
    throw new Error('Payload tài chính không hợp lệ');
  }

  const setObj = {};
  if (financialConfig.currency !== undefined) setObj['financialConfig.currency'] = financialConfig.currency;
  if (financialConfig.vatPercentage !== undefined) {
    const v = Number(financialConfig.vatPercentage);
    if (isNaN(v) || v < 0 || v > 100) throw new Error('vatPercentage phải là số 0-100');
    setObj['financialConfig.vatPercentage'] = v;
  }
  // (serviceFeePercentage đã bị xóa, nên không check)

  if (Object.keys(setObj).length === 0) {
    throw new Error('Không có trường tài chính nào để cập nhật');
  }

  const organization = await orgRepo.updateSingleton(setObj, currentUser._id);
  await refreshOrgCache();
  return { message: 'Cập nhật tài chính thành công', organization };
};

exports.updateCancellationPolicy = async (currentUser, cancellationPolicy) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật chính sách hủy');
  }
  if (!cancellationPolicy || typeof cancellationPolicy !== 'object') throw new Error('Payload không hợp lệ');

  const setObj = {};
  if (cancellationPolicy.allowCancellation !== undefined) setObj['cancellationPolicy.allowCancellation'] = cancellationPolicy.allowCancellation;
  if (cancellationPolicy.minHoursBeforeCancellation !== undefined) {
    const v = Number(cancellationPolicy.minHoursBeforeCancellation);
    if (isNaN(v) || v < 1) throw new Error('minHoursBeforeCancellation phải >= 1');
    setObj['cancellationPolicy.minHoursBeforeCancellation'] = v;
  }
  if (cancellationPolicy.refundPolicy !== undefined) setObj['cancellationPolicy.refundPolicy'] = cancellationPolicy.refundPolicy;
  if (cancellationPolicy.refundPercentage !== undefined) {
    const p = Number(cancellationPolicy.refundPercentage);
    if (isNaN(p) || p < 0 || p > 100) throw new Error('refundPercentage phải 0-100');
    setObj['cancellationPolicy.refundPercentage'] = p;
  }
  if (cancellationPolicy.notes !== undefined) setObj['cancellationPolicy.notes'] = cancellationPolicy.notes;

  if (Object.keys(setObj).length === 0) throw new Error('Không có trường nào để cập nhật');

  const organization = await orgRepo.updateSingleton(setObj, currentUser._id);
  await refreshOrgCache();
  return { message: 'Cập nhật chính sách hủy thành công', organization };
};

exports.updateStaffAllocationRules = async (currentUser, staffRules) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Không có quyền cập nhật phân bổ nhân sự');
  }
  if (!staffRules || typeof staffRules !== 'object') throw new Error('Payload không hợp lệ');

  // Removed requireBothDentistAndNurse per request:
  const setObj = {};
  if (staffRules.maxDentistPerSlot !== undefined) {
    const v = Number(staffRules.maxDentistPerSlot);
    if (isNaN(v) || v < 1) throw new Error('maxDentistPerSlot phải >= 1');
    setObj['staffAllocationRules.maxDentistPerSlot'] = v;
  }
  if (staffRules.maxNursePerSlot !== undefined) {
    const v = Number(staffRules.maxNursePerSlot);
    if (isNaN(v) || v < 0) throw new Error('maxNursePerSlot phải >= 0');
    setObj['staffAllocationRules.maxNursePerSlot'] = v;
  }
  // any other fields allowed can be added here

  if (Object.keys(setObj).length === 0) throw new Error('Không có trường nào để cập nhật');

  const organization = await orgRepo.updateSingleton(setObj, currentUser._id);
  await refreshOrgCache();
  return { message: 'Cập nhật phân bổ nhân sự thành công', organization };
};

// HOLIDAYS
exports.addHoliday = async (currentUser, holidayData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) throw new Error('Không có quyền thêm ngày nghỉ lễ');

  // Validate payload: startDate & endDate required
  if (!holidayData.startDate || !holidayData.endDate) throw new Error('Phải cung cấp startDate và endDate (single day: same date)');
  const s = new Date(holidayData.startDate);
  const e = new Date(holidayData.endDate);
  if (isNaN(s) || isNaN(e)) throw new Error('startDate/endDate không hợp lệ');
  if (s > e) throw new Error('startDate phải <= endDate');
  // optional: prevent adding past endDate
  // if (e < new Date(new Date().toDateString())) throw new Error('Không thể thêm ngày trong quá khứ');

  // Overlap validation against existing holidays
  const org = await orgRepo.getSingleton();
  const newStart = startOfDay(s);
  const newEnd = startOfDay(e);
  const isRec = !!holidayData.isRecurring;

  // Prepare recurring sets for fast lookup
  const existingRecurring = [];
  const existingNonRecurring = [];
  for (const h of org.holidays || []) {
    if (h.isRecurring) {
      existingRecurring.push({
        set: buildRecurringSet(startOfDay(h.startDate), startOfDay(h.endDate)),
        name: h.name
      });
    } else {
      existingNonRecurring.push({ start: startOfDay(h.startDate), end: startOfDay(h.endDate), name: h.name });
    }
  }

  if (!isRec) {
    // Check against non-recurring
    for (const ex of existingNonRecurring) {
      if (dateRangeOverlap(newStart, newEnd, ex.start, ex.end)) {
        throw new Error(`Khoảng nghỉ lễ trùng với "${ex.name}"`);
      }
    }
    // Check against recurring by day-month
    if (existingRecurring.length) {
      for (const d of expandRangeDays(newStart, newEnd)) {
        const key = mmdd(d);
        for (const ex of existingRecurring) {
          if (ex.set.has(key)) throw new Error(`Ngày ${key} trùng với nghỉ lễ lặp lại "${ex.name}"`);
        }
      }
    }
  } else {
    // New recurring: ensure no overlap with existing recurring
    const newSet = buildRecurringSet(newStart, newEnd);
    for (const ex of existingRecurring) {
      for (const key of newSet) {
        if (ex.set.has(key)) throw new Error(`Khoảng nghỉ lặp lại trùng với "${ex.name}"`);
      }
    }
    // And with non-recurring by day-month
    for (const ex of existingNonRecurring) {
      for (const d of expandRangeDays(ex.start, ex.end)) {
        if (newSet.has(mmdd(d))) throw new Error(`Khoảng nghỉ lặp lại trùng ngày với "${ex.name}"`);
      }
    }
  }

  const updatedOrg = await orgRepo.addHoliday({
    name: holidayData.name,
    startDate: s,
    endDate: e,
    type: holidayData.type,
    isRecurring: !!holidayData.isRecurring
  });
  await refreshOrgCache();
  return { message: 'Thêm ngày nghỉ lễ thành công', organization: updatedOrg };
};

exports.updateHoliday = async (currentUser, holidayId, holidayData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) throw new Error('Không có quyền cập nhật ngày nghỉ lễ');

  const payload = {};
  if (holidayData.name !== undefined) payload.name = holidayData.name;
  if ((holidayData.startDate && !holidayData.endDate) || (!holidayData.startDate && holidayData.endDate)) {
    throw new Error('Cập nhật khoảng ngày phải cung cấp cả startDate và endDate');
  }
  if (holidayData.startDate && holidayData.endDate) {
    const s = new Date(holidayData.startDate);
    const e = new Date(holidayData.endDate);
    if (isNaN(s) || isNaN(e)) throw new Error('startDate/endDate không hợp lệ');
    if (s > e) throw new Error('startDate phải <= endDate');
    payload.startDate = s;
    payload.endDate = e;
  }
  if (holidayData.type !== undefined) payload.type = holidayData.type;
  if (holidayData.isRecurring !== undefined) payload.isRecurring = !!holidayData.isRecurring;

  // Overlap validation: simulate updated holiday against others
  const org = await orgRepo.getSingleton();
  const target = (org.holidays || []).find(h => String(h._id) === String(holidayId));
  if (!target) throw new Error('Không tìm thấy holiday');

  const newStart = startOfDay(payload.startDate || target.startDate);
  const newEnd = startOfDay(payload.endDate || target.endDate);
  const isRec = payload.isRecurring !== undefined ? payload.isRecurring : !!target.isRecurring;

  const existingRecurring = [];
  const existingNonRecurring = [];
  for (const h of org.holidays || []) {
    if (String(h._id) === String(holidayId)) continue; // exclude self
    if (h.isRecurring) {
      existingRecurring.push({
        set: buildRecurringSet(startOfDay(h.startDate), startOfDay(h.endDate)),
        name: h.name
      });
    } else {
      existingNonRecurring.push({ start: startOfDay(h.startDate), end: startOfDay(h.endDate), name: h.name });
    }
  }

  if (!isRec) {
    for (const ex of existingNonRecurring) {
      if (dateRangeOverlap(newStart, newEnd, ex.start, ex.end)) {
        throw new Error(`Khoảng nghỉ lễ trùng với "${ex.name}"`);
      }
    }
    for (const d of expandRangeDays(newStart, newEnd)) {
      const key = mmdd(d);
      for (const ex of existingRecurring) {
        if (ex.set.has(key)) throw new Error(`Ngày ${key} trùng với nghỉ lễ lặp lại "${ex.name}"`);
      }
    }
  } else {
    const newSet = buildRecurringSet(newStart, newEnd);
    for (const ex of existingRecurring) {
      for (const key of newSet) {
        if (ex.set.has(key)) throw new Error(`Khoảng nghỉ lặp lại trùng với "${ex.name}"`);
      }
    }
    for (const ex of existingNonRecurring) {
      for (const d of expandRangeDays(ex.start, ex.end)) {
        if (newSet.has(mmdd(d))) throw new Error(`Khoảng nghỉ lặp lại trùng ngày với "${ex.name}"`);
      }
    }
  }

  const updatedOrg = await orgRepo.updateHoliday(holidayId, payload);
  await refreshOrgCache();
  return { message: 'Cập nhật ngày nghỉ lễ thành công', organization: updatedOrg };
};

exports.removeHoliday = async (currentUser, holidayId) => {
  if (!['admin', 'manager'].includes(currentUser.role)) throw new Error('Không có quyền xóa ngày nghỉ lễ');

  const updatedOrg = await orgRepo.removeHoliday(holidayId);
  await refreshOrgCache();
  return { message: 'Xóa ngày nghỉ lễ thành công', organization: updatedOrg };
};

// SHIFTS: updateWorkShift and toggleWorkShift use repo functions which return updated org
exports.updateWorkShift = async (currentUser, shiftName, shiftData) => {
  if (!['admin', 'manager'].includes(currentUser.role)) throw new Error('Không có quyền');
  // validate times if present
  if (shiftData.startTime && shiftData.endTime) {
    const [sh, sm] = shiftData.startTime.split(':').map(Number);
    const [eh, em] = shiftData.endTime.split(':').map(Number);
    if (sh * 60 + sm >= eh * 60 + em) throw new Error('Giờ bắt đầu phải < giờ kết thúc');
  }
  // Check overlap with existing shifts when applying this change
  const org = await orgRepo.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');
  const simulated = (org.workShifts || []).map(s => ({ ...s }));
  const idx = simulated.findIndex(s => s.name === shiftName);
  if (idx === -1) throw new Error('Không tìm thấy ca');
  simulated[idx] = {
    ...simulated[idx],
    ...shiftData,
  };
  // If times missing in shiftData, keep existing so validation can run
  validateNoShiftOverlap(simulated);

  const updatedOrg = await orgRepo.updateWorkShift(shiftName, shiftData);
  await refreshOrgCache();
  return { message: 'Cập nhật ca làm việc thành công', organization: updatedOrg };
};

exports.toggleWorkShift = async (currentUser, shiftName, isActive) => {
  if (!['admin', 'manager'].includes(currentUser.role)) throw new Error('Không có quyền');
  const updatedOrg = await orgRepo.toggleWorkShift(shiftName, isActive);
  await refreshOrgCache();
  return { message: `${isActive ? 'Kích hoạt' : 'Vô hiệu hóa'} ca thành công`, organization: updatedOrg };
};

// VALIDATIONS
exports.isHolidayDate = async (date) => {
  const org = await this.getOrganization();
  return org.isHoliday(date);
};

exports.validateBookingDate = async (bookingDate) => {
  const workConfig = await this.getWorkConfiguration();
  const today = new Date();
  const maxDate = new Date();
  maxDate.setDate(today.getDate() + workConfig.maxBookingDays);

  const d = new Date(bookingDate);
  if (d < today) throw new Error('Không thể đặt lịch trong quá khứ');
  if (d > maxDate) throw new Error(`Chỉ đặt lịch trước tối đa ${workConfig.maxBookingDays} ngày`);
  if (await this.isHolidayDate(bookingDate)) throw new Error('Không thể đặt vào ngày nghỉ lễ');
  return true;
};

// PUBLIC
exports.getPublicOrganizationInfo = async () => {
  const org = await this.getOrganization();
  return {
    name: org.name,
    address: org.address,
    contactInfo: org.contactInfo,
    logo: org.logo,
    workShifts: org.getActiveWorkShifts(),
    timezone: org.timezone,
    maxBookingDays: org.maxBookingDays,
    unitDuration: org.unitDuration,
    allowOnlineBooking: org.operatingSettings?.allowOnlineBooking
  };
};

exports.getScheduleAnalytics = async () => {
  const org = await orgRepo.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');
  let slotsPerDay = 0;
  org.getActiveWorkShifts().forEach(shift => slotsPerDay += org.getTotalSlotsPerShift(shift.name));
  return {
    activeShifts: org.getActiveWorkShifts().length,
    totalShifts: org.workShifts.length,
    slotsPerDay,
    unitDuration: org.unitDuration,
    maxBookingDays: org.maxBookingDays,
    totalHolidays: org.holidays.length,
    upcomingHolidays: org.holidays.filter(h => new Date(h.endDate) >= startOfDay(new Date())).length
  };
};

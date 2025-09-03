const shiftRepo = require('../repositories/shift.repository');
const redis = require('../utils/redis.client');

const SHIFT_CACHE_KEY = 'shifts_cache';

async function initShiftCache() {
  const shifts = await shiftRepo.listShifts();
  await redis.set(SHIFT_CACHE_KEY, JSON.stringify(shifts));
  console.log(`✅ Đã tải bộ nhớ đệm ca/kíp: ${shifts.length} ca/kíp`);
}

exports.createShift = async (data) => {
  const shift = await shiftRepo.createShift(data);
  await refreshShiftCache();
  return shift;
};

exports.updateShift = async (shiftId, data) => {
  const updated = await shiftRepo.updateShift(shiftId, data);
  await refreshShiftCache();
  return updated;
};

exports.toggleStatus = async (id) => {
  const toggled = await shiftRepo.toggleStatus(id);
  await refreshShiftCache();
  return toggled;
};

exports.listShifts = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  // 👉 không cache toàn bộ, vì phân trang sẽ query theo skip/limit
  const [shifts, total] = await Promise.all([
    shiftRepo.listShifts(skip, limit),
    shiftRepo.countShifts()
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    shifts
  };
};

exports.searchShift = async (keyword, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [shifts, total] = await Promise.all([
    shiftRepo.searchShift(keyword, skip, limit),
    shiftRepo.countSearchShift(keyword)
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    shifts
  };
};

async function refreshShiftCache() {
  const shifts = await shiftRepo.listShifts();
  await redis.set(SHIFT_CACHE_KEY, JSON.stringify(shifts));
  console.log(`♻ Đã làm mới bộ nhớ đệm ca/kíp: ${shifts.length} ca/kíp`);
}

initShiftCache().catch(err => console.error('❌ Không thể tải bộ nhớ đệm ca/kíp:', err));

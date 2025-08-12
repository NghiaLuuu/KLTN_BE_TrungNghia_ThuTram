const shiftRepo = require('../repositories/shift.repository');
const redis = require('../utils/redis.client');

const SHIFT_CACHE_KEY = 'shifts_cache';

async function initShiftCache() {
  const shifts = await shiftRepo.listShifts();
  await redis.set(SHIFT_CACHE_KEY, JSON.stringify(shifts));
  console.log(`✅ Shift cache loaded: ${shifts.length} shifts`);
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

exports.listShifts = async () => {
  let cached = await redis.get(SHIFT_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const shifts = await shiftRepo.listShifts();
  await redis.set(SHIFT_CACHE_KEY, JSON.stringify(shifts));
  return shifts;
};

exports.searchShift = async (keyword) => {
  const shifts = await this.listShifts();
  return shifts.filter(shift =>
    shift.name.toLowerCase().includes(keyword.toLowerCase())
  );
};

async function refreshShiftCache() {
  const shifts = await shiftRepo.listShifts();
  await redis.set(SHIFT_CACHE_KEY, JSON.stringify(shifts));
  console.log(`♻ Shift cache refreshed: ${shifts.length} shifts`);
}

initShiftCache().catch(err => console.error('❌ Failed to load shift cache:', err));

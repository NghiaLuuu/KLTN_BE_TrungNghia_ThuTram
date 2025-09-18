const Organization = require('../models/organization.model');

// Create once
exports.initSingleton = async (orgData) => {
  const existing = await Organization.getSingleton();
  if (existing) throw new Error('Organization đã tồn tại');
  const org = new Organization({ ...orgData, isDefault: true });
  return org.save();
};

exports.getSingleton = async () => {
  // Try explicit singletonKey first (preferred)
  let org = await Organization.findOne({ singletonKey: 'ORGANIZATION_SINGLETON' }).lean();
  if (org) return org;
  // Fallback: return any organization document (for older DBs created before singletonKey existed)
  org = await Organization.findOne({}).lean();
  return org;
};

exports.updateSingleton = async (updateData, updatedBy) => {
  const setObj = { ...updateData };
  if (updatedBy) setObj.updatedBy = updatedBy;
  return await Organization.findOneAndUpdate(
    { singletonKey: 'ORGANIZATION_SINGLETON' },
    { $set: setObj },
    { new: true, runValidators: true }
  ).lean();
};

// CONFIG GETTERS
exports.getWorkConfiguration = async () => {
  const org = await Organization.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');
  return {
    workShifts: org.getActiveWorkShifts(),
    unitDuration: org.unitDuration,
    holidays: org.holidays,
    maxBookingDays: org.maxBookingDays,
    maxGenerateScheduleMonths: org.maxGenerateScheduleMonths,
    timezone: org.timezone
  };
};

exports.getFinancialConfiguration = async () => {
  const org = await Organization.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');
  return org.financialConfig;
};

exports.getCancellationPolicy = async () => {
  const org = await Organization.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');
  return org.cancellationPolicy;
};

exports.getStaffAllocationRules = async () => {
  const org = await Organization.getSingleton();
  if (!org) throw new Error('Chưa khởi tạo Organization');
  return org.staffAllocationRules;
};

// HOLIDAYS
exports.addHoliday = async (holidayData) => {
  // holidayData must contain startDate and endDate (single day allowed)
  return await Organization.findOneAndUpdate(
    { singletonKey: 'ORGANIZATION_SINGLETON' },
    { $push: { holidays: holidayData } },
    { new: true, runValidators: true }
  ).lean();
};

exports.updateHoliday = async (holidayId, holidayData) => {
  const setObj = {};
  if (holidayData.name !== undefined) setObj['holidays.$.name'] = holidayData.name;
  if (holidayData.startDate !== undefined) setObj['holidays.$.startDate'] = holidayData.startDate;
  if (holidayData.endDate !== undefined) setObj['holidays.$.endDate'] = holidayData.endDate;
  if (holidayData.type !== undefined) setObj['holidays.$.type'] = holidayData.type;
  if (holidayData.isRecurring !== undefined) setObj['holidays.$.isRecurring'] = holidayData.isRecurring;

  return await Organization.findOneAndUpdate(
    { singletonKey: 'ORGANIZATION_SINGLETON', 'holidays._id': holidayId },
    { $set: setObj },
    { new: true, runValidators: true }
  ).lean();
};

exports.removeHoliday = async (holidayId) => {
  return await Organization.findOneAndUpdate(
    { singletonKey: 'ORGANIZATION_SINGLETON' },
    { $pull: { holidays: { _id: holidayId } } },
    { new: true }
  ).lean();
};

// WORK SHIFTS
exports.updateWorkShift = async (shiftName, shiftData) => {
  const setObj = {};
  if (shiftData.displayName !== undefined) setObj['workShifts.$.displayName'] = shiftData.displayName;
  if (shiftData.startTime !== undefined) setObj['workShifts.$.startTime'] = shiftData.startTime;
  if (shiftData.endTime !== undefined) setObj['workShifts.$.endTime'] = shiftData.endTime;
  if (shiftData.isActive !== undefined) setObj['workShifts.$.isActive'] = shiftData.isActive;
  return await Organization.findOneAndUpdate(
    { singletonKey: 'ORGANIZATION_SINGLETON', 'workShifts.name': shiftName },
    { $set: setObj },
    { new: true, runValidators: true }
  ).lean();
};

exports.toggleWorkShift = async (shiftName, isActive) => {
  return await Organization.findOneAndUpdate(
    { singletonKey: 'ORGANIZATION_SINGLETON', 'workShifts.name': shiftName },
    { $set: { 'workShifts.$.isActive': isActive } },
    { new: true, runValidators: true }
  ).lean();
};

exports.findOne = async () => {
  return await Organization.findOne({ singletonKey: 'ORGANIZATION_SINGLETON' }).lean();
};
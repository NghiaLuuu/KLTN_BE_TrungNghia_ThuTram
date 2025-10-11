const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const redisClient = require('../utils/redis.client');
const { publishToQueue } = require('../utils/rabbitClient');
const { getVietnamDate, toVietnamTime } = require('../utils/vietnamTime.util');
const mongoose = require('mongoose');

// ⭐ Date/Time formatting helpers for Vietnam timezone
function toVNDateOnlyString(d) {
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vn.getFullYear();
  const m = String(vn.getMonth() + 1).padStart(2, '0');
  const day = String(vn.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toVNTimeString(d) {
  if (!d) return null;
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const h = String(vn.getHours()).padStart(2, '0');
  const m = String(vn.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function toVNDateTimeString(d) {
  if (!d) return null;
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const dateStr = toVNDateOnlyString(d);
  const timeStr = toVNTimeString(d);
  return `${dateStr} ${timeStr}`;
}

// Helper: Check if user already marked as used in cache
async function isUserAlreadyUsed(userId) {
  try {
    const cached = await redisClient.get('users_cache');
    if (!cached) return false;
    const users = JSON.parse(cached);
    const user = users.find(u => u._id === userId);
    return user && user.hasBeenUsed === true;
  } catch (error) {
    console.warn('Failed to check user cache:', error.message);
    return false; // If cache fails, proceed with marking
  }
}

// Helper: Get current quarter and year information in Vietnam timezone
function getCurrentQuarterInfo() {
  const vnNow = getVietnamDate();
  const quarter = Math.ceil((vnNow.getMonth() + 1) / 3);
  const year = vnNow.getFullYear();
  return { quarter, year, currentDate: vnNow };
}

// Helper: Validate quarter and year against current time
function validateQuarterYear(quarter, year) {
  const { quarter: currentQuarter, year: currentYear } = getCurrentQuarterInfo();
  
  // Check if quarter is in the past
  if (year < currentYear || (year === currentYear && quarter < currentQuarter)) {
    throw new Error(`Không thể cập nhật quý ${quarter}/${year} vì đã thuộc quá khứ. Quý hiện tại là ${currentQuarter}/${currentYear}`);
  }
  
  return true;
}

function buildShiftOverviewFromConfig(scheduleConfig) {
  if (!scheduleConfig) return {};
  const overview = {};

  const morning = scheduleConfig.morningShift || {};
  const afternoon = scheduleConfig.afternoonShift || {};
  const evening = scheduleConfig.eveningShift || {};

  overview[morning.name || 'Ca Sáng'] = {
    name: morning.name || 'Ca Sáng',
    startTime: morning.startTime || '--:--',
    endTime: morning.endTime || '--:--',
    isActive: morning.isActive !== false
  };

  overview[afternoon.name || 'Ca Chiều'] = {
    name: afternoon.name || 'Ca Chiều',
    startTime: afternoon.startTime || '--:--',
    endTime: afternoon.endTime || '--:--',
    isActive: afternoon.isActive !== false
  };

  overview[evening.name || 'Ca Tối'] = {
    name: evening.name || 'Ca Tối',
    startTime: evening.startTime || '--:--',
    endTime: evening.endTime || '--:--',
    isActive: evening.isActive !== false
  };

  return overview;
}

function normalizeTimeForComparison(time) {
  if (typeof time !== 'string') return null;
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  return time;
}

function pickEarlierTime(existing, candidate) {
  const e = normalizeTimeForComparison(existing);
  const c = normalizeTimeForComparison(candidate);

  if (!e && !c) return candidate || existing;
  if (!e) return candidate || existing;
  if (!c) return existing;
  return c < e ? candidate : existing;
}

function pickLaterTime(existing, candidate) {
  const e = normalizeTimeForComparison(existing);
  const c = normalizeTimeForComparison(candidate);

  if (!e && !c) return candidate || existing;
  if (!e) return candidate || existing;
  if (!c) return existing;
  return c > e ? candidate : existing;
}

function buildShiftOverviewFromSchedules(schedules, scheduleConfig) {
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return {};
  }

  const defaultsByKey = {
    morning: scheduleConfig?.morningShift || {},
    afternoon: scheduleConfig?.afternoonShift || {},
    evening: scheduleConfig?.eveningShift || {}
  };

  const defaultNameByKey = {
    morning: defaultsByKey.morning.name || 'Ca Sáng',
    afternoon: defaultsByKey.afternoon.name || 'Ca Chiều',
    evening: defaultsByKey.evening.name || 'Ca Tối'
  };

  const overview = {};

  schedules.forEach(schedule => {
    if (!schedule || schedule.isActive === false) return;
    const shiftConfig = schedule.shiftConfig || {};

    ['morning', 'afternoon', 'evening'].forEach(key => {
      const cfg = shiftConfig[key];
      if (!cfg || cfg.isGenerated !== true) return;

      const displayName = cfg.name || defaultNameByKey[key];
      if (!displayName) return;

      const startTime = cfg.startTime || defaultsByKey[key]?.startTime || '--:--';
      const endTime = cfg.endTime || defaultsByKey[key]?.endTime || '--:--';
      const isActive = cfg.isActive !== false;

      const existing = overview[displayName];
      if (!existing) {
        overview[displayName] = {
          name: displayName,
          startTime,
          endTime,
          isActive
        };
      } else {
        overview[displayName] = {
          name: displayName,
          startTime: pickEarlierTime(existing.startTime, startTime) || existing.startTime || startTime,
          endTime: pickLaterTime(existing.endTime, endTime) || existing.endTime || endTime,
          isActive: existing.isActive || isActive
        };
      }
    });
  });

  return overview;
}

// Helper: Get available quarters and years for staff assignment (chỉ những quý đã có lịch)
async function getAvailableQuartersYears() {
  try {
    // Sử dụng logic từ schedule service để lấy danh sách quý
    const scheduleService = require('./schedule.service');
    const allQuarters = await scheduleService.getAvailableQuarters();
    
    // Lọc chỉ những quý đã có lịch (hasSchedules: true hoặc isCreated: true)
    const quartersWithSchedules = allQuarters.filter(q => q.hasSchedules === true || q.isCreated === true);
    
    const { quarter: currentQuarter, year: currentYear } = getCurrentQuarterInfo();
    
    // Map sang format cần thiết cho slot assignment
    const availableOptions = quartersWithSchedules.map(q => ({
      quarter: q.quarter,
      year: q.year,
      label: (q.quarter === currentQuarter && q.year === currentYear) ? 
        `Quý ${q.quarter}/${q.year} (Hiện tại)` : 
        `Quý ${q.quarter}/${q.year}`,
      isCurrent: q.quarter === currentQuarter && q.year === currentYear,
      hasSchedules: q.hasSchedules,
      isCreated: q.isCreated
    }));
    
    return {
      currentQuarter: { quarter: currentQuarter, year: currentYear, currentDate: getVietnamDate() },
      availableOptions
    };
  } catch (error) {
    throw new Error(`Không thể lấy danh sách quý có lịch: ${error.message}`);
  }
}

// Helper: Get available work shifts from ScheduleConfig
async function getAvailableShifts() {
  try {
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const config = await ScheduleConfig.getSingleton();
    
    if (!config) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo');
    }
    
    const shifts = config.getWorkShifts();
    
    return shifts.map(shift => ({
      value: shift.name,
      label: shift.name,
      timeRange: `${shift.startTime} - ${shift.endTime}`
    }));
  } catch (error) {
    throw new Error(`Không thể lấy danh sách ca làm việc: ${error.message}`);
  }
}

// Helper: Get room information
async function getRoomInfo(roomId) {
  try {
    const cached = await redisClient.get('rooms_cache');
    if (!cached) throw new Error('rooms_cache không tồn tại');
    const rooms = JSON.parse(cached);
    const room = rooms.find(r => r._id.toString() === roomId.toString());
    if (!room) throw new Error('Không tìm thấy phòng trong cache');
    return room;
  } catch (error) {
    throw new Error(`Không thể lấy thông tin phòng: ${error.message}`);
  }
}

// Helper: Mark single user as used
async function markUserAsUsed(userId) {
  try {
    if (!userId) return;
    
    // Check cache first to avoid unnecessary updates
    const alreadyUsed = await isUserAlreadyUsed(userId);
    if (alreadyUsed) {
      console.log(`⚡ Skipping user ${userId} - already marked as used in cache`);
      return;
    }
    
    await publishToQueue('auth_queue', {
      action: 'markUserAsUsed',
      payload: { userId }
    });
    console.log(`📤 Sent markUserAsUsed message for user ${userId}`);
  } catch (error) {
    console.warn(`⚠️ Failed to mark user ${userId} as used:`, error.message);
  }
}

// Helper: Mark entities as used when assigned to slots
async function markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds }) {
  try {
    // Mark room as used via RabbitMQ
    if (roomId) {
      await publishToQueue('room_queue', {
        action: 'markRoomAsUsed',
        payload: { roomId }
      });
      console.log(`📤 Sent markRoomAsUsed message for room ${roomId}`);
    }
    
    // Mark subRoom as used via RabbitMQ
    if (subRoomId) {
      await publishToQueue('room_queue', {
        action: 'markSubRoomAsUsed',
        payload: { roomId, subRoomId }
      });
      console.log(`📤 Sent markSubRoomAsUsed message for subRoom ${subRoomId}`);
    }
    
    // Mark staff as used via RabbitMQ (check cache first)
    for (const dentistId of dentistIds) {
      if (dentistId) {
        // Check cache first to avoid unnecessary updates
        const alreadyUsed = await isUserAlreadyUsed(dentistId);
        if (alreadyUsed) {
          console.log(`⚡ Skipping dentist ${dentistId} - already marked as used in cache`);
          continue;
        }
        
        await publishToQueue('auth_queue', {
          action: 'markUserAsUsed',
          payload: { userId: dentistId }
        });
        console.log(`📤 Sent markUserAsUsed message for dentist ${dentistId}`);
      }
    }
    
    for (const nurseId of nurseIds) {
      if (nurseId) {
        // Check cache first to avoid unnecessary updates
        const alreadyUsed = await isUserAlreadyUsed(nurseId);
        if (alreadyUsed) {
          console.log(`⚡ Skipping nurse ${nurseId} - already marked as used in cache`);
          continue;
        }
        
        await publishToQueue('auth_queue', {
          action: 'markUserAsUsed',
          payload: { userId: nurseId }
        });
        console.log(`📤 Sent markUserAsUsed message for nurse ${nurseId}`);
      }
    }
  } catch (error) {
    console.warn('⚠️ Failed to mark entities as used:', error.message);
    // Don't throw error - this is non-critical for slot assignment
  }
}

// Helper: Validate staff IDs against Redis users cache
async function validateStaffIds(dentistIds, nurseIds) {
  try {
    const cached = await redisClient.get('users_cache');
    if (!cached) throw new Error('users_cache không tồn tại');
    const users = JSON.parse(cached);
    
    // Validate dentist IDs
    for (const dentistId of dentistIds) {
      if (!dentistId) continue;
      const dentist = users.find(u => u._id === dentistId && u.role === 'dentist' && u.isActive);
      if (!dentist) {
        throw new Error(`dentistId ${dentistId} không hợp lệ hoặc không phải nha sĩ`);
      }
    }
    
    // Validate nurse IDs
    for (const nurseId of nurseIds) {
      if (!nurseId) continue;
      const nurse = users.find(u => u._id === nurseId && u.role === 'nurse' && u.isActive);
      if (!nurse) {
        throw new Error(`nurseId ${nurseId} không hợp lệ hoặc không phải y tá`);
      }
    }
  } catch (error) {
    throw new Error(`Lỗi kiểm tra thông tin nhân sự: ${error.message}`);
  }
}

// Helper: Validate staff assignment based on room type
async function validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds) {
  const room = await getRoomInfo(roomId);
  // If subRoomId provided, validate it belongs to the given room
  if (subRoomId) {
    if (!room.subRooms || room.subRooms.length === 0) {
      throw new Error('Phòng không có subRoom nhưng bạn đã gửi subRoomId');
    }
    const found = room.subRooms.find(sr => sr._id && sr._id.toString() === subRoomId.toString());
    if (!found) {
      throw new Error('subRoomId không thuộc về roomId đã chỉ định');
    }

    // Room with subrooms - use 1-1 constraint
    if (dentistIds.length > 1 || nurseIds.length > 1) {
      throw new Error('Phòng có subroom chỉ được phân công 1 nha sĩ và 1 y tá cho mỗi slot');
    }
  } else {
    // Room without subrooms - use maxDoctor/maxNurse constraint  
    if (dentistIds.length > room.maxDoctor) {
      throw new Error(`Phòng này chỉ được phân công tối đa ${room.maxDoctor} nha sĩ`);
    }
    if (nurseIds.length > room.maxNurse) {
      throw new Error(`Phòng này chỉ được phân công tối đa ${room.maxNurse} y tá`);
    }
  }
}

// 🆕 Assign staff to specific selected slots (new logic)
async function assignStaffToSpecificSlots({
  slotIds = [],
  dentistIds = [],
  nurseIds = [],
  roomId = null,
  subRoomId = null
}) {
  try {
    console.log('🎯 assignStaffToSpecificSlots called:', { slotIds, dentistIds, nurseIds, roomId, subRoomId });
    
    if (!Array.isArray(slotIds) || slotIds.length === 0) {
      throw new Error('slotIds là bắt buộc và phải là mảng không rỗng');
    }

    if (dentistIds.length === 0 && nurseIds.length === 0) {
      throw new Error('Phải chọn ít nhất 1 nha sĩ hoặc 1 y tá để phân công');
    }

    // Get current time in Vietnam timezone with 15-minute buffer
    const vietnamNow = getVietnamDate();
    vietnamNow.setMinutes(vietnamNow.getMinutes() + 15);

    // Find all slots by IDs and validate they exist and are future slots
    const slots = await slotRepo.find({
      _id: { $in: slotIds },
      isActive: true,
      startTime: { $gt: vietnamNow } // Only allow assigning to future slots
    });

    console.log(`📊 Found ${slots.length} slots out of ${slotIds.length} requested`);
    console.log('🔍 Slot details:', slots.map(s => ({
      _id: s._id,
      dentist: s.dentist,
      nurse: s.nurse,
      isMongooseDoc: typeof s.save === 'function'
    })));

    if (slots.length === 0) {
      throw new Error('Không tìm thấy slot nào hợp lệ để phân công (có thể đã qua hoặc không tồn tại)');
    }

    if (slots.length !== slotIds.length) {
      const foundIds = slots.map(s => s._id.toString());
      const missingIds = slotIds.filter(id => !foundIds.includes(id.toString()));
      console.warn('⚠️ Some slots not found or not valid:', missingIds);
    }

    // Optional: Validate room consistency if roomId is provided
    if (roomId) {
      const differentRoomSlots = slots.filter(s => s.roomId && s.roomId.toString() !== roomId.toString());
      if (differentRoomSlots.length > 0) {
        throw new Error(`Một số slot không thuộc phòng đã chỉ định`);
      }
    }

    // Optional: Validate subRoom consistency if subRoomId is provided
    if (subRoomId) {
      const differentSubRoomSlots = slots.filter(s => {
        const slotSubRoomId = s.subRoomId ? s.subRoomId.toString() : null;
        return slotSubRoomId !== subRoomId.toString();
      });
      if (differentSubRoomSlots.length > 0) {
        throw new Error(`Một số slot không thuộc subRoom đã chỉ định`);
      }
    }

    // Get room info for validation (use first slot's roomId if not provided)
    const targetRoomId = roomId || slots[0].roomId;
    const targetSubRoomId = subRoomId || slots[0].subRoomId;
    
    if (targetRoomId) {
      await validateStaffAssignment(targetRoomId, targetSubRoomId, dentistIds, nurseIds);
    }

    // Update all slots with the assigned staff
    let updatedCount = 0;
    const updatedSlots = [];

    for (const slot of slots) {
      let hasChanges = false;

      // Get room info once for this slot
      const room = await getRoomInfo(slot.roomId);
      const hasSubRooms = room.subRooms && room.subRooms.length > 0;

      console.log(`\n🔄 Processing slot ${slot._id}:`);
      console.log(`   Current dentist: ${slot.dentist}`);
      console.log(`   Current nurse: ${slot.nurse}`);

      // Assign dentists
      if (dentistIds.length > 0) {
        // Convert all dentist IDs to ObjectId array
        const dentistObjectIds = dentistIds.map(id => 
          mongoose.Types.ObjectId.isValid(id) 
            ? new mongoose.Types.ObjectId(id)
            : id
        );
        
        slot.dentist = dentistObjectIds;
        slot.markModified('dentist');
        hasChanges = true;
        console.log(`  ✏️ Assigned ${dentistObjectIds.length} dentist(s) to slot ${slot._id}:`, dentistObjectIds);
      }

      // Assign nurses
      if (nurseIds.length > 0) {
        // Convert all nurse IDs to ObjectId array
        const nurseObjectIds = nurseIds.map(id =>
          mongoose.Types.ObjectId.isValid(id)
            ? new mongoose.Types.ObjectId(id)
            : id
        );
        
        slot.nurse = nurseObjectIds;
        slot.markModified('nurse');
        hasChanges = true;
        console.log(`  ✏️ Assigned ${nurseObjectIds.length} nurse(s) to slot ${slot._id}:`, nurseObjectIds);
      }

      if (hasChanges) {
        console.log(`  💾 Saving slot ${slot._id}...`);
        console.log(`     Before save - dentist: ${slot.dentist}, nurse: ${slot.nurse}`);
        const savedSlot = await slot.save();
        console.log(`  ✅ Slot ${slot._id} saved successfully`);
        console.log(`     After save - dentist: ${savedSlot.dentist}, nurse: ${savedSlot.nurse}`);
        updatedCount++;
        updatedSlots.push({
          slotId: savedSlot._id,
          date: savedSlot.date,
          shiftName: savedSlot.shiftName,
          startTime: savedSlot.startTime,
          endTime: savedSlot.endTime,
          dentist: savedSlot.dentist,
          nurse: savedSlot.nurse
        });
      }
    }

    // Mark staff as used in Redis cache
    const allStaffIds = [...dentistIds, ...nurseIds];
    for (const staffId of allStaffIds) {
      await markUserAsUsed(staffId);
    }

    console.log(`✅ Successfully assigned staff to ${updatedCount}/${slots.length} slots`);

    return {
      success: true,
      message: `Đã phân công thành công ${updatedCount} slot`,
      totalSlots: slots.length,
      updatedSlots: updatedCount,
      slots: updatedSlots,
      dentistIds,
      nurseIds
    };

  } catch (error) {
    console.error('❌ Error in assignStaffToSpecificSlots:', error);
    throw error;
  }
}

// 🆕 Reassign staff for specific slots (replacement workflow)
async function reassignStaffToSpecificSlots({
  slotIds = [],
  oldStaffId,
  newStaffId,
  role // 'dentist' or 'nurse'
}) {
  try {
    console.log('🔄 reassignStaffToSpecificSlots called:', { slotIds, oldStaffId, newStaffId, role });
    
    if (!Array.isArray(slotIds) || slotIds.length === 0) {
      throw new Error('slotIds là bắt buộc và phải là mảng không rỗng');
    }

    if (!oldStaffId || !newStaffId) {
      throw new Error('Phải cung cấp oldStaffId và newStaffId để thay thế');
    }

    if (!role || !['dentist', 'nurse'].includes(role)) {
      throw new Error('role phải là "dentist" hoặc "nurse"');
    }

    // Get current time in Vietnam timezone with 5-minute buffer
    const vietnamNow = getVietnamDate();
    vietnamNow.setMinutes(vietnamNow.getMinutes() + 5);

    // Find all slots by IDs and validate they exist, are future slots, and have the old staff
    const roleField = role === 'dentist' ? 'dentist' : 'nurse';
    const slots = await slotRepo.find({
      _id: { $in: slotIds },
      [roleField]: oldStaffId, // Must be assigned to old staff
      isActive: true,
      startTime: { $gt: vietnamNow } // Only allow reassigning future slots
    });

    console.log(`📊 Found ${slots.length} slots out of ${slotIds.length} requested`);
    console.log('🔍 Slots with old staff:', slots.map(s => ({
      _id: s._id,
      dentist: s.dentist,
      nurse: s.nurse,
      startTime: s.startTime
    })));

    if (slots.length === 0) {
      throw new Error(`Không tìm thấy slot nào được phân công cho ${role === 'dentist' ? 'nha sĩ' : 'y tá'} cũ (có thể đã qua hoặc không tồn tại)`);
    }

    if (slots.length !== slotIds.length) {
      const foundIds = slots.map(s => s._id.toString());
      const missingIds = slotIds.filter(id => !foundIds.includes(id.toString()));
      console.warn('⚠️ Some slots not found or not assigned to old staff:', missingIds);
    }

    // Check if new staff has conflicts
    const minStart = new Date(Math.min(...slots.map(s => new Date(s.startTime).getTime())));
    const maxEnd = new Date(Math.max(...slots.map(s => new Date(s.endTime).getTime())));
    
    const existingSlots = await slotRepo.findByStaffId(newStaffId, minStart, maxEnd);
    
    // Check for time overlaps (excluding the slots we're reassigning)
    const targetSlotIds = new Set(slots.map(s => s._id.toString()));
    for (const slot of slots) {
      const sStart = new Date(slot.startTime);
      const sEnd = new Date(slot.endTime);
      
      const conflict = existingSlots.find(es => 
        !targetSlotIds.has(es._id.toString()) && // Different slot
        new Date(es.startTime) < sEnd && 
        new Date(es.endTime) > sStart
      );
      
      if (conflict) {
        throw new Error(`${role === 'dentist' ? 'Nha sĩ' : 'Y tá'} mới đã được phân công vào slot khác trong cùng khoảng thời gian`);
      }
    }

    // Update all slots: replace old staff with new staff
    let updatedCount = 0;
    const updatedSlots = [];

    for (const slot of slots) {
      console.log(`\n🔄 Processing slot ${slot._id}:`);
      console.log(`   Current ${roleField}: ${slot[roleField]}`);

      // Convert new staff ID to ObjectId
      const newStaffObjectId = mongoose.Types.ObjectId.isValid(newStaffId)
        ? new mongoose.Types.ObjectId(newStaffId)
        : newStaffId;

      // Handle array or single value
      if (Array.isArray(slot[roleField])) {
        // Array case: replace old staff with new staff
        const oldIndex = slot[roleField].findIndex(id => 
          id && id.toString() === oldStaffId.toString()
        );
        
        if (oldIndex !== -1) {
          slot[roleField][oldIndex] = newStaffObjectId;
          slot.markModified(roleField);
          console.log(`  ✏️ Replaced ${roleField} in array at index ${oldIndex}`);
        }
      } else {
        // Single value case: directly replace
        if (slot[roleField] && slot[roleField].toString() === oldStaffId.toString()) {
          slot[roleField] = newStaffObjectId;
          slot.markModified(roleField);
          console.log(`  ✏️ Replaced single ${roleField} value`);
        }
      }

      console.log(`  💾 Saving slot ${slot._id}...`);
      console.log(`     Before save - ${roleField}: ${slot[roleField]}`);
      const savedSlot = await slot.save();
      console.log(`  ✅ Slot ${slot._id} saved successfully`);
      console.log(`     After save - ${roleField}: ${savedSlot[roleField]}`);
      
      updatedCount++;
      updatedSlots.push({
        slotId: savedSlot._id,
        date: savedSlot.date,
        shiftName: savedSlot.shiftName,
        startTime: savedSlot.startTime,
        endTime: savedSlot.endTime,
        dentist: savedSlot.dentist,
        nurse: savedSlot.nurse
      });
    }

    // Mark new staff as used in Redis cache
    await markUserAsUsed(newStaffId);

    console.log(`✅ Successfully reassigned ${updatedCount}/${slots.length} slots from ${oldStaffId} to ${newStaffId}`);

    return {
      success: true,
      message: `Đã thay thế thành công ${updatedCount} slot`,
      totalSlots: slots.length,
      updatedSlots: updatedCount,
      slots: updatedSlots,
      oldStaffId,
      newStaffId,
      role
    };

  } catch (error) {
    console.error('❌ Error in reassignStaffToSpecificSlots:', error);
    throw error;
  }
}

// Assign staff to slots for a room/subroom and shifts
async function assignStaffToSlots({
  roomId,
  subRoomId = null,
  // legacy: date (single day). new: scheduleId (apply to entire schedule/quarter) + shifts
  date,
  // New: accept quarter/year instead of scheduleId; service will resolve scheduleIds for that quarter
  quarter = null,
  year = null,
  shifts = [], // Array of shift names: ['Ca Sáng', 'Ca Chiều', 'Ca Tối']
  dentistIds = [],
  nurseIds = []
}) {
  try {
    // Validate input: require quarter/year for quarter-level assignment
    if (!roomId || !quarter || !year) {
      throw new Error('Room ID, quarter và year là bắt buộc để phân công theo quý');
    }

    if (shifts.length === 0) {
      throw new Error('Phải chọn ít nhất 1 ca làm việc');
    }

    // Validate quarter/year is not in the past
    validateQuarterYear(quarter, year);
    
    // Validate staff assignment based on room type
    await validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds);
    
    // Resolve all schedules for the given quarter/year for this room
    const { getQuarterDateRange } = require('./schedule.service');
    const { startDate, endDate } = getQuarterDateRange(quarter, year);
    const schedules = await require('../repositories/schedule.repository').findByRoomAndDateRange(roomId, startDate, endDate);
    const scheduleIds = schedules.map(s => s._id);
    if (!scheduleIds || scheduleIds.length === 0) {
      throw new Error(`Không tìm thấy lịch làm việc nào cho phòng trong quý ${quarter}/${year}. Vui lòng tạo lịch làm việc trước khi phân công nhân sự.`);
    }

    // Get current time in Vietnam timezone for filtering future slots only
    // Add 15 minutes buffer to current time
    const vietnamNow = getVietnamDate();
    vietnamNow.setMinutes(vietnamNow.getMinutes() + 15);

    // Build query filter: all slots in those schedules that DON'T have FULL staff assigned yet
    // and are in the future (startTime > current Vietnam time + 15 minutes)
    const queryFilter = { 
      roomId, 
      scheduleId: { $in: scheduleIds }, 
      isActive: true,
      startTime: { $gt: vietnamNow }, // Only future slots (with 15-minute buffer)
      // ⭐ KEY: Find slots that are missing dentist OR nurse (not fully staffed)
      // With array schema: check for empty array or missing field
      $or: [
        { dentist: { $size: 0 } },  // Empty dentist array
        { dentist: { $exists: false } },  // No dentist field
        { nurse: { $size: 0 } },  // Empty nurse array
        { nurse: { $exists: false } }  // No nurse field
      ]
    };
    if (shifts && shifts.length) queryFilter.shiftName = { $in: shifts };
    if (subRoomId) queryFilter.subRoomId = subRoomId; else queryFilter.subRoomId = null;

    const slots = await slotRepo.find(queryFilter);
    
    if (slots.length === 0) {
      // Kiểm tra các nguyên nhân có thể xảy ra
      const room = await getRoomInfo(roomId);
      let foundSubRoom = null; // Khai báo biến để sử dụng trong error messages
      
      // 1. Kiểm tra logic subRoom
      if (subRoomId) {
        // User truyền subRoomId nhưng phòng không có subRoom
        if (!room.subRooms || room.subRooms.length === 0) {
          throw new Error(`Phòng "${room.name}" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác.`);
        }
        
        // subRoomId không thuộc phòng này
        foundSubRoom = room.subRooms.find(sr => sr._id && sr._id.toString() === subRoomId.toString());
        if (!foundSubRoom) {
          throw new Error(`SubRoom không thuộc về phòng "${room.name}". Vui lòng kiểm tra lại subRoomId.`);
        }
      } else {
        // User không truyền subRoomId nhưng phòng có subRoom
        if (room.subRooms && room.subRooms.length > 0) {
          const activeSubRooms = room.subRooms.filter(sr => sr.isActive !== false);
          throw new Error(`Phòng "${room.name}" có ${activeSubRooms.length} subroom. Vui lòng chỉ định subRoomId cụ thể: ${activeSubRooms.map(sr => `${sr._id} (${sr.name})`).join(', ')}`);
        }
      }
      
      // 2. Kiểm tra slot chưa có nhân sự (dùng logic giống query đầu tiên)
      // Add 15 minutes buffer to current time
      const vietnamNowForCheck = getVietnamDate();
      vietnamNowForCheck.setMinutes(vietnamNowForCheck.getMinutes() + 15);
      
      const unassignedQuery = {
        roomId,
        scheduleId: { $in: scheduleIds },
        isActive: true,
        startTime: { $gt: vietnamNowForCheck },
        // ⭐ With array schema: check for empty array or missing field
        $or: [
          { dentist: { $size: 0 } },
          { dentist: { $exists: false } },
          { nurse: { $size: 0 } },
          { nurse: { $exists: false } }
        ]
      };
      if (shifts && shifts.length) unassignedQuery.shiftName = { $in: shifts };
      if (subRoomId) unassignedQuery.subRoomId = subRoomId; else unassignedQuery.subRoomId = null;
      
      const unassignedSlots = await slotRepo.find(unassignedQuery);
      
      if (unassignedSlots.length === 0) {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        throw new Error(`Tất cả slot trong quý ${quarter}/${year} cho ${roomDisplay} đã được phân công nhân sự. Sử dụng API reassign-staff để thay đổi nhân sự.`);
      } else {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        const shiftDisplay = shifts.length > 0 ? ` ca "${shifts.join(', ')}"` : '';
        throw new Error(`Không tìm thấy slot phù hợp trong quý ${quarter}/${year} cho ${roomDisplay}${shiftDisplay}. Có ${unassignedSlots.length} slot chưa có nhân sự nhưng không match yêu cầu.`);
      }
    }
    
    // Note: We allow updating slots even if some belong to an appointment, because this endpoint applies by quarter and shifts.
    // Atomicity across appointments is enforced in the single/group update API.

    // Process each slot individually to only fill missing fields
    let updatedSlotIds = [];
    const dentistId = dentistIds.length > 0 ? dentistIds[0] : null;
    const nurseId = nurseIds.length > 0 ? nurseIds[0] : null;

    if (dentistId || nurseId) {
      // Check conflicts for dentist and nurse across the time range
      const minStart = new Date(Math.min(...slots.map(s => new Date(s.startTime).getTime())));
      const maxEnd = new Date(Math.max(...slots.map(s => new Date(s.endTime).getTime())));

      let existingByDentist = [];
      let existingByNurse = [];
      if (dentistId) {
        existingByDentist = await slotRepo.findByStaffId(dentistId, minStart, maxEnd);
      }
      if (nurseId) {
        existingByNurse = await slotRepo.findByStaffId(nurseId, minStart, maxEnd);
      }

      // Process each slot individually to only fill missing fields
      for (const slot of slots) {
        const slotUpdateData = {};
        
        // Check if we should assign dentist (only if slot doesn't have dentist yet or array is empty)
        if (dentistId && (!slot.dentist || !Array.isArray(slot.dentist) || slot.dentist.length === 0)) {
          // Check for time conflicts
          const sStart = new Date(slot.startTime);
          const sEnd = new Date(slot.endTime);
          const conflict = existingByDentist.find(es => 
            es._id.toString() !== slot._id.toString() && 
            new Date(es.startTime) < sEnd && 
            new Date(es.endTime) > sStart
          );
          if (conflict) throw new Error(`nha sĩ đã được phân công vào slot khác trong cùng khoảng thời gian (${new Date(slot.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })})`);
          
          slotUpdateData.dentist = [dentistId]; // Assign as array
        }
        
        // Check if we should assign nurse (only if slot doesn't have nurse yet or array is empty)
        if (nurseId && (!slot.nurse || !Array.isArray(slot.nurse) || slot.nurse.length === 0)) {
          // Check for time conflicts
          const sStart = new Date(slot.startTime);
          const sEnd = new Date(slot.endTime);
          const conflict = existingByNurse.find(es => 
            es._id.toString() !== slot._id.toString() && 
            new Date(es.startTime) < sEnd && 
            new Date(es.endTime) > sStart
          );
          if (conflict) throw new Error(`Y tá đã được phân công vào slot khác trong cùng khoảng thời gian (${new Date(slot.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })})`);
          
          slotUpdateData.nurse = [nurseId]; // Assign as array
        }
        
        // Update the slot if there's something to update
        if (Object.keys(slotUpdateData).length > 0) {
          await slotRepo.updateSlot(slot._id, slotUpdateData);
          updatedSlotIds.push(slot._id);
        }
      }

      // Reload updated slots for return data
      updatedSlots = updatedSlotIds.length > 0 ? await slotRepo.find({ _id: { $in: updatedSlotIds } }) : [];
      
      // 🔄 Mark entities as used when successfully assigned
      if (updatedSlotIds.length > 0) {
        await markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds });
      }
    }
    
    // Clear cache - best effort
    try {
      const dayKey = date ? new Date(new Date(date).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString().split('T')[0] : 'all';
      await redisClient.del(`slots:room:${roomId}:${dayKey}`);
    } catch (e) { console.warn('Failed to clear slots cache', e); }
    
    const totalSlotsFound = slots.length;
    const slotsUpdated = updatedSlots.length;
    
    return {
      message: slotsUpdated > 0 
        ? `Phân công nhân sự thành công cho ${slotsUpdated}/${totalSlotsFound} slot (chỉ gán vào các field còn thiếu)`
        : `Tìm thấy ${totalSlotsFound} slot nhưng tất cả đã có đầy đủ nhân sự được yêu cầu`,
      slotsUpdated,
      shifts,
      dentistAssigned: dentistIds[0] || null,
      nurseAssigned: nurseIds[0] || null
    };
    
  } catch (error) {
    throw new Error(`Lỗi phân công nhân sự: ${error.message}`);
  }
}

// Update staff for single or multiple slots
async function updateSlotStaff({ slotIds, dentistId, nurseId }) {
  try {
    if (!slotIds || slotIds.length === 0) {
      throw new Error('slotIds là bắt buộc và phải là mảng không rỗng');
    }

    // Load provided slots and validate they exist
    const targetSlots = await slotRepo.find({ _id: { $in: slotIds } });
    if (targetSlots.length !== slotIds.length) {
      throw new Error('Một số slot trong slotIds không tồn tại');
    }

    // Get current time in Vietnam timezone
    const vietnamNow = getVietnamDate();

    // Ensure all slots are updatable (not in the past) 
    for (const s of targetSlots) {
      // Check if slot is in the past (Vietnam timezone)
      if (new Date(s.startTime) <= vietnamNow) {
        throw new Error(`Slot ${s._id} đã qua thời điểm hiện tại (${new Date(s.startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}), không thể cập nhật`);
      }
      
      // ⭐ Only allow updating slots that already have staff assigned
      if (!s.dentist && !s.nurse) {
        throw new Error(`Slot ${s._id} chưa được phân công nhân sự, không thể cập nhật. Vui lòng sử dụng API phân công thay thế.`);
      }
    }

    // Validate all slots belong to the same room/subroom
    const first = targetSlots[0];
    const firstRoomId = first.roomId?.toString();
    const firstSubRoomId = first.subRoomId?.toString() || null;
    
    for (const slot of targetSlots) {
      const slotRoomId = slot.roomId?.toString();
      const slotSubRoomId = slot.subRoomId?.toString() || null;
      
      if (slotRoomId !== firstRoomId) {
        throw new Error(`Tất cả slot phải thuộc cùng một phòng. Slot ${slot._id} thuộc phòng khác.`);
      }
      
      if (slotSubRoomId !== firstSubRoomId) {
        const subRoomDisplay = firstSubRoomId ? `subroom ${firstSubRoomId}` : 'không có subroom';
        const slotSubRoomDisplay = slotSubRoomId ? `subroom ${slotSubRoomId}` : 'không có subroom';
        throw new Error(`Tất cả slot phải thuộc cùng subroom. Slot đầu tiên có ${subRoomDisplay}, nhưng slot ${slot._id} có ${slotSubRoomDisplay}.`);
      }
    }

    // Validate staff assignment for the room/subroom
    const dentistIds = dentistId ? [dentistId] : [];
    const nurseIds = nurseId ? [nurseId] : [];
    await validateStaffAssignment(first.roomId, first.subRoomId, dentistIds, nurseIds);

    // Conflict check per slot: ensure dentist/nurse not already assigned to overlapping slots
    const targetSlotIds = new Set(slotIds.map(id => id.toString()));
    const minStart = new Date(Math.min(...targetSlots.map(s => new Date(s.startTime).getTime())));
    const maxEnd = new Date(Math.max(...targetSlots.map(s => new Date(s.endTime).getTime())));

    let existingByDentist = [];
    let existingByNurse = [];
    if (dentistId) existingByDentist = await slotRepo.findByStaffId(dentistId, minStart, maxEnd);
    if (nurseId) existingByNurse = await slotRepo.findByStaffId(nurseId, minStart, maxEnd);

    for (const s of targetSlots) {
      const sStart = new Date(s.startTime);
      const sEnd = new Date(s.endTime);
      
      if (dentistId && existingByDentist.length) {
        const conflict = existingByDentist.find(es => 
          !targetSlotIds.has(es._id.toString()) && 
          new Date(es.startTime) < sEnd && 
          new Date(es.endTime) > sStart
        );
        if (conflict) {
          throw new Error(`nha sĩ đã được phân công vào slot khác trong cùng khoảng thời gian: ${sStart.toLocaleString()} - ${sEnd.toLocaleString()}`);
        }
      }
      
      if (nurseId && existingByNurse.length) {
        const conflict = existingByNurse.find(es => 
          !targetSlotIds.has(es._id.toString()) && 
          new Date(es.startTime) < sEnd && 
          new Date(es.endTime) > sStart
        );
        if (conflict) {
          throw new Error(`Y tá đã được phân công vào slot khác trong cùng khoảng thời gian: ${sStart.toLocaleString()} - ${sEnd.toLocaleString()}`);
        }
      }
    }

    const updateData = {};
    if (dentistId !== undefined) updateData.dentist = dentistId;
    if (nurseId !== undefined) updateData.nurse = nurseId;

    await slotRepo.updateManySlots({ _id: { $in: slotIds } }, updateData);
    const updated = await slotRepo.find({ _id: { $in: slotIds } });

    // 🔄 Mark entities as used when successfully assigned
    const roomId = updated[0]?.roomId; // Get roomId from first slot
    const subRoomId = updated[0]?.subRoomId; // Get subRoomId from first slot
    const markDentistIds = dentistId ? [dentistId] : [];
    const markNurseIds = nurseId ? [nurseId] : [];
    await markEntitiesAsUsed({ roomId, subRoomId, dentistIds: markDentistIds, nurseIds: markNurseIds });

    // Clear cache for affected rooms/days (best effort)
    try {
      await Promise.all(updated.map(s => {
        const dateStr = new Date(s.startTime).toLocaleDateString('en-CA'); // YYYY-MM-DD format
        return redisClient.del(`slots:room:${s.roomId}:${dateStr}`).catch(() => {});
      }));
    } catch (e) {}

    return updated;
  } catch (error) {
    throw new Error(`Lỗi cập nhật nhân sự slot: ${error.message}`);
  }
}

// Get slots by shift and date for easy slot selection
async function getSlotsByShiftAndDate({ roomId, subRoomId = null, date, shiftName }) {
  try {
    // Parse date string properly for VN timezone
    // Input: "2025-10-07" should mean 07/10/2025 in Vietnam timezone
    const [year, month, day] = date.split('-').map(Number);
    
    // Create date range for the day in Vietnam timezone
    // Start: 00:00:00 VN = subtract 7 hours to get UTC
    // End: 23:59:59 VN = subtract 7 hours to get UTC
    const startOfDayVN = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 7 * 60 * 60 * 1000);
    const endOfDayVN = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - 7 * 60 * 60 * 1000);

    // Get current time in Vietnam timezone + 5 minutes buffer
    const vietnamNow = getVietnamDate();
    const minStartTime = new Date(vietnamNow.getTime() + 5 * 60 * 1000); // Add 5 minutes

    // Use the later of: start of day or current time + 5 minutes
    const effectiveStartTime = minStartTime > startOfDayVN ? minStartTime : startOfDayVN;

    const queryFilter = {
      roomId,
      startTime: { 
        $gte: effectiveStartTime,  // >= max(start of day, now + 5 minutes)
        $lte: endOfDayVN           // <= end of day
      },
      shiftName,
      isActive: true
    };
    
    if (subRoomId) {
      queryFilter.subRoomId = subRoomId;
    } else {
      queryFilter.subRoomId = null;
    }

    console.log('🔍 getSlotsByShiftAndDate query filter:', JSON.stringify(queryFilter, null, 2));
    console.log('🔍 Input date:', date);
    console.log('🔍 effectiveStartTime (VN):', new Date(effectiveStartTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
    console.log('🔍 endOfDayVN (VN):', new Date(endOfDayVN).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

    const slots = await slotRepo.find(queryFilter);
    
    console.log('🔍 Found slots count:', slots.length);
    if (slots.length > 0) {
      console.log('🔍 First slot sample:', {
        startTime: slots[0].startTime,
        startTimeVN: new Date(slots[0].startTime).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        subRoomId: slots[0].subRoomId,
        shiftName: slots[0].shiftName
      });
    }
    
    // Get user info from cache for staff details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    
    const slotsWithStaffInfo = slots.map(slot => {
      // Handle dentist/nurse as array or single ObjectId
      let dentist = null;
      let nurse = null;
      
      if (Array.isArray(slot.dentist) && slot.dentist.length > 0) {
        // Array case: get first dentist for display
        dentist = users.find(u => u._id === slot.dentist[0].toString());
      } else if (slot.dentist) {
        // Legacy single ObjectId case
        dentist = users.find(u => u._id === slot.dentist.toString());
      }
      
      if (Array.isArray(slot.nurse) && slot.nurse.length > 0) {
        // Array case: get first nurse for display
        nurse = users.find(u => u._id === slot.nurse[0].toString());
      } else if (slot.nurse) {
        // Legacy single ObjectId case
        nurse = users.find(u => u._id === slot.nurse.toString());
      }
      
      // Slot có thể cập nhật nếu đã có ít nhất 1 nhân sự (dentist hoặc nurse)
      const hasDentist = Array.isArray(slot.dentist) ? slot.dentist.length > 0 : Boolean(slot.dentist);
      const hasNurse = Array.isArray(slot.nurse) ? slot.nurse.length > 0 : Boolean(slot.nurse);
      const hasStaff = hasDentist || hasNurse;
      
      return {
        slotId: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        dateVN: new Date(slot.startTime).toLocaleDateString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }),
        fullTimeRangeVN: `${new Date(slot.startTime).toLocaleString('vi-VN', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })} - ${new Date(slot.endTime).toLocaleTimeString('vi-VN', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        })}`,
        dentist: dentist ? {
          id: dentist._id,
          name: dentist.name,
          fullName: dentist.fullName || dentist.name,
          employeeCode: dentist.employeeCode || dentist.code,
          role: dentist.role
        } : null,
        nurse: nurse ? {
          id: nurse._id,
          name: nurse.name,
          fullName: nurse.fullName || nurse.name,
          employeeCode: nurse.employeeCode || nurse.code,
          role: nurse.role
        } : null,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null,
        hasStaff: hasStaff,
        canUpdate: hasStaff, // Chỉ slot đã có nhân sự mới có thể cập nhật
        status: hasStaff ? 'assigned' : 'not_assigned'
      };
    });
    
    return {
      roomId,
      subRoomId,
      date,
      shiftName,
      totalSlots: slotsWithStaffInfo.length,
      slots: slotsWithStaffInfo
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy slot theo ca và ngày: ${error.message}`);
  }
}

// Get room calendar with appointment counts (daily/weekly/monthly view) with pagination
async function getRoomCalendar({ roomId, subRoomId = null, viewType, startDate = null, page = 0, limit = 10 }) {
  try {
    // Get schedule config for shift information
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const scheduleConfig = await ScheduleConfig.getSingleton();
    if (!scheduleConfig) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo. Vui lòng liên hệ admin để thiết lập.');
    }
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination - support negative pages for historical data
    const periods = [];
    for (let i = 0; i < limit; i++) {
      // For page 0: periodIndex = 0 (current week/day/month)
      // For page 1: periodIndex = 1 (next period)
      // For page -1: periodIndex = -1 (previous period)
      // For page 2: periodIndex = 2 (2 periods ahead)
      let periodIndex = page * limit + i;
      
      let periodStart, periodEnd;
      
      switch (viewType) {
        case 'day':
          // Each period is one day
          periodStart = new Date(baseDate);
          periodStart.setDate(baseDate.getDate() + periodIndex);
          periodEnd = new Date(periodStart);
          break;
          
        case 'week':
          // Each period is one week (Monday to Sunday)
          const weekStart = new Date(baseDate);
          const dayOfWeek = weekStart.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          weekStart.setDate(baseDate.getDate() + mondayOffset + (periodIndex * 7));
          
          periodStart = new Date(weekStart);
          periodEnd = new Date(weekStart);
          periodEnd.setDate(weekStart.getDate() + 6);
          break;
          
        case 'month':
          // Each period is one month
          const targetYear = baseDate.getFullYear();
          const targetMonth = baseDate.getMonth() + periodIndex;
          
          // Use local dates to avoid timezone issues
          periodStart = new Date(targetYear, targetMonth, 1);
          periodEnd = new Date(targetYear, targetMonth + 1, 0); // Last day of target month
          
          // Adjust for correct local date representation
          periodStart.setHours(0, 0, 0, 0);
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        default:
          throw new Error('viewType phải là: day, week hoặc month');
      }
      
      periods.push({ start: periodStart, end: periodEnd });
    }
    
    // Get overall date range for database query
    const overallStart = periods[0].start;
    const overallEnd = periods[periods.length - 1].end;

    // Build UTC range for query
    const startUTC = new Date(Date.UTC(
      overallStart.getFullYear(),
      overallStart.getMonth(),
      overallStart.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      overallEnd.getFullYear(),
      overallEnd.getMonth(),
      overallEnd.getDate(),
      -7 + 24, 0, 0, 0
    ));

    // ⭐ Removed time filtering to show all historical data in view-only calendar
    const queryFilter = {
      roomId,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };
    
    if (subRoomId) {
      queryFilter.subRoomId = subRoomId;
    } else {
      queryFilter.subRoomId = null;
    }

    const [slots, schedulesInRange] = await Promise.all([
      slotRepo.find(queryFilter),
      scheduleRepo.findByRoomAndDateRange(roomId, overallStart, overallEnd)
    ]);
    const targetSubRoomId = subRoomId ? subRoomId.toString() : null;
    const relevantSchedules = schedulesInRange.filter(schedule => {
      const scheduleSubRoomId = schedule?.subRoomId ? schedule.subRoomId.toString() : null;
      if (targetSubRoomId) {
        return scheduleSubRoomId === targetSubRoomId;
      }
      return !scheduleSubRoomId;
    });
    
    // Get user info from cache for staff details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    
    // Group slots by date and shift
    const calendar = {};
    const appointmentCounts = {}; // Track unique appointments
    const staffStats = {}; // Track staff frequency by date and shift
    
    for (const slot of slots) {
      // Convert to Vietnam date
      const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      
      if (!calendar[slotDateVN]) {
        calendar[slotDateVN] = {
          date: slotDateVN,
          shifts: {
            'Ca Sáng': { appointmentCount: 0, totalSlots: 0 },
            'Ca Chiều': { appointmentCount: 0, totalSlots: 0 },
            'Ca Tối': { appointmentCount: 0, totalSlots: 0 }
          },
          totalAppointments: 0,
          totalSlots: 0
        };
        appointmentCounts[slotDateVN] = new Set();
        staffStats[slotDateVN] = {
          'Ca Sáng': { dentists: {}, nurses: {} },
          'Ca Chiều': { dentists: {}, nurses: {} },
          'Ca Tối': { dentists: {}, nurses: {} }
        };
      }
      
      const shift = calendar[slotDateVN].shifts[slot.shiftName];
      const shiftStats = staffStats[slotDateVN][slot.shiftName];
      
      if (shift && shiftStats) {
        shift.totalSlots++;
        calendar[slotDateVN].totalSlots++;
        
        // Count unique appointments
        if (slot.appointmentId && slot.isBooked) {
          appointmentCounts[slotDateVN].add(slot.appointmentId.toString());
        }
        
        // Track staff frequency for statistics
        // Handle dentist (can be array or single ObjectId)
        if (Array.isArray(slot.dentist)) {
          // Array case: multiple dentists
          slot.dentist.forEach(dentistId => {
            if (dentistId) {
              const dentistIdStr = dentistId.toString();
              shiftStats.dentists[dentistIdStr] = (shiftStats.dentists[dentistIdStr] || 0) + 1;
            }
          });
        } else if (slot.dentist) {
          // Legacy single ObjectId case
          const dentistId = slot.dentist.toString();
          shiftStats.dentists[dentistId] = (shiftStats.dentists[dentistId] || 0) + 1;
        }
        
        // Handle nurse (can be array or single ObjectId)
        if (Array.isArray(slot.nurse)) {
          // Array case: multiple nurses
          slot.nurse.forEach(nurseId => {
            if (nurseId) {
              const nurseIdStr = nurseId.toString();
              shiftStats.nurses[nurseIdStr] = (shiftStats.nurses[nurseIdStr] || 0) + 1;
            }
          });
        } else if (slot.nurse) {
          // Legacy single ObjectId case
          const nurseId = slot.nurse.toString();
          shiftStats.nurses[nurseId] = (shiftStats.nurses[nurseId] || 0) + 1;
        }
        
        // ⭐ ADD slot details với staff populated để FE không phải gọi thêm API
        const slotDetail = {
          slotId: slot._id.toString(),
          startTime: slot.startTime,
          endTime: slot.endTime,
          startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
            timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit'
          }),
          endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
            timeZone: 'Asia/Ho_Chi_Minh', hour12: false, hour: '2-digit', minute: '2-digit'
          }),
          dentist: [],
          nurse: [],
          isBooked: slot.isBooked || false,
          appointmentId: slot.appointmentId || null
        };

        // Populate dentist info
        if (Array.isArray(slot.dentist) && slot.dentist.length > 0) {
          slot.dentist.forEach(dentistId => {
            if (dentistId) {
              const user = users.find(u => u._id?.toString() === dentistId.toString());
              if (user) {
                slotDetail.dentist.push({
                  id: user._id,
                  name: user.name,
                  fullName: user.fullName || user.name,
                  employeeCode: user.employeeCode || user.code || null
                });
              }
            }
          });
        } else if (slot.dentist) {
          const user = users.find(u => u._id?.toString() === slot.dentist.toString());
          if (user) {
            slotDetail.dentist.push({
              id: user._id,
              name: user.name,
              fullName: user.fullName || user.name,
              employeeCode: user.employeeCode || user.code || null
            });
          }
        }

        // Populate nurse info
        if (Array.isArray(slot.nurse) && slot.nurse.length > 0) {
          slot.nurse.forEach(nurseId => {
            if (nurseId) {
              const user = users.find(u => u._id?.toString() === nurseId.toString());
              if (user) {
                slotDetail.nurse.push({
                  id: user._id,
                  name: user.name,
                  fullName: user.fullName || user.name,
                  employeeCode: user.employeeCode || user.code || null
                });
              }
            }
          });
        } else if (slot.nurse) {
          const user = users.find(u => u._id?.toString() === slot.nurse.toString());
          if (user) {
            slotDetail.nurse.push({
              id: user._id,
              name: user.name,
              fullName: user.fullName || user.name,
              employeeCode: user.employeeCode || user.code || null
            });
          }
        }

        // Add slot detail to shift
        if (!shift.slots) shift.slots = [];
        shift.slots.push(slotDetail);
      }
    }
    
    // Update appointment counts and add staff statistics
    for (const [dateStr, appointmentIds] of Object.entries(appointmentCounts)) {
      const dayData = calendar[dateStr];
      const dayStats = staffStats[dateStr];
      
      if (dayData && dayStats) {
        dayData.totalAppointments = appointmentIds.size;
        
        // Process each shift and add staff statistics
        for (const shiftName of ['Ca Sáng', 'Ca Chiều', 'Ca Tối']) {
          const shift = dayData.shifts[shiftName];
          const shiftStat = dayStats[shiftName];
          
          if (shift && shiftStat) {
            // Count appointments for this shift
            const shiftAppointmentIds = new Set();
            for (const slot of slots) {
              const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
                timeZone: 'Asia/Ho_Chi_Minh'
              });
              if (slotDateVN === dateStr && slot.shiftName === shiftName && slot.isBooked && slot.appointmentId) {
                shiftAppointmentIds.add(slot.appointmentId.toString());
              }
            }
            shift.appointmentCount = shiftAppointmentIds.size;
            
            // Find most frequent dentist and nurse
            let mostFrequentDentist = null;
            let mostFrequentNurse = null;
            
            if (Object.keys(shiftStat.dentists).length > 0) {
              const topDentistId = Object.entries(shiftStat.dentists)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
              const topDentist = users.find(u => u._id === topDentistId);
              if (topDentist) {
                mostFrequentDentist = {
                  id: topDentistId,
                  employeeCode: topDentist.employeeCode || null,
                  fullName: topDentist.fullName || topDentist.name || null,
                  name: topDentist.name,
                  slotCount: shiftStat.dentists[topDentistId]
                };
              }
            }
            
            if (Object.keys(shiftStat.nurses).length > 0) {
              const topNurseId = Object.entries(shiftStat.nurses)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
              const topNurse = users.find(u => u._id === topNurseId);
              if (topNurse) {
                mostFrequentNurse = {
                  id: topNurseId,
                  employeeCode: topNurse.employeeCode || null,
                  fullName: topNurse.fullName || topNurse.name || null,
                  name: topNurse.name,
                  slotCount: shiftStat.nurses[topNurseId]
                };
              }
            }
            
            // Add staff statistics to shift
            shift.staffStats = {
              mostFrequentDentist,
              mostFrequentNurse
            };
          }
        }
      }
    }
    
    const scheduleShiftOverview = buildShiftOverviewFromSchedules(relevantSchedules, scheduleConfig);
    const shiftOverview = Object.keys(scheduleShiftOverview).length > 0
      ? scheduleShiftOverview
      : buildShiftOverviewFromConfig(scheduleConfig);
    
    // Get room and subroom names from cache
    const roomFromCache = rooms.find(r => r._id === roomId);
    let subRoomInfo = null;
    let roomInfo = {
      id: roomId,
      name: 'Unknown Room'
    };
    
    if (roomFromCache) {
      roomInfo = {
        id: roomFromCache._id,
        name: roomFromCache.name,
        hasSubRooms: roomFromCache.hasSubRooms,
        maxDoctors: roomFromCache.maxDoctors,
        maxNurses: roomFromCache.maxNurses,
        isActive: roomFromCache.isActive
      };
      
      // Find subroom info if requested
      if (subRoomId && roomFromCache.subRooms && roomFromCache.subRooms.length > 0) {
        subRoomInfo = roomFromCache.subRooms.find(sr => sr._id === subRoomId);
        if (subRoomInfo) {
          roomInfo.subRoom = {
            id: subRoomInfo._id,
            name: subRoomInfo.name,
            isActive: subRoomInfo.isActive
          };
        }
      }
    } else {
      // Fallback to database data if cache not available
      const room = await getRoomInfo(roomId);
      roomInfo = {
        id: room._id,
        name: room.name
      };
      
      if (subRoomId && room.subRooms) {
        const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
        if (subRoom) {
          roomInfo.subRoom = {
            id: subRoom._id,
            name: subRoom.name
          };
        }
      }
    }
    
    // Group calendar data by periods
    const calendarPeriods = periods.map((period, index) => {
      const periodCalendar = {};
      
      // Format dates properly for local timezone
      const periodStartStr = period.start.getFullYear() + '-' + 
        String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.start.getDate()).padStart(2, '0');
      const periodEndStr = period.end.getFullYear() + '-' + 
        String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.end.getDate()).padStart(2, '0');
      
      Object.entries(calendar).forEach(([dateStr, dayData]) => {
        if (dateStr >= periodStartStr && dateStr <= periodEndStr) {
          periodCalendar[dateStr] = dayData;
        }
      });
      
      return {
        periodIndex: (page - 1) * limit + index + 1,
        startDate: periodStartStr,
        endDate: periodEndStr,
        viewType,
        totalDays: Object.keys(periodCalendar).length,
        days: Object.values(periodCalendar).sort((a, b) => a.date.localeCompare(b.date))
      };
    });
    
    // Calculate pagination info
    const currentDate = getVietnamDate().toISOString().split('T')[0];
    
    return {
      roomInfo,
      shiftOverview,
      pagination: {
        currentPage: page,
        limit,
        viewType,
        currentDate,
        hasNext: true, // Always allow going to future
        hasPrev: true, // Always allow going to past (support negative pages)
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch phòng: ${error.message}`);
  }
}

// Get dentist calendar with appointment counts (daily/weekly/monthly view) with historical support  
async function getDentistCalendar({ dentistId, viewType, startDate = null, page = 0, limit = 10 }) {
  try {
    // Get schedule config for shift information
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const scheduleConfig = await ScheduleConfig.getSingleton();
    if (!scheduleConfig) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo. Vui lòng liên hệ admin để thiết lập.');
    }
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination - support negative pages for historical data
    const periods = [];
    
    for (let i = 0; i < limit; i++) {
      let periodStart, periodEnd;
      const periodIndex = page * limit + i;
      
      switch (viewType) {
        case 'day':
          // Each period is one day
          periodStart = new Date(baseDate);
          periodStart.setDate(baseDate.getDate() + periodIndex);
          periodStart.setHours(0, 0, 0, 0);
          
          periodEnd = new Date(periodStart);
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        case 'week':
          // Each period is one week starting Monday
          const dayOfWeek = baseDate.getDay() || 7; // Convert Sunday (0) to 7
          const mondayOffset = (dayOfWeek === 1) ? 0 : -(dayOfWeek - 1);
          const mondayOfBaseWeek = new Date(baseDate);
          mondayOfBaseWeek.setDate(baseDate.getDate() + mondayOffset);
          mondayOfBaseWeek.setHours(0, 0, 0, 0);
          
          periodStart = new Date(mondayOfBaseWeek);
          periodStart.setDate(mondayOfBaseWeek.getDate() + (periodIndex * 7));
          
          periodEnd = new Date(periodStart);
          periodEnd.setDate(periodStart.getDate() + 6); // Sunday
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        case 'month':
          // Each period is one month
          const targetYear = baseDate.getFullYear();
          const targetMonth = baseDate.getMonth() + periodIndex;
          
          // Use local dates to avoid timezone issues
          periodStart = new Date(targetYear, targetMonth, 1);
          periodEnd = new Date(targetYear, targetMonth + 1, 0); // Last day of target month
          
          // Adjust for correct local date representation
          periodStart.setHours(0, 0, 0, 0);
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        default:
          throw new Error('viewType phải là: day, week hoặc month');
      }
      
      periods.push({ start: periodStart, end: periodEnd });
    }
    for (let i = 0; i < limit; i++) {
      // For page 0: periodIndex = 0 (current week/day/month)
      // For page 1: periodIndex = 1 (next period)
      // For page -1: periodIndex = -1 (previous period)
      // For page 2: periodIndex = 2 (2 periods ahead)
      let periodIndex = page * limit + i;
      
      let periodStart, periodEnd;
      
      switch (viewType) {
        case 'day':
          // Each period is one day
          periodStart = new Date(baseDate);
          periodStart.setDate(baseDate.getDate() + periodIndex);
          periodEnd = new Date(periodStart);
          break;
          
        case 'week':
          // Each period is one week (Monday to Sunday)
          const weekStart = new Date(baseDate);
          const dayOfWeek = weekStart.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          weekStart.setDate(baseDate.getDate() + mondayOffset + (periodIndex * 7));
          
          periodStart = new Date(weekStart);
          periodEnd = new Date(weekStart);
          periodEnd.setDate(weekStart.getDate() + 6);
          break;
          
        case 'month':
          // Each period is one month
          const targetYear = baseDate.getFullYear();
          const targetMonth = baseDate.getMonth() + periodIndex;
          
          // Use local dates to avoid timezone issues
          periodStart = new Date(targetYear, targetMonth, 1);
          periodEnd = new Date(targetYear, targetMonth + 1, 0); // Last day of target month
          
          // Adjust for correct local date representation
          periodStart.setHours(0, 0, 0, 0);
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        default:
          throw new Error('viewType phải là: day, week hoặc month');
      }
      
      periods.push({ start: periodStart, end: periodEnd });
    }
    
    // Get overall date range for database query
    const overallStart = periods[0].start;
    const overallEnd = periods[periods.length - 1].end;

    // Build UTC range for query
    const startUTC = new Date(Date.UTC(
      overallStart.getFullYear(),
      overallStart.getMonth(),
      overallStart.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      overallEnd.getFullYear(),
      overallEnd.getMonth(),
      overallEnd.getDate(),
      -7 + 24, 0, 0, 0
    ));

    // ⭐ Removed time filtering to show all historical data in view-only calendar
    // Query slots where this dentist is assigned (dentist is an array, so use $in)
    const queryFilter = {
      dentist: { $in: [dentistId] },
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for dentist details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const dentist = users.find(u => u._id === dentistId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    
    // Group slots by date and shift
    const calendar = {};
    const appointmentCounts = {}; // Track unique appointments
    const roomStats = {}; // Track room frequency by date and shift
    
    for (const slot of slots) {
      // Convert to Vietnam date
      const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      
      if (!calendar[slotDateVN]) {
        calendar[slotDateVN] = {
          date: slotDateVN,
          shifts: {
            'Ca Sáng': { appointmentCount: 0, totalSlots: 0, slots: [] },
            'Ca Chiều': { appointmentCount: 0, totalSlots: 0, slots: [] },
            'Ca Tối': { appointmentCount: 0, totalSlots: 0, slots: [] }
          },
          totalAppointments: 0,
          totalSlots: 0
        };
        appointmentCounts[slotDateVN] = new Set();
        roomStats[slotDateVN] = {
          'Ca Sáng': { rooms: {} },
          'Ca Chiều': { rooms: {} },
          'Ca Tối': { rooms: {} }
        };
      }
      
      const shift = calendar[slotDateVN].shifts[slot.shiftName];
      const shiftRoomStats = roomStats[slotDateVN][slot.shiftName];
      
      if (shift && shiftRoomStats) {
        shift.totalSlots++;
        calendar[slotDateVN].totalSlots++;
        
        // Count unique appointments
        if (slot.appointmentId) {
          appointmentCounts[slotDateVN].add(slot.appointmentId);
          shift.appointmentCount++;
        }
        
        // Track room frequency
        const roomKey = slot.roomId + (slot.subRoomId ? `_${slot.subRoomId}` : '');
        if (!shiftRoomStats.rooms[roomKey]) {
          shiftRoomStats.rooms[roomKey] = 0;
        }
        shiftRoomStats.rooms[roomKey]++;
        
        // ⭐ Add slot details with dentist/nurse info
        // Get dentist info
        let dentistInfo = [];
        if (Array.isArray(slot.dentist) && slot.dentist.length > 0) {
          dentistInfo = slot.dentist.map(dentistId => {
            const d = users.find(u => u._id === dentistId.toString());
            return d ? {
              id: d._id,
              fullName: d.fullName || d.name,
              employeeCode: d.employeeCode || d.code
            } : null;
          }).filter(Boolean);
        } else if (slot.dentist) {
          const d = users.find(u => u._id === slot.dentist.toString());
          if (d) {
            dentistInfo = [{
              id: d._id,
              fullName: d.fullName || d.name,
              employeeCode: d.employeeCode || d.code
            }];
          }
        }
        
        // Get nurse info
        let nurseInfo = [];
        if (Array.isArray(slot.nurse) && slot.nurse.length > 0) {
          nurseInfo = slot.nurse.map(nurseId => {
            const n = users.find(u => u._id === nurseId.toString());
            return n ? {
              id: n._id,
              fullName: n.fullName || n.name,
              employeeCode: n.employeeCode || n.code
            } : null;
          }).filter(Boolean);
        } else if (slot.nurse) {
          const n = users.find(u => u._id === slot.nurse.toString());
          if (n) {
            nurseInfo = [{
              id: n._id,
              fullName: n.fullName || n.name,
              employeeCode: n.employeeCode || n.code
            }];
          }
        }
        
        // Get room/subroom info
        const room = rooms.find(r => r._id === slot.roomId);
        let roomInfo = null;
        let subRoomInfo = null;
        
        if (room) {
          roomInfo = {
            id: room._id,
            name: room.name
          };
          
          if (slot.subRoomId && room.subRooms) {
            const subRoom = room.subRooms.find(sr => sr._id === slot.subRoomId);
            if (subRoom) {
              subRoomInfo = {
                id: subRoom._id,
                name: subRoom.name
              };
            }
          }
        }
        
        shift.slots.push({
          slotId: slot._id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          }),
          endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          }),
          dentist: dentistInfo,
          nurse: nurseInfo,
          room: roomInfo,
          subRoom: subRoomInfo,
          isBooked: slot.isBooked || false,
          appointmentId: slot.appointmentId || null
        });
      }
    }
    
    // Update total appointment counts
    for (const date in appointmentCounts) {
      calendar[date].totalAppointments = appointmentCounts[date].size;
    }
    
    // Convert calendar object to array and sort by date
    const calendarArray = Object.values(calendar);
    calendarArray.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Group calendar data by periods (similar to room calendar)
    const calendarPeriods = periods.map((period, index) => {
      const periodCalendar = {};
      
      // Format dates properly for local timezone
      const periodStartStr = period.start.getFullYear() + '-' + 
        String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.start.getDate()).padStart(2, '0');
      const periodEndStr = period.end.getFullYear() + '-' + 
        String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.end.getDate()).padStart(2, '0');
      
      // Filter days within this period
      calendarArray.forEach(day => {
        if (day.date >= periodStartStr && day.date <= periodEndStr) {
          periodCalendar[day.date] = day;
        }
      });
      
      // ⭐ DENTIST CALENDAR: If no data, create empty calendar structure for all days in period
      if (Object.keys(periodCalendar).length === 0) {
        let currentDate = new Date(period.start);
        const endDate = new Date(period.end);
        
        while (currentDate <= endDate) {
          const dateStr = currentDate.getFullYear() + '-' + 
            String(currentDate.getMonth() + 1).padStart(2, '0') + '-' + 
            String(currentDate.getDate()).padStart(2, '0');
          
          periodCalendar[dateStr] = {
            date: dateStr,
            shifts: {
              'Ca Sáng': { appointmentCount: 0, totalSlots: 0, slots: [], mostFrequentRoom: null },
              'Ca Chiều': { appointmentCount: 0, totalSlots: 0, slots: [], mostFrequentRoom: null },
              'Ca Tối': { appointmentCount: 0, totalSlots: 0, slots: [], mostFrequentRoom: null }
            },
            totalAppointments: 0,
            totalSlots: 0
          };
          
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      // Add room statistics for each day in this period
      const daysInPeriod = Object.values(periodCalendar).map(day => {
        const dayStats = roomStats[day.date];
        
        // Only process stats if day has data
        if (dayStats) {
          // Add most frequent room for each shift
          for (const shiftName of ['Ca Sáng', 'Ca Chiều', 'Ca Tối']) {
            const shiftStat = dayStats[shiftName];
            let mostFrequentRoom = null;
            
            if (Object.keys(shiftStat.rooms).length > 0) {
              const topRoomKey = Object.entries(shiftStat.rooms)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
              
              const [roomId, subRoomId] = topRoomKey.split('_');
              const room = rooms.find(r => r._id === roomId);
              
              if (room) {
                mostFrequentRoom = {
                  id: roomId,
                  name: room.name,
                  slotCount: shiftStat.rooms[topRoomKey]
                };
                
                if (subRoomId && room.subRooms) {
                  const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
                  if (subRoom) {
                    mostFrequentRoom.subRoom = {
                      id: subRoom._id,
                      name: subRoom.name
                    };
                  }
                }
              }
            }
            
            day.shifts[shiftName].mostFrequentRoom = mostFrequentRoom;
          }
        }
        
        return day;
      }).sort((a, b) => a.date.localeCompare(b.date));
      
      return {
        periodIndex: (page - 1) * limit + index + 1,
        startDate: periodStartStr,
        endDate: periodEndStr,
        viewType,
        totalDays: daysInPeriod.length,
        days: daysInPeriod
      };
    });
    
    return {
      dentist: dentist ? { id: dentist._id, name: dentist.name } : { id: dentistId, name: 'nha sĩ không xác định' },
      viewType,
      pagination: {
        page,
        limit,
        hasNext: true, // Always allow going to future
        hasPrev: true, // Always allow going to past for dentist calendar
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch nha sĩ: ${error.message}`);
  }
}

// Reassign staff to slots that already have staff assigned (based on assignStaffToSlots logic)
async function reassignStaffToSlots({
  roomId,
  subRoomId = null,
  quarter = null,
  year = null,
  shifts = [], // Array of shift names: ['Ca Sáng', 'Ca Chiều', 'Ca Tối']
  dentistIds = [],
  nurseIds = []
}) {
  try {
    // Validate input: require quarter/year for quarter-level assignment
    if (!roomId || !quarter || !year) {
      throw new Error('Room ID, quarter và year là bắt buộc để phân công lại theo quý');
    }

    if (shifts.length === 0) {
      throw new Error('Phải chọn ít nhất 1 ca làm việc');
    }

    // Validate quarter/year is not in the past
    validateQuarterYear(quarter, year);
    
    // Validate staff assignment based on room type
    await validateStaffAssignment(roomId, subRoomId, dentistIds, nurseIds);
    
    // Resolve all schedules for the given quarter/year for this room
    const { getQuarterDateRange } = require('./schedule.service');
    const { startDate, endDate } = getQuarterDateRange(quarter, year);
    const schedules = await require('../repositories/schedule.repository').findByRoomAndDateRange(roomId, startDate, endDate);
    const scheduleIds = schedules.map(s => s._id);
    if (!scheduleIds || scheduleIds.length === 0) {
      throw new Error(`Không tìm thấy lịch làm việc nào cho phòng trong quý ${quarter}/${year}. Vui lòng tạo lịch làm việc trước khi phân công lại nhân sự.`);
    }

    // Get current time in Vietnam timezone for filtering future slots only
    // Add 15 minutes buffer to current time
    const vietnamNow = getVietnamDate();
    vietnamNow.setMinutes(vietnamNow.getMinutes() + 15);

    // Build query filter: all slots in those schedules THAT ALREADY HAVE STAFF
    // and are in the future (startTime > current Vietnam time + 15 minutes)
    const queryFilter = { 
      roomId, 
      scheduleId: { $in: scheduleIds }, 
      isActive: true,
      startTime: { $gt: vietnamNow }, // Only future slots (with 15-minute buffer)
      // ⭐ KEY DIFFERENCE: Only slots that already have dentist OR nurse assigned
      $or: [
        { dentist: { $exists: true, $ne: null } },
        { nurse: { $exists: true, $ne: null } }
      ]
    };
    if (shifts && shifts.length) queryFilter.shiftName = { $in: shifts };
    if (subRoomId) queryFilter.subRoomId = subRoomId; else queryFilter.subRoomId = null;

    const slots = await slotRepo.find(queryFilter);
    
    if (slots.length === 0) {
      // Kiểm tra các nguyên nhân có thể xảy ra
      const room = await getRoomInfo(roomId);
      let foundSubRoom = null; // Khai báo biến để sử dụng trong error messages
      
      // 1. Kiểm tra logic subRoom
      if (subRoomId) {
        // User truyền subRoomId nhưng phòng không có subRoom
        if (!room.subRooms || room.subRooms.length === 0) {
          throw new Error(`Phòng "${room.name}" không có subroom nhưng bạn đã chỉ định subRoomId. Vui lòng bỏ subRoomId hoặc chọn phòng khác.`);
        }
        
        // subRoomId không thuộc phòng này
        foundSubRoom = room.subRooms.find(sr => sr._id && sr._id.toString() === subRoomId.toString());
        if (!foundSubRoom) {
          throw new Error(`SubRoom không thuộc về phòng "${room.name}". Vui lòng kiểm tra lại subRoomId.`);
        }
      } else {
        // User không truyền subRoomId nhưng phòng có subRoom
        if (room.subRooms && room.subRooms.length > 0) {
          const activeSubRooms = room.subRooms.filter(sr => sr.isActive !== false);
          throw new Error(`Phòng "${room.name}" có ${activeSubRooms.length} subroom. Vui lòng chỉ định subRoomId cụ thể: ${activeSubRooms.map(sr => `${sr._id} (${sr.name})`).join(', ')}`);
        }
      }
      
      // 2. Kiểm tra slot đã có nhân sự
      // Add 15 minutes buffer to current time
      const vietnamNowForCheck = getVietnamDate();
      vietnamNowForCheck.setMinutes(vietnamNowForCheck.getMinutes() + 15);
      
      const assignedQuery = {
        roomId,
        scheduleId: { $in: scheduleIds },
        isActive: true,
        startTime: { $gt: vietnamNowForCheck },
        $or: [
          { dentist: { $exists: true, $ne: null } },
          { nurse: { $exists: true, $ne: null } }
        ]
      };
      if (shifts && shifts.length) assignedQuery.shiftName = { $in: shifts };
      if (subRoomId) assignedQuery.subRoomId = subRoomId; else assignedQuery.subRoomId = null;
      
      const assignedSlots = await slotRepo.find(assignedQuery);
      
      if (assignedSlots.length === 0) {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        throw new Error(`Không có slot nào đã được phân công nhân sự trong quý ${quarter}/${year} cho ${roomDisplay}. Sử dụng API assign-staff để phân công mới.`);
      } else {
        const roomDisplay = subRoomId ? `${room.name} > ${foundSubRoom?.name || 'SubRoom'}` : room.name;
        const shiftDisplay = shifts.length > 0 ? ` ca "${shifts.join(', ')}"` : '';
        throw new Error(`Không tìm thấy slot phù hợp để phân công lại trong quý ${quarter}/${year} cho ${roomDisplay}${shiftDisplay}. Có ${assignedSlots.length} slot đã có nhân sự nhưng không match yêu cầu.`);
      }
    }
    
    // Build update object
    const updateData = {};
    if (dentistIds.length > 0) updateData.dentist = dentistIds[0];
    if (nurseIds.length > 0) updateData.nurse = nurseIds[0];

    let updatedSlots = [];
    if (Object.keys(updateData).length > 0) {
      // Before applying updates, check for conflicts per slot
      const targetSlotIds = new Set(slots.map(s => s._id.toString()));
      const minStart = new Date(Math.min(...slots.map(s => new Date(s.startTime).getTime())));
      const maxEnd = new Date(Math.max(...slots.map(s => new Date(s.endTime).getTime())));

      let existingByDentist = [];
      let existingByNurse = [];
      if (dentistIds.length > 0 && dentistIds[0]) {
        existingByDentist = await slotRepo.findByStaffId(dentistIds[0], minStart, maxEnd);
      }
      if (nurseIds.length > 0 && nurseIds[0]) {
        existingByNurse = await slotRepo.findByStaffId(nurseIds[0], minStart, maxEnd);
      }

      for (const s of slots) {
        const sStart = new Date(s.startTime);
        const sEnd = new Date(s.endTime);
        if (existingByDentist.length) {
          const conflict = existingByDentist.find(es => es._id.toString() !== s._id.toString() && new Date(es.startTime) < sEnd && new Date(es.endTime) > sStart);
          if (conflict) throw new Error('nha sĩ đã được phân công vào slot khác trong cùng khoảng thời gian');
        }
        if (existingByNurse.length) {
          const conflict = existingByNurse.find(es => es._id.toString() !== s._id.toString() && new Date(es.startTime) < sEnd && new Date(es.endTime) > sStart);
          if (conflict) throw new Error('Y tá đã được phân công vào slot khác trong cùng khoảng thời gian');
        }
      }

      await slotRepo.updateManySlots(queryFilter, updateData);
      updatedSlots = await slotRepo.find(queryFilter);
      
      // 🔄 Mark entities as used when successfully reassigned
      await markEntitiesAsUsed({ roomId, subRoomId, dentistIds, nurseIds });
    }
    
    // Clear cache - best effort
    try {
      await redisClient.del('slots:*');
    } catch (cacheError) {
      console.warn('Could not clear slot cache:', cacheError);
    }
    
    return {
      message: `Đã phân công lại thành công ${updatedSlots.length} slot`,
      updatedCount: updatedSlots.length,
      quarter,
      year,
      shifts: shifts.join(', '),
      dentistAssigned: dentistIds[0] || null,
      nurseAssigned: nurseIds[0] || null
    };
    
  } catch (error) {
    throw error;
  }
}

// Get nurse calendar with appointment counts (daily/weekly/monthly view) with historical support  
async function getNurseCalendar({ nurseId, viewType, startDate = null, page = 0, limit = 10 }) {
  try {
    // Get schedule config for shift information
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const scheduleConfig = await ScheduleConfig.getSingleton();
    if (!scheduleConfig) {
      throw new Error('Cấu hình lịch làm việc chưa được khởi tạo. Vui lòng liên hệ admin để thiết lập.');
    }
    
    // Use current date if startDate not provided
    const baseDate = startDate ? new Date(startDate) : getVietnamDate();
    
    // Calculate date ranges for pagination - support negative pages for historical data
    const periods = [];
    for (let i = 0; i < limit; i++) {
      // For page 0: periodIndex = 0 (current week/day/month)
      // For page 1: periodIndex = 1 (next period)
      // For page -1: periodIndex = -1 (previous period)
      // For page 2: periodIndex = 2 (2 periods ahead)
      let periodIndex = page * limit + i;
      
      let periodStart, periodEnd;
      
      switch (viewType) {
        case 'day':
          // Each period is one day
          periodStart = new Date(baseDate);
          periodStart.setDate(baseDate.getDate() + periodIndex);
          periodEnd = new Date(periodStart);
          break;
          
        case 'week':
          // Each period is one week (Monday to Sunday)
          const weekStart = new Date(baseDate);
          const dayOfWeek = weekStart.getDay();
          const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
          weekStart.setDate(baseDate.getDate() + mondayOffset + (periodIndex * 7));
          
          periodStart = new Date(weekStart);
          periodEnd = new Date(weekStart);
          periodEnd.setDate(weekStart.getDate() + 6);
          break;
          
        case 'month':
          // Each period is one month
          const targetYear = baseDate.getFullYear();
          const targetMonth = baseDate.getMonth() + periodIndex;
          
          // Use local dates to avoid timezone issues
          periodStart = new Date(targetYear, targetMonth, 1);
          periodEnd = new Date(targetYear, targetMonth + 1, 0); // Last day of target month
          
          // Adjust for correct local date representation
          periodStart.setHours(0, 0, 0, 0);
          periodEnd.setHours(23, 59, 59, 999);
          break;
          
        default:
          throw new Error('viewType phải là: day, week hoặc month');
      }
      
      periods.push({ start: periodStart, end: periodEnd });
    }
    
    // Get overall date range for database query
    const overallStart = periods[0].start;
    const overallEnd = periods[periods.length - 1].end;

    // Build UTC range for query
    const startUTC = new Date(Date.UTC(
      overallStart.getFullYear(),
      overallStart.getMonth(),
      overallStart.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      overallEnd.getFullYear(),
      overallEnd.getMonth(),
      overallEnd.getDate(),
      -7 + 24, 0, 0, 0
    ));

    // ⭐ Removed time filtering to show all historical data in view-only calendar
    // Query slots where this nurse is assigned (nurse is an array, so use $in)
    const queryFilter = {
      nurse: { $in: [nurseId] },
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache for nurse details
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const nurse = users.find(u => u._id === nurseId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    
    // Group slots by date and shift
    const calendar = {};
    const appointmentCounts = {}; // Track unique appointments
    const roomStats = {}; // Track room frequency by date and shift
    
    for (const slot of slots) {
      // Convert to Vietnam date
      const slotDateVN = new Date(slot.startTime).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh'
      });
      
      if (!calendar[slotDateVN]) {
        calendar[slotDateVN] = {
          date: slotDateVN,
          shifts: {
            'Ca Sáng': { appointmentCount: 0, totalSlots: 0, slots: [] },
            'Ca Chiều': { appointmentCount: 0, totalSlots: 0, slots: [] },
            'Ca Tối': { appointmentCount: 0, totalSlots: 0, slots: [] }
          },
          totalAppointments: 0,
          totalSlots: 0
        };
        appointmentCounts[slotDateVN] = new Set();
        roomStats[slotDateVN] = {
          'Ca Sáng': { rooms: {} },
          'Ca Chiều': { rooms: {} },
          'Ca Tối': { rooms: {} }
        };
      }
      
      const shift = calendar[slotDateVN].shifts[slot.shiftName];
      const shiftRoomStats = roomStats[slotDateVN][slot.shiftName];
      
      if (shift && shiftRoomStats) {
        shift.totalSlots++;
        calendar[slotDateVN].totalSlots++;
        
        // Count unique appointments
        if (slot.appointmentId) {
          appointmentCounts[slotDateVN].add(slot.appointmentId);
          shift.appointmentCount++;
        }
        
        // Track room frequency
        const roomKey = slot.roomId + (slot.subRoomId ? `_${slot.subRoomId}` : '');
        if (!shiftRoomStats.rooms[roomKey]) {
          shiftRoomStats.rooms[roomKey] = 0;
        }
        shiftRoomStats.rooms[roomKey]++;
        
        // ⭐ Add slot details with dentist/nurse info
        // Get dentist info
        let dentistInfo = [];
        if (Array.isArray(slot.dentist) && slot.dentist.length > 0) {
          dentistInfo = slot.dentist.map(dentistId => {
            const d = users.find(u => u._id === dentistId.toString());
            return d ? {
              id: d._id,
              fullName: d.fullName || d.name,
              employeeCode: d.employeeCode || d.code
            } : null;
          }).filter(Boolean);
        } else if (slot.dentist) {
          const d = users.find(u => u._id === slot.dentist.toString());
          if (d) {
            dentistInfo = [{
              id: d._id,
              fullName: d.fullName || d.name,
              employeeCode: d.employeeCode || d.code
            }];
          }
        }
        
        // Get nurse info
        let nurseInfo = [];
        if (Array.isArray(slot.nurse) && slot.nurse.length > 0) {
          nurseInfo = slot.nurse.map(nurseId => {
            const n = users.find(u => u._id === nurseId.toString());
            return n ? {
              id: n._id,
              fullName: n.fullName || n.name,
              employeeCode: n.employeeCode || n.code
            } : null;
          }).filter(Boolean);
        } else if (slot.nurse) {
          const n = users.find(u => u._id === slot.nurse.toString());
          if (n) {
            nurseInfo = [{
              id: n._id,
              fullName: n.fullName || n.name,
              employeeCode: n.employeeCode || n.code
            }];
          }
        }
        
        // Get room/subroom info
        const room = rooms.find(r => r._id === slot.roomId);
        let roomInfo = null;
        let subRoomInfo = null;
        
        if (room) {
          roomInfo = {
            id: room._id,
            name: room.name
          };
          
          if (slot.subRoomId && room.subRooms) {
            const subRoom = room.subRooms.find(sr => sr._id === slot.subRoomId);
            if (subRoom) {
              subRoomInfo = {
                id: subRoom._id,
                name: subRoom.name
              };
            }
          }
        }
        
        shift.slots.push({
          slotId: slot._id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          }),
          endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
          }),
          dentist: dentistInfo,
          nurse: nurseInfo,
          room: roomInfo,
          subRoom: subRoomInfo,
          isBooked: slot.isBooked || false,
          appointmentId: slot.appointmentId || null
        });
      }
    }
    
    // Update total appointment counts
    for (const date in appointmentCounts) {
      calendar[date].totalAppointments = appointmentCounts[date].size;
    }
    
    // Convert calendar object to array and sort by date
    const calendarArray = Object.values(calendar);
    calendarArray.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Group calendar data by periods (similar to room calendar)
    const calendarPeriods = periods.map((period, index) => {
      const periodCalendar = {};
      
      // Format dates properly for local timezone
      const periodStartStr = period.start.getFullYear() + '-' + 
        String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.start.getDate()).padStart(2, '0');
      const periodEndStr = period.end.getFullYear() + '-' + 
        String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
        String(period.end.getDate()).padStart(2, '0');
      
      // Filter days within this period
      calendarArray.forEach(day => {
        if (day.date >= periodStartStr && day.date <= periodEndStr) {
          periodCalendar[day.date] = day;
        }
      });
      
      // ⭐ NURSE CALENDAR: If no data, create empty calendar structure for all days in period
      if (Object.keys(periodCalendar).length === 0) {
        let currentDate = new Date(period.start);
        const endDate = new Date(period.end);
        
        while (currentDate <= endDate) {
          const dateStr = currentDate.getFullYear() + '-' + 
            String(currentDate.getMonth() + 1).padStart(2, '0') + '-' + 
            String(currentDate.getDate()).padStart(2, '0');
          
          periodCalendar[dateStr] = {
            date: dateStr,
            shifts: {
              'Ca Sáng': { appointmentCount: 0, totalSlots: 0, slots: [], mostFrequentRoom: null },
              'Ca Chiều': { appointmentCount: 0, totalSlots: 0, slots: [], mostFrequentRoom: null },
              'Ca Tối': { appointmentCount: 0, totalSlots: 0, slots: [], mostFrequentRoom: null }
            },
            totalAppointments: 0,
            totalSlots: 0
          };
          
          currentDate.setDate(currentDate.getDate() + 1);
        }
      }
      
      // Add room statistics for each day in this period
      const daysInPeriod = Object.values(periodCalendar).map(day => {
        const dayStats = roomStats[day.date];
        
        // Only process stats if day has data
        if (dayStats) {
          // Add most frequent room for each shift
          for (const shiftName of ['Ca Sáng', 'Ca Chiều', 'Ca Tối']) {
            const shiftStat = dayStats[shiftName];
            let mostFrequentRoom = null;
            
            if (Object.keys(shiftStat.rooms).length > 0) {
              const topRoomKey = Object.entries(shiftStat.rooms)
                .reduce((a, b) => a[1] > b[1] ? a : b)[0];
              
              const [roomId, subRoomId] = topRoomKey.split('_');
              const room = rooms.find(r => r._id === roomId);
              
              if (room) {
                mostFrequentRoom = {
                  id: roomId,
                  name: room.name,
                  slotCount: shiftStat.rooms[topRoomKey]
                };
                
                if (subRoomId && room.subRooms) {
                  const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
                  if (subRoom) {
                    mostFrequentRoom.subRoom = {
                      id: subRoom._id,
                      name: subRoom.name
                    };
                  }
                }
              }
            }
            
            day.shifts[shiftName].mostFrequentRoom = mostFrequentRoom;
          }
        }
        
        return day;
      }).sort((a, b) => a.date.localeCompare(b.date));
      
      return {
        periodIndex: (page - 1) * limit + index + 1,
        startDate: periodStartStr,
        endDate: periodEndStr,
        viewType,
        totalDays: daysInPeriod.length,
        days: daysInPeriod
      };
    });
    
    return {
      nurse: nurse ? { id: nurse._id, name: nurse.name } : { id: nurseId, name: 'Y tá không xác định' },
      viewType,
      pagination: {
        page,
        limit,
        hasNext: true, // Always allow going to future
        hasPrev: true, // Always allow going to past for nurse calendar
        totalPeriods: calendarPeriods.length
      },
      periods: calendarPeriods
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch y tá: ${error.message}`);
  }
}

// ⭐ NEW: Get slot details for a specific room/day/shift
async function getRoomSlotDetails({ roomId, subRoomId = null, date, shiftName }) {
  try {
    // Validate shift name
    const validShifts = ['Ca Sáng', 'Ca Chiều', 'Ca Tối'];
    if (!validShifts.includes(shiftName)) {
      throw new Error('shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối');
    }

    // ⭐ Get rooms cache to check if room has subrooms
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];
    const room = rooms.find(r => r._id === roomId);
    
    if (!room) {
      throw new Error('Không tìm thấy phòng');
    }

    // ⭐ Validate subRoomId based on hasSubRooms
    if (room.hasSubRooms) {
      // Phòng có subrooms: bắt buộc phải có subRoomId
      if (!subRoomId) {
        throw new Error('Phòng có buồng con phải cung cấp subRoomId');
      }
      // Kiểm tra subRoomId có tồn tại không
      const subRoom = room.subRooms?.find(sr => sr._id === subRoomId);
      if (!subRoom) {
        throw new Error('Không tìm thấy buồng con trong phòng này');
      }
    } else {
      // Phòng không có subrooms: không được có subRoomId
      if (subRoomId) {
        throw new Error('Phòng không có buồng con không được cung cấp subRoomId');
      }
    }

    // Parse date and create UTC range for the full day
    const targetDate = new Date(date);
    const startUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      roomId,
      shiftName,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };
    
    if (room.hasSubRooms) {
      queryFilter.subRoomId = subRoomId;
    } else {
      queryFilter.subRoomId = null;
    }

    const slots = await slotRepo.find(queryFilter);

console.log('🔍 getRoomSlotDetails - Found slots:', slots.length);

// Get user info from cache for staff details
const usersCache = await redisClient.get('users_cache');
let users = usersCache ? JSON.parse(usersCache) : [];

console.log('👥 Users cache count:', users.length);

// ⚠️ If cache is empty, query from DB directly
if (users.length === 0) {
  console.log('⚠️ Users cache empty! Querying from DB...');
  const User = require('../models/user.model');
  const usersFromDB = await User.find({ 
    role: { $in: ['dentist', 'nurse', 'admin', 'manager'] },
    isActive: true 
  }).select('_id name fullName employeeCode role').lean();
  users = usersFromDB.map(u => ({
    _id: u._id.toString(),
    name: u.name,
    fullName: u.fullName || u.name,
    employeeCode: u.employeeCode,
    role: u.role
  }));
  console.log('✅ Loaded', users.length, 'users from DB');
}

    
    // Build room info
    let roomInfo = {
      id: room._id,
      name: room.name,
      hasSubRooms: room.hasSubRooms
    };
    
    if (room.hasSubRooms && subRoomId) {
      const subRoom = room.subRooms.find(sr => sr._id === subRoomId);
      if (subRoom) {
        roomInfo.subRoom = {
          id: subRoom._id,
          name: subRoom.name
        };
      }
    }

    // Format slot details
    const slotDetails = slots.map(slot => {
      // ⭐ Handle ARRAY of dentists and nurses
      let dentistList = [];
      let nurseList = [];

      if (Array.isArray(slot.dentist)) {
        dentistList = slot.dentist
          .map(dentistId => {
            const user = users.find(u => u._id?.toString() === dentistId.toString());
            return user ? { id: user._id, name: user.name, fullName: user.fullName || user.name } : null;
          })
          .filter(Boolean);
      } else if (slot.dentist) {
        const user = users.find(u => u._id?.toString() === slot.dentist.toString());
        if (user) {
          dentistList.push({ id: user._id, name: user.name, fullName: user.fullName || user.name });
        }
      }

      if (Array.isArray(slot.nurse)) {
        nurseList = slot.nurse
          .map(nurseId => {
            const user = users.find(u => u._id?.toString() === nurseId.toString());
            return user ? { id: user._id, name: user.name, fullName: user.fullName || user.name } : null;
          })
          .filter(Boolean);
      } else if (slot.nurse) {
        const user = users.find(u => u._id?.toString() === slot.nurse.toString());
        if (user) {
          nurseList.push({ id: user._id, name: user.name, fullName: user.fullName || user.name });
        }
      }

      const hasDentist = dentistList.length > 0;
      const hasNurse = nurseList.length > 0;
      const hasStaff = hasDentist || hasNurse;
      
      return {
        slotId: slot._id,
        startTime: slot.startTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTime: slot.endTime,
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        dentist: dentistList, // ⭐ Return array
        nurse: nurseList,     // ⭐ Return array
        hasStaff: hasStaff,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null
      };
    });

    return {
      roomInfo,
      date,
      shiftName,
      totalSlots: slotDetails.length,
      bookedSlots: slotDetails.filter(s => s.isBooked).length,
      availableSlots: slotDetails.filter(s => !s.isBooked && s.hasStaff).length,
      slots: slotDetails
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy chi tiết slot phòng: ${error.message}`);
  }
}

// ⭐ NEW: Get slot details for a specific dentist/day/shift
async function getDentistSlotDetails({ dentistId, date, shiftName }) {
  try {
    // Validate shift name
    const validShifts = ['Ca Sáng', 'Ca Chiều', 'Ca Tối'];
    if (!validShifts.includes(shiftName)) {
      throw new Error('shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối');
    }

    // Parse date and create UTC range for the full day
    const targetDate = new Date(date);
    const startUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      dentist: dentistId,
      shiftName,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const dentist = users.find(u => u._id === dentistId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];

    // Format slot details
    const slotDetails = slots.map(slot => {
      const nurse = slot.nurse ? users.find(u => u._id === slot.nurse) : null;
      const room = rooms.find(r => r._id === slot.roomId);
      let roomInfo = room ? { id: room._id, name: room.name } : { id: slot.roomId, name: 'Phòng không xác định' };
      
      if (slot.subRoomId && room && room.subRooms) {
        const subRoom = room.subRooms.find(sr => sr._id === slot.subRoomId);
        if (subRoom) {
          roomInfo.subRoom = { id: subRoom._id, name: subRoom.name };
        }
      }
      
      return {
        slotId: slot._id,
        _id: slot._id, // ⭐ Add for compatibility
        startTime: slot.startTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTime: slot.endTime,
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        startDateTime: toVNDateTimeString(slot.startTime), // ⭐ YYYY-MM-DD HH:mm (VN timezone)
        endDateTime: toVNDateTimeString(slot.endTime), // ⭐ YYYY-MM-DD HH:mm (VN timezone)
        room: roomInfo,
        nurse: nurse ? { id: nurse._id, name: nurse.name } : null,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null
      };
    });

    return {
      dentist: dentist ? { id: dentist._id, name: dentist.name } : { id: dentistId, name: 'nha sĩ không xác định' },
      date,
      shiftName,
      totalSlots: slotDetails.length,
      bookedSlots: slotDetails.filter(s => s.isBooked).length,
      availableSlots: slotDetails.filter(s => !s.isBooked).length,
      slots: slotDetails
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy chi tiết slot nha sĩ: ${error.message}`);
  }
}

// ⭐ NEW: Get slot details for a specific nurse/day/shift
async function getNurseSlotDetails({ nurseId, date, shiftName }) {
  try {
    // Validate shift name
    const validShifts = ['Ca Sáng', 'Ca Chiều', 'Ca Tối'];
    if (!validShifts.includes(shiftName)) {
      throw new Error('shiftName phải là: Ca Sáng, Ca Chiều hoặc Ca Tối');
    }

    // Parse date and create UTC range for the full day
    const targetDate = new Date(date);
    const startUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7, 0, 0, 0
    ));
    const endUTC = new Date(Date.UTC(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      -7 + 24, 0, 0, 0
    ));

    const queryFilter = {
      nurse: nurseId,
      shiftName,
      startTime: { $gte: startUTC, $lt: endUTC },
      isActive: true
    };

    const slots = await slotRepo.find(queryFilter);
    
    // Get user info from cache
    const usersCache = await redisClient.get('users_cache');
    const users = usersCache ? JSON.parse(usersCache) : [];
    const nurse = users.find(u => u._id === nurseId);
    
    // Get rooms cache for room/subroom names
    const roomsCache = await redisClient.get('rooms_cache');
    const rooms = roomsCache ? JSON.parse(roomsCache) : [];

    // Format slot details
    const slotDetails = slots.map(slot => {
      const dentist = slot.dentist ? users.find(u => u._id === slot.dentist) : null;
      const room = rooms.find(r => r._id === slot.roomId);
      let roomInfo = room ? { id: room._id, name: room.name } : { id: slot.roomId, name: 'Phòng không xác định' };
      
      if (slot.subRoomId && room && room.subRooms) {
        const subRoom = room.subRooms.find(sr => sr._id === slot.subRoomId);
        if (subRoom) {
          roomInfo.subRoom = { id: subRoom._id, name: subRoom.name };
        }
      }
      
      return {
        slotId: slot._id,
        _id: slot._id, // ⭐ Add for compatibility
        startTime: slot.startTime,
        startTimeVN: new Date(slot.startTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        endTime: slot.endTime,
        endTimeVN: new Date(slot.endTime).toLocaleTimeString('en-GB', { 
          timeZone: 'Asia/Ho_Chi_Minh', 
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        }),
        startDateTime: toVNDateTimeString(slot.startTime), // ⭐ YYYY-MM-DD HH:mm (VN timezone)
        endDateTime: toVNDateTimeString(slot.endTime), // ⭐ YYYY-MM-DD HH:mm (VN timezone)
        room: roomInfo,
        dentist: dentist ? { id: dentist._id, name: dentist.name } : null,
        isBooked: slot.isBooked || false,
        appointmentId: slot.appointmentId || null
      };
    });

    return {
      nurse: nurse ? { id: nurse._id, name: nurse.name } : { id: nurseId, name: 'Y tá không xác định' },
      date,
      shiftName,
      totalSlots: slotDetails.length,
      bookedSlots: slotDetails.filter(s => s.isBooked).length,
      availableSlots: slotDetails.filter(s => !s.isBooked).length,
      slots: slotDetails
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy chi tiết slot y tá: ${error.message}`);
  }
}

// 🆕 Check if staff members have future schedules
async function checkStaffHasSchedule(staffIds, role) {
  try {
    const now = getVietnamDate();
    const fieldName = role === 'dentist' ? 'dentist' : 'nurse';
    
    // Query slots from now onwards for each staff member
    const results = await Promise.all(
      staffIds.map(async (staffId) => {
        try {
          const count = await slotRepo.countSlots({
            [fieldName]: staffId,
            startTime: { $gte: now }
          });
          
          return {
            staffId,
            hasSchedule: count > 0
          };
        } catch (error) {
          console.error(`Error checking schedule for ${staffId}:`, error);
          return {
            staffId,
            hasSchedule: false,
            error: error.message
          };
        }
      })
    );
    
    return results;
  } catch (error) {
    throw new Error(`Lỗi kiểm tra lịch nhân sự: ${error.message}`);
  }
}

module.exports = {
  assignStaffToSlots,
  assignStaffToSpecificSlots,
  reassignStaffToSlots,
  reassignStaffToSpecificSlots,
  updateSlotStaff,
  getSlotsByShiftAndDate,
  getRoomCalendar,
  getDentistCalendar,
  getNurseCalendar,
  getRoomSlotDetails,
  getDentistSlotDetails,
  getNurseSlotDetails,
  getVietnamDate,
  validateStaffIds,
  getAvailableQuartersYears,
  getAvailableShifts,
  getCurrentQuarterInfo,
  checkStaffHasSchedule
};
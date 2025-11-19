/**
 * PATIENT BOOKING SERVICE
 * Functions for patient booking flow
 */

const { getCachedUsers } = require('../utils/cacheHelper');
const redisClient = require('../utils/redis.client');

// Helper: Format date to Vietnam timezone (YYYY-MM-DD)
function toVNDateOnlyString(d) {
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vn.getFullYear();
  const m = String(vn.getMonth() + 1).padStart(2, '0');
  const day = String(vn.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Helper: Format time to Vietnam timezone (HH:mm)
function toVNTimeString(d) {
  if (!d) return null;
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const h = String(vn.getHours()).padStart(2, '0');
  const m = String(vn.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Helper: Format datetime to Vietnam timezone
function toVNDateTimeString(d) {
  if (!d) return null;
  const dateStr = toVNDateOnlyString(d);
  const timeStr = toVNTimeString(d);
  return `${dateStr} ${timeStr}`;
}

// 🆕 API 1: Get dentists with nearest available slot group
// Returns list of active dentists with their nearest slot group (> currentTime + 30 minutes)
async function getDentistsWithNearestSlot(serviceDuration = 15, serviceId = null) {
  try {
    const Slot = require('../models/slot.model');
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const axios = require('axios');
    
    // Get service info if serviceId provided
    let allowedRoomTypes = null;
    
    if (serviceId) {
      try {
        const serviceResponse = await axios.get(`${process.env.SERVICE_SERVICE_URL || 'http://localhost:3003'}/api/service/${serviceId}`);
        // 🔧 FIX: Service-service trả về { success: true, data: service }
        const serviceData = serviceResponse.data?.data || serviceResponse.data;
        
        allowedRoomTypes = serviceData?.allowedRoomTypes || null;
        console.log('🏥 Service data from API:', { 
          serviceId: serviceData?._id, 
          name: serviceData?.name,
          allowedRoomTypes 
        });
        
        console.log('🎯 Service duration from query:', serviceDuration, 'minutes');
        
      } catch (error) {
        console.warn('⚠️ Could not fetch service info:', error.message);
        console.warn('⚠️ Service filtering will be skipped. Using serviceDuration from query:', serviceDuration);
      }
    }
    
    // Get schedule config
    const config = await ScheduleConfig.findOne();
    const maxBookingDays = config?.maxBookingDays || 30;
    const slotDuration = config?.slotDurationMinutes || 15;
    const requiredSlotCount = Math.ceil(serviceDuration / slotDuration);
    
    // Calculate time threshold: currentTime + 30 minutes
    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 60 * 1000);
    
    // Calculate max date
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);
    
    console.log('⏰ Current time (VN):', toVNDateTimeString(now));
    console.log('🕐 Time threshold (now + 30min):', toVNDateTimeString(threshold));
    console.log('📅 Max date:', toVNDateOnlyString(maxDate));
    console.log('🎯 Service duration:', serviceDuration, 'minutes | Required slots:', requiredSlotCount);
    console.log('📊 Threshold ISO:', threshold.toISOString());
    
    // Get all active dentists from cache
    const allUsers = await getCachedUsers();
    console.log('🔍 Total users from cache:', allUsers.length);
    
    // Debug: Show all users with their roles
    if (allUsers.length > 0) {
      console.log('📋 All users roles:', allUsers.map(u => ({
        id: u._id,
        name: u.fullName,
        role: u.role,
        isActive: u.isActive
      })));
    }
    
    const activeDentists = allUsers.filter(u => {
      const roles = Array.isArray(u.roles) ? u.roles : [u.role];
      return roles.includes('dentist') && u.isActive === true;
    });
    
    console.log('👨‍⚕️ Found', activeDentists.length, 'active dentists');
    
    if (activeDentists.length > 0) {
      console.log('📋 Active dentists:', activeDentists.map(d => ({
        id: d._id,
        name: d.fullName,
        email: d.email
      })));
    }
    
    if (activeDentists.length === 0) {
      return {
        success: true,
        data: {
          dentists: [],
          totalDentists: 0,
          timeThreshold: toVNDateTimeString(threshold),
          maxDate: toVNDateOnlyString(maxDate)
        }
      };
    }
    
    // Find nearest available slot for each dentist
    const dentistsWithSlots = [];
    
    for (const dentist of activeDentists) {
      try {
        console.log(`\n🔍 Searching slot groups for dentist: ${dentist.fullName} (${dentist._id})`);
        
        // Get all available slots for this dentist within maxBookingDays range
        const availableSlots = await Slot.find({
          dentist: dentist._id,
          startTime: { $gte: threshold, $lte: maxDate },
          status: 'available',
          isActive: true
        })
        .sort({ startTime: 1 })
        .populate('scheduleId') // Populate schedule to get roomId, subRoomId
        .lean();
        
        
        
        if (availableSlots.length > 0) {
          const firstSlot = availableSlots[0];
          console.log('🎯 First slot startTime (VN):', toVNDateTimeString(firstSlot.startTime));
          console.log('🎯 First slot roomId:', firstSlot.roomId);
          console.log('🎯 First slot subRoomId:', firstSlot.subRoomId);
        }
        
        if (availableSlots.length === 0) {
          console.log('❌ No available slots within maxBookingDays range');
          continue;
        }
        
        // Fetch room information for all unique roomIds from Redis cache
        const uniqueRoomIds = [...new Set(availableSlots.map(s => s.roomId.toString()))];
        console.log('🏥 Unique room IDs:', uniqueRoomIds);
        
        // Fetch room details from Redis cache (rooms_cache)
        const roomMap = new Map();
        try {
          const roomsCache = await redisClient.get('rooms_cache');
          if (!roomsCache) {
            console.warn('⚠️ rooms_cache not found in Redis. Room filtering will be skipped.');
          } else {
            const allRooms = JSON.parse(roomsCache);
            console.log(`✅ Loaded ${allRooms.length} rooms from Redis cache`);
            
            // Build room map for quick lookup
            uniqueRoomIds.forEach(roomId => {
              const room = allRooms.find(r => r._id === roomId);
              if (room) {
                roomMap.set(roomId, room);
                console.log(`✅ Found room ${roomId} in cache: ${room.name}, type: ${room.roomType}`);
              } else {
                console.warn(`⚠️ Room ${roomId} not found in cache`);
              }
            });
          }
        } catch (error) {
          console.error('❌ Error reading rooms_cache from Redis:', error.message);
          // Continue without room filtering if Redis is unavailable
        }
        
        // Find first valid consecutive slot group with proper roomType filtering
        let nearestSlotGroup = null;
        
        for (let i = 0; i <= availableSlots.length - requiredSlotCount; i++) {
          const firstSlot = availableSlots[i];
          const firstSlotRoomId = firstSlot.roomId.toString();
          const roomData = roomMap.get(firstSlotRoomId);
          
          // ✅ STRICT: Check if room type is allowed (if allowedRoomTypes is specified)
          if (allowedRoomTypes && allowedRoomTypes.length > 0) {
            if (!roomData) {
              // console.log(`⏭️ Skipping slot ${i} - room ${firstSlotRoomId} not found in cache`);
              continue;
            }
            
            if (!roomData.roomType) {
              // console.log(`⏭️ Skipping slot ${i} - room ${firstSlotRoomId} has no roomType`);
              continue;
            }
            
            if (!allowedRoomTypes.includes(roomData.roomType)) {
              // console.log(`⏭️ Skipping slot ${i} - room type "${roomData.roomType}" not in allowed types:`, allowedRoomTypes);
              continue; // Skip this slot group
            }
            
            console.log(`✅ Slot ${i} - room type "${roomData.roomType}" is ALLOWED`);
          }
          
          // Try to build a group of required size
          let isConsecutive = true;
          const potentialGroup = [firstSlot];
          
          for (let j = 1; j < requiredSlotCount; j++) {
            const prevSlot = availableSlots[i + j - 1];
            const currentSlot = availableSlots[i + j];
            
            // All slots in group must be from the same room (same roomId AND subRoomId)
            if (currentSlot.roomId.toString() !== firstSlotRoomId ||
                currentSlot.subRoomId?.toString() !== firstSlot.subRoomId?.toString()) {
              console.log(`❌ Slot ${i + j} - different room/subroom (need same for group)`);
              isConsecutive = false;
              break;
            }
            
            // Check if consecutive (allow 1 minute tolerance)
            const prevEndTime = new Date(prevSlot.endTime).getTime();
            const currentStartTime = new Date(currentSlot.startTime).getTime();
            
            if (Math.abs(prevEndTime - currentStartTime) > 60000) {
              console.log(`❌ Slot ${i + j} - not consecutive (gap: ${Math.abs(prevEndTime - currentStartTime) / 1000}s)`);
              isConsecutive = false;
              break;
            }
            
            potentialGroup.push(currentSlot);
          }
          
          if (isConsecutive && potentialGroup.length === requiredSlotCount) {
            const lastSlot = potentialGroup[potentialGroup.length - 1];
            const roomData = roomMap.get(firstSlotRoomId);
            
            nearestSlotGroup = {
              slotIds: potentialGroup.map(s => s._id),
              date: toVNDateOnlyString(firstSlot.startTime),
              startTime: toVNTimeString(firstSlot.startTime),
              endTime: toVNTimeString(lastSlot.endTime),
              shiftName: firstSlot.shiftName,
              slotCount: requiredSlotCount,
              duration: serviceDuration,
              room: {
                _id: firstSlot.roomId,
                subRoomId: firstSlot.subRoomId || null,
                name: roomData?.name || 'Unknown Room',
                roomType: roomData?.roomType || null
              }
            };
            
            console.log('✅ Found nearest slot group:', {
              date: nearestSlotGroup.date,
              startTime: nearestSlotGroup.startTime,
              endTime: nearestSlotGroup.endTime,
              slotCount: nearestSlotGroup.slotCount,
              duration: nearestSlotGroup.duration,
              roomId: nearestSlotGroup.room._id,
              subRoomId: nearestSlotGroup.room.subRoomId,
              roomType: nearestSlotGroup.room.roomType
            });
            
            break; // Found the nearest group, stop searching
          }
        }
        
        if (nearestSlotGroup) {
          dentistsWithSlots.push({
            ...dentist,
            nearestSlot: nearestSlotGroup
          });
        } else {
          console.log(`❌ No valid slot group found (need ${requiredSlotCount} consecutive slots in same room with allowed roomType)`);
        }
        
      } catch (error) {
        console.warn(`⚠️ Error finding slot for dentist ${dentist._id}:`, error.message);
        console.error(error.stack);
        continue;
      }
    }
    
    console.log(`\n📊 Summary: ${dentistsWithSlots.length}/${activeDentists.length} dentists have available slots`);
    
    // Sort dentists by nearest slot time
    dentistsWithSlots.sort((a, b) => {
      const dateA = new Date(a.nearestSlot.date + 'T' + a.nearestSlot.startTime);
      const dateB = new Date(b.nearestSlot.date + 'T' + b.nearestSlot.startTime);
      return dateA - dateB;
    });
    
    console.log('✅ Found', dentistsWithSlots.length, 'dentists with available slots');
    
    return {
      success: true,
      data: {
        dentists: dentistsWithSlots,
        totalDentists: dentistsWithSlots.length,
        timeThreshold: toVNDateTimeString(threshold),
        maxDate: toVNDateOnlyString(maxDate)
      }
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy danh sách nha sỹ: ${error.message}`);
  }
}

// 🆕 Helper: Group consecutive slots and check if enough slots available for duration
function hasEnoughConsecutiveSlots(slots, serviceDuration = 15, slotDuration = 15) {
  const requiredSlotCount = Math.ceil(serviceDuration / slotDuration);
  
  // If service only needs 1 slot, any available slot is enough
  if (requiredSlotCount <= 1) {
    return slots.length > 0;
  }
  
  // Sort slots by startTime
  const sortedSlots = [...slots].sort((a, b) => {
    const timeA = new Date(a.startTime).getTime();
    const timeB = new Date(b.startTime).getTime();
    return timeA - timeB;
  });
  
  // Sliding window to find consecutive groups
  for (let i = 0; i <= sortedSlots.length - requiredSlotCount; i++) {
    let isConsecutive = true;
    
    for (let j = 0; j < requiredSlotCount - 1; j++) {
      const currentSlot = sortedSlots[i + j];
      const nextSlot = sortedSlots[i + j + 1];
      
      const currentEndTime = new Date(currentSlot.endTime).getTime();
      const nextStartTime = new Date(nextSlot.startTime).getTime();
      
      // Check if slots are consecutive (allow 1 minute tolerance)
      if (Math.abs(currentEndTime - nextStartTime) > 60000) {
        isConsecutive = false;
        break;
      }
    }
    
    if (isConsecutive) {
      return true; // Found at least one valid group
    }
  }
  
  return false;
}

// 🆕 API 2: Get dentist working dates within maxBookingDays
// Returns list of dates when dentist has available slots (with enough consecutive slots for service duration)
async function getDentistWorkingDates(dentistId, serviceDuration = 15, serviceId = null) {
  try {
    const Slot = require('../models/slot.model');
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const axios = require('axios');
    
    // 🆕 Get service allowedRoomTypes if serviceId provided
    let allowedRoomTypes = null;
    if (serviceId) {
      try {
        const serviceResponse = await axios.get(`${process.env.SERVICE_SERVICE_URL || 'http://localhost:3003'}/api/service/${serviceId}`);
        const serviceData = serviceResponse.data?.data || serviceResponse.data;
        allowedRoomTypes = serviceData?.allowedRoomTypes || null;
        console.log('🏥 Service allowed room types:', allowedRoomTypes);
      } catch (error) {
        console.warn('⚠️ Could not fetch service info:', error.message);
      }
    }
    
    // Get schedule config
    const config = await ScheduleConfig.findOne();
    const maxBookingDays = config?.maxBookingDays || 30;
    const slotDuration = config?.slotDurationMinutes || 15;

    
    // Calculate date range
    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 60 * 1000);
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);
    
    console.log('📅 getDentistWorkingDates - Date range:', toVNDateOnlyString(now), 'to', toVNDateOnlyString(maxDate));
    console.log('⏰ Current time (VN):', toVNDateTimeString(now));
    console.log('🕐 Threshold (now + 30min, VN):', toVNDateTimeString(threshold));
    console.log('📊 Threshold (ISO):', threshold.toISOString());
    console.log('🎯 Service duration:', serviceDuration, 'minutes | Slot duration:', slotDuration, 'minutes');
    console.log('📊 Required consecutive slots:', Math.ceil(serviceDuration / slotDuration));
    
    // Get all slots for this dentist within date range
    const slots = await Slot.find({
      dentist: dentistId, // MongoDB will match if dentistId is in the dentist array
      startTime: { $gte: threshold, $lte: maxDate },
      status: 'available',
      isActive: true
    })
    .select('startTime endTime shiftName status roomId subRoomId') // 🆕 Include roomId
    .sort({ startTime: 1 })
    .lean();
    
    console.log('📋 Found', slots.length, 'available slots for dentist');
    
    if (slots.length > 0) {
      const firstSlot = slots[0];
      console.log('🎯 First slot startTime (VN):', toVNDateTimeString(firstSlot.startTime));
      console.log('🎯 First slot startTime (ISO):', firstSlot.startTime.toISOString());
      console.log('✅ Query used threshold (ISO):', threshold.toISOString());
    }
    
    // 🆕 Filter slots by roomType if allowedRoomTypes is specified
    let filteredSlots = slots;
    if (allowedRoomTypes && allowedRoomTypes.length > 0) {
      // Load room data from Redis cache
      const roomMap = new Map();
      try {
        const roomsCache = await redisClient.get('rooms_cache');
        if (roomsCache) {
          const allRooms = JSON.parse(roomsCache);
          allRooms.forEach(room => {
            roomMap.set(room._id, room);
          });
          console.log(`✅ Loaded ${allRooms.length} rooms from Redis cache`);
        }
      } catch (error) {
        console.warn('⚠️ Could not load rooms from cache:', error.message);
      }
      
      // Filter slots by roomType
      filteredSlots = slots.filter(slot => {
        const roomId = slot.roomId?.toString();
        if (!roomId) return false;
        
        const room = roomMap.get(roomId);
        if (!room || !room.roomType) {
          // console.log(`⏭️ Skipping slot - room ${roomId} not found or no roomType`);
          return false;
        }
        
        const isAllowed = allowedRoomTypes.includes(room.roomType);
        if (!isAllowed) {
          // console.log(`⏭️ Skipping slot - room type "${room.roomType}" not in allowed types`);
        }
        return isAllowed;
      });
      
      console.log(`🔍 Filtered slots: ${slots.length} → ${filteredSlots.length} (by roomType)`);
    }
    
    if (filteredSlots.length === 0) {
      return {
        success: true,
        data: {
          dentistId,
          workingDates: [],
          totalDates: 0,
          maxBookingDays,
          dateRange: {
            from: toVNDateOnlyString(now),
            to: toVNDateOnlyString(maxDate)
          }
        }
      };
    }
    
    // Group slots by date and shift
    const dateMap = new Map();
    
    filteredSlots.forEach(slot => {
      const dateStr = toVNDateOnlyString(slot.startTime);
      
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, {
          date: dateStr,
          shifts: {
            morning: { available: false, slots: [] },
            afternoon: { available: false, slots: [] },
            evening: { available: false, slots: [] }
          },
          allSlots: [], // Store all slots for date-level checking
          totalSlots: 0,
          availableSlots: 0
        });
      }
      
      const dateData = dateMap.get(dateStr);
      
      // Determine shift
      let shiftKey = 'morning';
      const hour = new Date(slot.startTime).getHours();
      if (hour >= 12 && hour < 17) shiftKey = 'afternoon';
      else if (hour >= 17) shiftKey = 'evening';
      
      dateData.shifts[shiftKey].slots.push(slot);
      dateData.allSlots.push(slot);
      dateData.totalSlots++;
      dateData.availableSlots += 1;
    });
    
    // Filter dates: only keep dates with enough consecutive slots
    const validWorkingDates = [];
    
    for (const [dateStr, dateData] of dateMap.entries()) {
      // Check each shift for consecutive slots
      let hasValidShift = false;
      
      for (const [shiftKey, shiftData] of Object.entries(dateData.shifts)) {
        if (shiftData.slots.length > 0) {
          const hasEnoughSlots = hasEnoughConsecutiveSlots(
            shiftData.slots, 
            serviceDuration, 
            slotDuration
          );
          
          if (hasEnoughSlots) {
            shiftData.available = true;
            hasValidShift = true;
            
            // Convert slots to display format
            shiftData.slots = shiftData.slots.map(s => ({
              _id: s._id,
              startTime: toVNTimeString(s.startTime),
              endTime: toVNTimeString(s.endTime),
              availableAppointments: 1
            }));
          } else {
            // This shift doesn't have enough consecutive slots
            shiftData.available = false;
            shiftData.slots = [];
          }
        }
      }
      
      // Only add date if at least one shift has valid slot groups
      if (hasValidShift) {
        validWorkingDates.push({
          date: dateData.date,
          shifts: dateData.shifts,
          totalSlots: dateData.totalSlots,
          availableSlots: dateData.availableSlots
        });
        
        console.log(`✅ Date ${dateStr}: Has valid slot groups`);
      } else {
        console.log(`❌ Date ${dateStr}: No valid slot groups (${dateData.totalSlots} slots but not enough consecutive)`);
      }
    }
    
    // Sort by date
    const workingDates = validWorkingDates.sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    console.log('✅ Found', workingDates.length, 'working dates');
    
    return {
      success: true,
      data: {
        dentistId,
        workingDates,
        totalDates: workingDates.length,
        maxBookingDays,
        dateRange: {
          from: toVNDateOnlyString(now),
          to: toVNDateOnlyString(maxDate)
        }
      }
    };
    
  } catch (error) {
    throw new Error(`Lỗi lấy lịch làm việc của nha sỹ: ${error.message}`);
  }
}

module.exports = {
  getDentistsWithNearestSlot,
  getDentistWorkingDates
};

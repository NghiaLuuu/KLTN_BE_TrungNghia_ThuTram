/**
 * PATIENT BOOKING SERVICE
 * Functions for patient booking flow
 */

const { getCachedUsers } = require('../utils/cacheHelper');

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

// 🆕 API 1: Get dentists with nearest available slot
// Returns list of active dentists with their nearest slot (> currentTime + 30 minutes)
async function getDentistsWithNearestSlot() {
  try {
    const Slot = require('../models/slot.model');
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    
    // Get schedule config for maxBookingDays
    const config = await ScheduleConfig.findOne();
    const maxBookingDays = config?.maxBookingDays || 30;
    
    // Calculate time threshold: currentTime + 30 minutes
    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 60 * 1000);
    
    // Calculate max date
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);
    
    console.log('⏰ Time threshold:', toVNDateTimeString(threshold));
    console.log('📅 Max date:', toVNDateOnlyString(maxDate));
    
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
    
    const activeDentists = allUsers.filter(u => 
      u.role === 'dentist' && 
      u.isActive === true
    );
    
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
        console.log(`\n🔍 Searching slots for dentist: ${dentist.fullName} (${dentist._id})`);
        
        // First, check if there are ANY slots for this dentist (without time filter)
        const anySlots = await Slot.find({ dentist: dentist._id }).limit(5).lean();
        console.log(`📊 Total slots found for this dentist (sample):`, anySlots.length);
        if (anySlots.length > 0) {
          console.log(`📋 Sample slot:`, {
            _id: anySlots[0]._id,
            dentist: anySlots[0].dentist,
            startTime: anySlots[0].startTime,
            endTime: anySlots[0].endTime,
            appointmentCount: anySlots[0].appointmentCount,
            maxAppointments: anySlots[0].maxAppointments
          });
        }
        
        // Find nearest slot for this dentist
        // Conditions:
        // 1. Slot has this dentist assigned (dentist is array)
        // 2. Slot start time > threshold
        // 3. Slot start time <= maxDate
        // 4. Slot is not booked and is available
        // 5. Slot is active
        
        const query = {
          dentist: dentist._id, // MongoDB will match if _id is in the dentist array
          startTime: { $gte: threshold, $lte: maxDate },
          isBooked: false,
          isAvailable: true,
          isActive: true
        };
        
        console.log('🔍 Query:', JSON.stringify(query, null, 2));
        
        const nearestSlot = await Slot.findOne(query)
        .sort({ startTime: 1 })
        .limit(1)
        .populate({
          path: 'scheduleId',
          populate: { path: 'roomId' }
        })
        .lean();
        
        if (nearestSlot) {
          console.log('✅ Found nearest slot:', {
            slotId: nearestSlot._id,
            startTime: nearestSlot.startTime,
            endTime: nearestSlot.endTime,
            isBooked: nearestSlot.isBooked,
            isAvailable: nearestSlot.isAvailable,
            isActive: nearestSlot.isActive,
            dentists: nearestSlot.dentist
          });
          dentistsWithSlots.push({
            ...dentist,
            nearestSlot: {
              _id: nearestSlot._id,
              date: toVNDateOnlyString(nearestSlot.startTime),
              startTime: toVNTimeString(nearestSlot.startTime),
              endTime: toVNTimeString(nearestSlot.endTime),
              shiftName: nearestSlot.shiftName,
              availableAppointments: 1, // Each slot can have 1 appointment
              room: nearestSlot.scheduleId?.roomId ? {
                _id: nearestSlot.scheduleId.roomId._id,
                name: nearestSlot.scheduleId.roomId.roomName
              } : null
            }
          });
        } else {
          console.log('❌ No available slot found for this dentist');
        }
        
      } catch (error) {
        console.warn(`⚠️ Error finding slot for dentist ${dentist._id}:`, error.message);
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

// 🆕 API 2: Get dentist working dates within maxBookingDays
// Returns list of dates when dentist has available slots
async function getDentistWorkingDates(dentistId) {
  try {
    const Slot = require('../models/slot.model');
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    
    // Get schedule config for maxBookingDays
    const config = await ScheduleConfig.findOne();
    const maxBookingDays = config?.maxBookingDays || 30;
    
    // Calculate date range
    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 60 * 1000);
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);
    
    console.log('📅 getDentistWorkingDates - Date range:', toVNDateOnlyString(now), 'to', toVNDateOnlyString(maxDate));
    console.log('⏰ Threshold (now + 30min):', threshold.toISOString());
    
    // Get all slots for this dentist within date range
    const slots = await Slot.find({
      dentist: dentistId, // MongoDB will match if dentistId is in the dentist array
      startTime: { $gte: threshold, $lte: maxDate },
      isBooked: false,
      isAvailable: true,
      isActive: true
    })
    .select('startTime endTime shiftName isBooked isAvailable')
    .sort({ startTime: 1 })
    .lean();
    
    console.log('📋 Found', slots.length, 'available slots for dentist');
    
    if (slots.length === 0) {
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
    
    // Group slots by date
    const dateMap = new Map();
    
    slots.forEach(slot => {
      const dateStr = toVNDateOnlyString(slot.startTime);
      
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, {
          date: dateStr,
          shifts: {
            morning: { available: false, slots: [] },
            afternoon: { available: false, slots: [] },
            evening: { available: false, slots: [] }
          },
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
      
      dateData.shifts[shiftKey].available = true;
      dateData.shifts[shiftKey].slots.push({
        _id: slot._id,
        startTime: toVNTimeString(slot.startTime),
        endTime: toVNTimeString(slot.endTime),
        availableAppointments: 1 // Each slot can have 1 appointment
      });
      
      dateData.totalSlots++;
      dateData.availableSlots += 1; // Each slot = 1 available appointment
    });
    
    // Convert map to array
    const workingDates = Array.from(dateMap.values());
    
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

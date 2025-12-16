/**
 * PATIENT BOOKING SERVICE
 * Functions for patient booking flow
 */

const { getCachedUsers } = require('../utils/cacheHelper');
const redisClient = require('../utils/redis.client');

// Hỗ trợ: Định dạng ngày theo múi giờ Việt Nam (YYYY-MM-DD)
function toVNDateOnlyString(d) {
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const y = vn.getFullYear();
  const m = String(vn.getMonth() + 1).padStart(2, '0');
  const day = String(vn.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Hỗ trợ: Định dạng thời gian theo múi giờ Việt Nam (HH:mm)
function toVNTimeString(d) {
  if (!d) return null;
  const vn = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const h = String(vn.getHours()).padStart(2, '0');
  const m = String(vn.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Hỗ trợ: Định dạng ngày giờ theo múi giờ Việt Nam
function toVNDateTimeString(d) {
  if (!d) return null;
  const dateStr = toVNDateOnlyString(d);
  const timeStr = toVNTimeString(d);
  return `${dateStr} ${timeStr}`;
}

// 🆕 API 1: Lấy nha sĩ với nhóm slot trống gần nhất
// Trả về danh sách nha sĩ hoạt động với nhóm slot gần nhất (> thờiGianHiệnTại + 30 phút)
async function getDentistsWithNearestSlot(serviceDuration = 15, serviceId = null) {
  try {
    const Slot = require('../models/slot.model');
    const { ScheduleConfig } = require('../models/scheduleConfig.model');
    const axios = require('axios');
    
    // Lấy thông tin dịch vụ nếu có serviceId
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
    
    // Lấy cấu hình lịch
    const config = await ScheduleConfig.findOne();
    const maxBookingDays = config?.maxBookingDays || 30;
    const slotDuration = config?.slotDurationMinutes || 15;
    const requiredSlotCount = Math.ceil(serviceDuration / slotDuration);
    
    // Tính ngưỡng thời gian: thờiGianHiệnTại + 30 phút
    const now = new Date();
    const threshold = new Date(now.getTime() + 30 * 60 * 1000);
    
    // Tính ngày tối đa
    const maxDate = new Date(now);
    maxDate.setDate(maxDate.getDate() + maxBookingDays);
    
    console.log('⏰ Current time (VN):', toVNDateTimeString(now));
    console.log('🕐 Time threshold (now + 30min):', toVNDateTimeString(threshold));
    console.log('📅 Max date:', toVNDateOnlyString(maxDate));
    console.log('🎯 Service duration:', serviceDuration, 'minutes | Required slots:', requiredSlotCount);
    console.log('📊 Threshold ISO:', threshold.toISOString());
    
    // Lấy tất cả nha sĩ hoạt động từ cache
    const allUsers = await getCachedUsers();
    console.log('🔍 Tổng số users từ cache:', allUsers.length);
    
    // Debug: Hiển thị tất cả users với roles của họ
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
    
    // Tìm slot trống gần nhất cho mỗi nha sĩ
    const dentistsWithSlots = [];
    
    for (const dentist of activeDentists) {
      try {
        console.log(`\n🔍 Đang tìm nhóm slot cho nha sĩ: ${dentist.fullName} (${dentist._id})`);
        
        // Lấy tất cả slots trống cho nha sĩ này trong khoảng maxBookingDays
        const availableSlots = await Slot.find({
          dentist: dentist._id,
          startTime: { $gte: threshold, $lte: maxDate },
          status: 'available',
          isActive: true
        })
        .sort({ startTime: 1 })
        .populate('scheduleId') // Populate schedule để lấy roomId, subRoomId
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
        
        // Lấy thông tin phòng cho tất cả roomIds duy nhất từ room-service API
        const uniqueRoomIds = [...new Set(availableSlots.map(s => s.roomId.toString()))];
        console.log('🏥 Các room IDs duy nhất:', uniqueRoomIds);
        
        // Lấy chi tiết phòng từ room-service API
        const roomMap = new Map();
        try {
          const { sendRpcRequest } = require('../utils/rabbitmq.client');
          const roomsData = await sendRpcRequest('room_queue', { action: 'getAllRooms' }, 5000);
          
          if (!roomsData || !roomsData.success) {
            console.warn('⚠️ Không thể lấy phòng từ API. Lọc phòng sẽ bị bỏ qua.');
          } else {
            const allRooms = roomsData.data;
            console.log(`✅ Đã tải ${allRooms.length} phòng từ room-service API`);
            
            // Xây dựng room map để tra cứu nhanh
            uniqueRoomIds.forEach(roomId => {
              const room = allRooms.find(r => r._id === roomId);
              if (room) {
                roomMap.set(roomId, room);
                console.log(`✅ Tìm thấy phòng ${roomId}: ${room.name}, loại: ${room.roomType}`);
              } else {
                console.warn(`⚠️ Không tìm thấy phòng ${roomId}`);
              }
            });
          }
        } catch (error) {
          console.error('❌ Lỗi khi lấy phòng từ API:', error.message);
          // Tiếp tục mà không lọc phòng nếu API không khả dụng
        }
        
        // Tìm nhóm slot liên tiếp hợp lệ đầu tiên với lọc roomType đúng
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
          
          // Cố gắng xây dựng một nhóm với số lượng yêu cầu
          let isConsecutive = true;
          const potentialGroup = [firstSlot];
          
          for (let j = 1; j < requiredSlotCount; j++) {
            const prevSlot = availableSlots[i + j - 1];
            const currentSlot = availableSlots[i + j];
            
            // Tất cả slots trong nhóm phải từ cùng một phòng (cùng roomId VÀ subRoomId)
            if (currentSlot.roomId.toString() !== firstSlotRoomId ||
                currentSlot.subRoomId?.toString() !== firstSlot.subRoomId?.toString()) {
              console.log(`❌ Slot ${i + j} - different room/subroom (need same for group)`);
              isConsecutive = false;
              break;
            }
            
            // Kiểm tra liên tiếp (cho phép sai lệch 1 phút)
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
            
            break; // Đã tìm thấy nhóm gần nhất, dừng tìm kiếm
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
    
    // Sắp xếp nha sĩ theo thời gian slot gần nhất
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
  
  // Nếu dịch vụ chỉ cần 1 slot, bất kỳ slot có sẵn nào cũng đủ
  if (requiredSlotCount <= 1) {
    return slots.length > 0;
  }
  
  // Sắp xếp slots theo startTime
  const sortedSlots = [...slots].sort((a, b) => {
    const timeA = new Date(a.startTime).getTime();
    const timeB = new Date(b.startTime).getTime();
    return timeA - timeB;
  });
  
  // Cửa sổ trượt để tìm các nhóm liên tiếp
  for (let i = 0; i <= sortedSlots.length - requiredSlotCount; i++) {
    let isConsecutive = true;
    
    for (let j = 0; j < requiredSlotCount - 1; j++) {
      const currentSlot = sortedSlots[i + j];
      const nextSlot = sortedSlots[i + j + 1];
      
      const currentEndTime = new Date(currentSlot.endTime).getTime();
      const nextStartTime = new Date(nextSlot.startTime).getTime();
      
      // Kiểm tra các slots có liên tiếp không (cho phép sai lệch 1 phút)
      if (Math.abs(currentEndTime - nextStartTime) > 60000) {
        isConsecutive = false;
        break;
      }
    }
    
    if (isConsecutive) {
      return true; // Đã tìm thấy ít nhất một nhóm hợp lệ
    }
  }
  
  return false;
}

// 🆕 API 2: Get dentist working dates within maxBookingDays
// Trả về danh sách các ngày nha sĩ có slots trống (với đủ slots liên tiếp cho thời lượng dịch vụ)
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
    
    // Lấy cấu hình lịch
    const config = await ScheduleConfig.findOne();
    const maxBookingDays = config?.maxBookingDays || 30;
    const slotDuration = config?.slotDurationMinutes || 15;

    
    // Tính khoảng ngày
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
    
    // Lấy tất cả slots của nha sĩ trong khoảng ngày
    const slots = await Slot.find({
      dentist: dentistId, // MongoDB sẽ khớp nếu dentistId nằm trong mảng dentist
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
      // Tải dữ liệu phòng từ room-service API
      const roomMap = new Map();
      try {
        const { sendRpcRequest } = require('../utils/rabbitmq.client');
        const roomsData = await sendRpcRequest('room_queue', { action: 'getAllRooms' }, 5000);
        
        if (roomsData && roomsData.success) {
          const allRooms = roomsData.data;
          allRooms.forEach(room => {
            roomMap.set(room._id, room);
          });
          console.log(`✅ Loaded ${allRooms.length} rooms from room-service API`);
        }
      } catch (error) {
        console.warn('⚠️ Could not load rooms from API:', error.message);
      }
      
      // Lọc slots theo roomType
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
    
    // Nhóm slots theo ngày và ca
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
          allSlots: [], // Lưu tất cả slots để kiểm tra cấp độ ngày
          totalSlots: 0,
          availableSlots: 0
        });
      }
      
      const dateData = dateMap.get(dateStr);
      
      // ✅ FIX: Use slot.shiftName from database instead of calculating from hour
      // Điều này đảm bảo nhất quán với /details/future API nhóm theo shiftName
      let shiftKey = 'morning'; // default
      if (slot.shiftName === 'Ca Sáng') shiftKey = 'morning';
      else if (slot.shiftName === 'Ca Chiều') shiftKey = 'afternoon';
      else if (slot.shiftName === 'Ca Tối') shiftKey = 'evening';
      
      dateData.shifts[shiftKey].slots.push(slot);
      dateData.allSlots.push(slot);
      dateData.totalSlots++;
      dateData.availableSlots += 1;
    });
    
    // Lọc ngày: chỉ giữ các ngày có đủ slots liên tiếp
    const validWorkingDates = [];
    
    for (const [dateStr, dateData] of dateMap.entries()) {
      // Kiểm tra từng ca có slots liên tiếp không
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
            
            // Chuyển đổi slots sang định dạng hiển thị
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
    
    // Sắp xếp theo ngày
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

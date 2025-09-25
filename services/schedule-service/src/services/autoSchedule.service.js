const scheduleRepo = require('../repositories/schedule.repository');
const scheduleService = require('./schedule.service');
const redisClient = require('../utils/redis.client');
const Schedule = require('../models/schedule.model');
const AutoScheduleConfig = require('../models/autoScheduleConfig.model');

const { getVietnamDate } = require('../utils/vietnamTime.util');
const scheduleConfigService = require('./scheduleConfig.service');

// Helper: Get all active rooms from Redis cache
async function getAllRooms() {
  try {
    const cached = await redisClient.get('rooms_cache');
    if (!cached) return [];
    const allRooms = JSON.parse(cached);
    
    // ✅ Chỉ lấy rooms đang hoạt động và có autoScheduleEnabled = true
    const activeRooms = (allRooms || []).filter(room => 
      room.isActive === true && 
      room.autoScheduleEnabled !== false // default true nếu không có field này
    );
    
    console.log(`📋 Found ${activeRooms.length} active rooms out of ${allRooms.length} total rooms`);
    return activeRooms;
  } catch (error) {
    console.error('Failed to read rooms_cache from redis:', error);
    throw new Error('Không thể lấy danh sách phòng từ cache');
  }
}

// Helper: Calculate quarter info
function getQuarterInfo(date = null) {
  const vnDate = date ? new Date(date.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"})) : getVietnamDate();
  const quarter = Math.ceil((vnDate.getMonth() + 1) / 3);
  const year = vnDate.getFullYear();
  return { quarter, year };
}

// Helper: Get quarter date range (Vietnam timezone)
function getQuarterDateRange(quarter, year) {
  const startMonth = (quarter - 1) * 3;
  
  // Tạo ngày bắt đầu quý theo timezone Việt Nam
  const startDate = new Date(year, startMonth, 1);
  
  // Tạo ngày kết thúc quý (ngày cuối cùng của quý)
  const endDate = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
  
  return { startDate, endDate };
}

// Helper: Get months in quarter
function getMonthsInQuarter(quarter) {
  const startMonth = (quarter - 1) * 3 + 1; // 1-indexed
  return [startMonth, startMonth + 1, startMonth + 2];
}

// Helper: Check if schedule exists for specific month
async function hasScheduleForMonth(roomId, year, month) {
  const startDate = new Date(year, month - 1, 1); // month is 1-indexed
  const endDate = new Date(year, month, 0, 23, 59, 59, 999); // Last day of month
  
  const existingSchedules = await scheduleRepo.findByRoomAndDateRange(roomId, startDate, endDate);
  return existingSchedules && existingSchedules.length > 0;
}

// Helper: Check quarter completion status
async function checkQuarterStatus(roomId, quarter, year) {
  const months = getMonthsInQuarter(quarter);
  const status = {
    quarter,
    year,
    monthsStatus: {},
    completedMonths: 0,
    totalMonths: 3,
    isComplete: false
  };

  for (const month of months) {
    const hasSchedule = await hasScheduleForMonth(roomId, year, month);
    status.monthsStatus[month] = hasSchedule;
    if (hasSchedule) {
      status.completedMonths++;
    }
  }

  status.isComplete = status.completedMonths === status.totalMonths;
  return status;
}

// Main function: Auto generate schedules for room
async function autoGenerateSchedulesForRoom(roomId) {
  const currentDate = getVietnamDate();
  const { quarter: currentQuarter, year: currentYear } = getQuarterInfo(currentDate);
  
  console.log(`🔍 Auto-generating schedules for room ${roomId} - Current: Q${currentQuarter} ${currentYear}`);
  
  const results = [];

  // ✅ ĐỒNG BỘ HÓA: Sử dụng chính xác logic generateQuarterSchedule
  // Không tạo từng tháng riêng lẻ, mà tạo cả quý như thủ công
  
  try {
    // ✅ ĐỒNG BỘ HÓA HOÀN TOÀN: Sử dụng chính xác generateQuarterSchedule
    // Nhưng chỉ tạo cho từng room riêng lẻ (không tạo toàn bộ như thủ công)
    
    // Strategy 1: Kiểm tra và tạo quý hiện tại nếu cần
    const currentAnalysis = await scheduleService.getQuarterAnalysisForRoom(roomId, currentQuarter, currentYear, currentDate);
    
    if (currentAnalysis.needGenerate && !currentAnalysis.allPastMonths) {
      console.log(`📅 Auto-generating Q${currentQuarter}/${currentYear} for room ${roomId}`);
      
      try {
        // ✅ ĐỒNG BỘ HOÀN TOÀN: Sử dụng generateQuarterScheduleForSingleRoom
        // Sử dụng CHÍNH XÁC logic của generateQuarterSchedule cho 1 room
        const quarterResult = await scheduleService.generateQuarterScheduleForSingleRoom(roomId, currentQuarter, currentYear);
        
        results.push({
          quarter: currentQuarter,
          year: currentYear,
          action: 'current_quarter',
          status: 'success',
          message: `✅ Generated Q${currentQuarter}/${currentYear} for room ${roomId}`,
          details: quarterResult
        });
        
        console.log(`✅ Auto-generated Q${currentQuarter}/${currentYear} for room ${roomId}`);
        
      } catch (error) {
        results.push({
          quarter: currentQuarter,
          year: currentYear,
          action: 'current_quarter',
          status: 'error',
          message: `Failed to generate Q${currentQuarter}/${currentYear}: ${error.message}`
        });
      }
    } else if (currentAnalysis.allPastMonths) {
      console.log(`⏰ Q${currentQuarter}/${currentYear} is in the past, skipping`);
    } else {
      console.log(`ℹ️ Q${currentQuarter}/${currentYear} already complete for room ${roomId}`);
    }

    // Strategy 2: Kiểm tra và tạo quý tiếp theo nếu cần
    const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
    const nextYear = currentQuarter === 4 ? currentYear + 1 : currentYear;
    
    const nextAnalysis = await scheduleService.getQuarterAnalysisForRoom(roomId, nextQuarter, nextYear, currentDate);
    
    if (nextAnalysis.needGenerate) {
      console.log(`📅 Auto-generating next quarter Q${nextQuarter}/${nextYear} for room ${roomId}`);
      
      try {
        // ✅ Sử dụng generateQuarterScheduleForSingleRoom cho quý tiếp theo
        const nextQuarterResult = await scheduleService.generateQuarterScheduleForSingleRoom(roomId, nextQuarter, nextYear);
        
        results.push({
          quarter: nextQuarter,
          year: nextYear,
          action: 'next_quarter', 
          status: 'success',
          message: `✅ Generated Q${nextQuarter}/${nextYear} for room ${roomId}`,
          details: nextQuarterResult
        });
        
        console.log(`✅ Auto-generated Q${nextQuarter}/${nextYear} for room ${roomId}`);
        
      } catch (error) {
        results.push({
          quarter: nextQuarter,
          year: nextYear,
          action: 'next_quarter',
          status: 'error', 
          message: `Failed to generate Q${nextQuarter}/${nextYear}: ${error.message}`
        });
      }
    } else {
      console.log(`ℹ️ Q${nextQuarter}/${nextYear} already complete for room ${roomId}`);
    }

  } catch (error) {
    results.push({
      quarter: currentQuarter,
      year: currentYear,
      action: 'error',
      status: 'failed',
      message: `Auto-generation failed: ${error.message}`,
      error: error.message
    });
    
    console.error(`❌ Auto-generation failed for room ${roomId}:`, error.message);
  }

  return results;
}

// Main function: Auto generate schedules for all active rooms
async function autoGenerateSchedulesForAllRooms() {
  console.log(`🚀 Starting auto-generation of schedules - ${getVietnamDate().toISOString()}`);
  
  try {
    // Kiểm tra cấu hình trước khi chạy
    const config = await AutoScheduleConfig.getConfig();
    
    if (!config.enabled) {
      throw new Error('Auto-generation is disabled globally');
    }

    // Get active rooms from cache
    const roomCache = await redisClient.get('rooms_cache');
    if (!roomCache) {
      throw new Error('Không tìm thấy bộ nhớ đệm phòng');
    }
    
    const rooms = JSON.parse(roomCache);
    const activeRooms = rooms.filter(room => room.isActive);
    
    console.log(`📋 Found ${activeRooms.length} active rooms to process`);
    
    const allResults = [];
    
    for (const room of activeRooms) {
      console.log(`🏥 Processing room: ${room.name} (${room._id})`);
      
      try {
        const roomResults = await autoGenerateSchedulesForRoom(room._id);
        allResults.push({
          roomId: room._id,
          roomName: room.name,
          success: true,
          results: roomResults
        });
      } catch (error) {
        console.error(`❌ Error processing room ${room.name}:`, error.message);
        allResults.push({
          roomId: room._id,
          roomName: room.name,
          success: false,
          error: error.message,
          results: []
        });
      }
    }
    
    // Summary
    const totalCreated = allResults.reduce((sum, room) => 
      sum + (room.results ? room.results.filter(r => r.status === 'created').length : 0), 0
    );
    
    const totalErrors = allResults.reduce((sum, room) => 
      sum + (room.results ? room.results.filter(r => r.status === 'error').length : 0) + (room.success ? 0 : 1), 0
    );
    
    const isSuccess = totalErrors === 0;
    
    // Cập nhật thống kê
    await AutoScheduleConfig.updateStats('auto_generation', isSuccess);
    
    console.log(`📊 Auto-generation summary: ${totalCreated} schedules created, ${totalErrors} errors`);
    
    return {
      timestamp: getVietnamDate(),
      totalRooms: activeRooms.length,
      totalCreated,
      totalErrors,
      success: isSuccess,
      details: allResults
    };
    
  } catch (error) {
    console.error('❌ Auto-generation failed:', error.message);
    
    // Cập nhật thống kê lỗi
    try {
      await AutoScheduleConfig.updateStats('auto_generation', false);
    } catch (statsError) {
      console.error('❌ Failed to update stats:', statsError.message);
    }
    
    throw error;
  }
}

// Function to check if it's end of month (for cron job)
function isEndOfMonth(date = null) {
  const vnDate = date || getVietnamDate();
  const tomorrow = new Date(vnDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // If tomorrow is a different month, then today is end of month
  return vnDate.getMonth() !== tomorrow.getMonth();
}

// Function to check if we should run auto-generation (end of month check)
async function shouldRunAutoGeneration(date = null) {
  try {
    // Kiểm tra cấu hình toàn cục
    const config = await AutoScheduleConfig.getConfig();
    
    if (!config.enabled) {
      console.log('🔴 Auto-generation is disabled');
      return false;
    }

    const vnDate = date || getVietnamDate();
    const day = vnDate.getDate();
    
    // Chạy từ ngày 28 trở đi (logic phù hợp với việc coi tháng hiện tại như past)
    const shouldRun = day >= 28;
    
    if (shouldRun) {
      console.log(`🟢 Auto-generation should run (day ${day}, after day 27 threshold)`);
    } else {
      console.log(`🔴 Auto-generation not needed (day ${day}, before day 27 threshold)`);
    }
    
    return shouldRun;
  } catch (error) {
    console.error('❌ Error checking auto-generation config:', error.message);
    return false; // Tắt nếu có lỗi để an toàn
  }
}

// Get auto-schedule configuration
async function getAutoScheduleConfig() {
  return await AutoScheduleConfig.getConfig();
}

// Update auto-schedule configuration
async function updateAutoScheduleConfig(enabled, modifiedBy = null) {
  return await AutoScheduleConfig.updateConfig(enabled, modifiedBy);
}

// Simulate auto-generation with smart quarter management
async function simulateAutoGeneration(simulateDate = new Date()) {
  const scheduleService = require('./schedule.service');
  
  console.log(`🧪 Starting smart simulation for date: ${simulateDate.toISOString()}`);
  
  // Get all active rooms from Redis cache
  const activeRooms = await getAllRooms();
  
  if (!activeRooms || activeRooms.length === 0) {
    return {
      canGenerate: false,
      reason: 'Không có phòng nào đang hoạt động',
      roomsChecked: 0,
      details: [],
      quarterAnalysis: {
        currentQuarter: null,
        nextQuarter: null
      }
    };
  }

  // Calculate current and next quarter
  const currentQuarterInfo = getQuarterInfo(simulateDate);
  const nextQuarterInfo = getNextQuarterInfo(currentQuarterInfo);
  
  console.log(`📅 Current Quarter: Q${currentQuarterInfo.quarter}/${currentQuarterInfo.year}`);
  console.log(`📅 Next Quarter: Q${nextQuarterInfo.quarter}/${nextQuarterInfo.year}`);

  const simulationResults = [];
  let totalCurrentNeedGenerate = 0;
  let totalNextNeedGenerate = 0;
  let totalErrors = 0;

  for (const room of activeRooms) {
    try {
      const roomResult = await analyzeRoomQuarterStatus(room, currentQuarterInfo, nextQuarterInfo, scheduleService, simulateDate);
      simulationResults.push(roomResult);
      
      if (roomResult.currentQuarter.needGenerate) totalCurrentNeedGenerate++;
      if (roomResult.nextQuarter.needGenerate) totalNextNeedGenerate++;
      
    } catch (error) {
      totalErrors++;
      simulationResults.push({
        roomId: room._id,
        roomName: room.name || `Phòng ${room._id}`,
        error: true,
        reason: `Lỗi kiểm tra: ${error.message}`,
        currentQuarter: { needGenerate: false, status: 'error' },
        nextQuarter: { needGenerate: false, status: 'error' }
      });
    }
  }

  // Determine overall actions needed
  const actionPlan = determineActionPlan(totalCurrentNeedGenerate, totalNextNeedGenerate, activeRooms.length, currentQuarterInfo, nextQuarterInfo);

  return {
    simulationDate: simulateDate,
    quarterAnalysis: {
      currentQuarter: currentQuarterInfo,
      nextQuarter: nextQuarterInfo,
      currentQuarterNeedsGeneration: totalCurrentNeedGenerate > 0,
      nextQuarterNeedsGeneration: totalNextNeedGenerate > 0
    },
    actionPlan,
    totalRooms: activeRooms.length,
    roomsNeedCurrentQuarter: totalCurrentNeedGenerate,
    roomsNeedNextQuarter: totalNextNeedGenerate,
    roomsWithErrors: totalErrors,
    canGenerate: totalCurrentNeedGenerate > 0 || totalNextNeedGenerate > 0,
    details: simulationResults,
    summary: generateSmartSummary(totalCurrentNeedGenerate, totalNextNeedGenerate, activeRooms.length, currentQuarterInfo, nextQuarterInfo)
  };
}

// Helper: Get next quarter info
function getNextQuarterInfo(currentQuarterInfo) {
  let nextQuarter = currentQuarterInfo.quarter + 1;
  let nextYear = currentQuarterInfo.year;
  
  if (nextQuarter > 4) {
    nextQuarter = 1;
    nextYear++;
  }
  
  return { quarter: nextQuarter, year: nextYear };
}

// Helper: Analyze room quarter status with detailed analysis
async function analyzeRoomQuarterStatus(room, currentQuarterInfo, nextQuarterInfo, scheduleService, simulateDate) {
  // Get detailed analysis for current quarter (from simulate date)
  const currentAnalysis = await scheduleService.getQuarterAnalysisForRoom(
    room._id, 
    currentQuarterInfo.quarter, 
    currentQuarterInfo.year,
    simulateDate
  );
  
  // Get detailed analysis for next quarter (from simulate date)
  const nextAnalysis = await scheduleService.getQuarterAnalysisForRoom(
    room._id, 
    nextQuarterInfo.quarter, 
    nextQuarterInfo.year,
    simulateDate
  );

  return {
    roomId: room._id,
    roomName: room.name || `Phòng ${room._id}`,
    currentQuarter: {
      ...currentAnalysis,
      needGenerate: !currentAnalysis.isComplete
    },
    nextQuarter: {
      ...nextAnalysis,
      needGenerate: !nextAnalysis.isComplete
    }
  };
}

// Helper: Determine what actions to take with detailed reasoning
function determineActionPlan(currentNeedCount, nextNeedCount, totalRooms, currentQ, nextQ) {
  if (currentNeedCount === 0 && nextNeedCount === 0) {
    return {
      action: 'no_action',
      message: `✅ Tất cả ${totalRooms} phòng đã có đủ lịch cho Q${currentQ.quarter}/${currentQ.year} và Q${nextQ.quarter}/${nextQ.year}`,
      priority: 'none',
      details: 'Không cần tạo lịch mới'
    };
  }
  
  if (currentNeedCount > 0 && nextNeedCount > 0) {
    return {
      action: 'generate_both',
      message: `🔄 Cần tạo/bổ sung lịch cho ${currentNeedCount} phòng ở Q${currentQ.quarter}/${currentQ.year} và ${nextNeedCount} phòng ở Q${nextQ.quarter}/${nextQ.year}`,
      priority: 'high',
      details: 'Sẽ tạo lịch cho cả hai quý'
    };
  }
  
  if (currentNeedCount > 0) {
    return {
      action: 'generate_current_only',
      message: `⚠️ Cần bổ sung lịch cho ${currentNeedCount} phòng ở Q${currentQ.quarter}/${currentQ.year} (quý hiện tại)`,
      priority: 'urgent',
      details: `Q${nextQ.quarter}/${nextQ.year} đã có đủ lịch`
    };
  }
  
  return {
    action: 'generate_next_only',
    message: `📅 Cần tạo lịch cho ${nextNeedCount} phòng ở Q${nextQ.quarter}/${nextQ.year} (quý tiếp theo)`,
    priority: 'medium',
    details: `Q${currentQ.quarter}/${currentQ.year} đã có đủ lịch`
  };
}

// Helper: Generate smart summary
function generateSmartSummary(currentNeed, nextNeed, totalRooms, currentQ, nextQ) {
  if (currentNeed === 0 && nextNeed === 0) {
    return `✅ Tất cả ${totalRooms} phòng đã có đủ lịch cho Q${currentQ.quarter}/${currentQ.year} và Q${nextQ.quarter}/${nextQ.year}`;
  }
  
  let parts = [];
  if (currentNeed > 0) {
    parts.push(`${currentNeed}/${totalRooms} phòng thiếu lịch Q${currentQ.quarter}/${currentQ.year}`);
  }
  if (nextNeed > 0) {
    parts.push(`${nextNeed}/${totalRooms} phòng thiếu lịch Q${nextQ.quarter}/${nextQ.year}`);
  }
  
  return `🔄 ${parts.join(', ')}`;
}

module.exports = {
  autoGenerateSchedulesForRoom,
  autoGenerateSchedulesForAllRooms,
  checkQuarterStatus,
  hasScheduleForMonth,
  isEndOfMonth,
  shouldRunAutoGeneration,
  getQuarterInfo,
  getQuarterDateRange,
  getAutoScheduleConfig,
  updateAutoScheduleConfig,
  simulateAutoGeneration
};
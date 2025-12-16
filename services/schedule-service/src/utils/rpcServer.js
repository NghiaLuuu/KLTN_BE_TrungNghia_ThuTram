// rpcServer.js
const amqp = require('amqplib');
const slotRepo = require('../repositories/slot.repository');
const scheduleRepo = require('../repositories/schedule.repository');
const scheduleService = require('../services/schedule.service');
const slotService = require('../services/slot.service');
async function startRpcServer() {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);
  const channel = await connection.createChannel();

  const queue = 'schedule_queue';

  // ❌ ĐÃ XÓA: Không xóa queue - nó được chia sẻ với event consumer
  // Việc này gây ra consumer mất kết nối khi RPC server khởi động
  
  await channel.assertQueue(queue, { durable: true });

  console.log(`✅ Schedule RPC server listening on queue: ${queue}`);

  channel.consume(queue, async (msg) => {
    if (!msg) return;

    let response;
    try {
      const content = msg.content.toString();
      const data = JSON.parse(content);
      
      // 🔍 Kiểm tra nếu đây là message SỰ KIỆN (có trường 'event')
      // Sự kiện nên được xử lý bởi event consumer, không phải RPC server
      if (data.event) {
        console.log(`📨 [RPC Server] Nhận sự kiện: ${data.event} - Đang requeue cho event consumer`);
        channel.nack(msg, false, true); // Requeue cho event consumer
        return;
      }
      
      // ✅ Đây là RPC call (có trường 'action')
      const { action, payload } = data;
      
      if (!action) {
        console.warn('⚠️ [RPC Server] Message không có trường action hoặc event, đang requeue');
        channel.nack(msg, false, true); // Requeue thay vì ack
        return;
      }

      switch (action) {
        case 'validateSlotsForService':
          try {
            if (!payload.serviceId || !Array.isArray(payload.slotIds)) {
              response = { valid: false, reason: 'Thiếu serviceId hoặc slotIds' };
              break;
            }

            response = await slotService.validateSlotsForService({
              serviceId: payload.serviceId,
              preferredDentistId: payload.preferredDentistId,
              slotIds: payload.slotIds
            });
          } catch (err) {
            console.error('Failed to validate slots for service:', err);
            response = { valid: false, reason: err.message };
          }
          break;


        // 👉 Event roomCreated - Tạo lịch cho room mới (không bắt buộc thành công)
        case 'roomCreated':
          try {
            console.log(
              `📩 Nhận sự kiện roomCreated cho room ${payload.roomId}, hasSubRooms: ${payload.hasSubRooms}`
            );

            // Tạo lịch cho room mới theo logic generateQuarterSchedule
            const result = await scheduleService.createSchedulesForNewRoom(payload);
            console.log(`✅ Kết quả tạo lịch:`, result);
            // Không cần response vì đây là event, không phải RPC request
          } catch (err) {
            console.warn('⚠️ Không thể tạo lịch cho room mới (room vẫn tồn tại):', err.message);
          }
          break;

        // 👉 Event subRoomAdded
        case 'subRoomAdded':
          try {
            console.log(
              `📩 Nhận sự kiện subRoomAdded cho room ${payload.roomId}, subRooms: ${payload.subRoomIds.join(', ')}`
            );

            // Sử dụng function mới để tạo lịch thông minh cho subrooms
            await scheduleService.createSchedulesForNewSubRooms(payload.roomId, payload.subRoomIds);
          } catch (err) {
            console.warn('⚠️ Không thể tạo lịch cho subRooms mới:', err.message);
          }
          break;

        // 👉 Event subRoomDeleted
        case 'subRoomDeleted':
          try {
            console.log(
              `🗑️ Nhận sự kiện subRoomDeleted: room ${payload.roomId}, subRoom ${payload.subRoomId}`
            );

            // Xóa tất cả schedules của subroom này
            await scheduleService.deleteSchedulesForSubRoom(payload.roomId, payload.subRoomId);
          } catch (err) {
            console.warn('⚠️ Không thể xóa lịch của subRoom:', err.message);
          }
          break;

        case 'getSlotById':
          try {
            const slot = await slotRepo.getSlotById(payload.slotId);
            response = slot || null;
          } catch (err) {
            console.error('Failed to getSlotById:', err);
            response = { error: err.message };
          }
          break;

        case 'confirmed':
          try {
            if (!Array.isArray(payload.slotIds)) {
              response = { error: 'slotIds phải là mảng' };
              break;
            }
            const updated = await slotRepo.updateSlotsStatus(payload.slotIds, 'confirmed');
            response = updated;
          } catch (err) {
            console.error('Failed to update slots to confirmed:', err);
            response = { error: err.message };
          }
          break;

        case 'releaseSlot':
          try {
            if (!Array.isArray(payload.slotIds)) {
              response = { error: 'slotIds phải là mảng' };
              break;
            }
            const released = await slotRepo.updateSlotsStatus(payload.slotIds, 'available');
            response = released;
          } catch (err) {
            console.error('Failed to release slots:', err);
            response = { error: err.message };
          }
          break;

        case 'reserved':
          try {
            if (!Array.isArray(payload.slotIds)) {
              response = { error: 'slotIds phải là mảng' };
              break;
            }
            const reserved = await slotRepo.updateSlotsStatus(payload.slotIds, 'reserved');
            response = reserved;
          } catch (err) {
            console.error('Failed to reserve slots:', err);
            response = { error: err.message };
          }
          break;

        case 'getScheduleById':
          try {
            const schedule = await scheduleRepo.getScheduleById(payload.scheduleId);
            response = schedule || null;
          } catch (err) {
            console.error('Failed to getScheduleById:', err);
            response = { error: err.message };
          }
          break;

        case 'appointmentId':
          try {
            if (!payload.slotId || !payload.appointmentId) {
              response = { error: 'slotId and appointmentId are required' };
              break;
            }
            const updatedSlot = await slotRepo.updateAppointmentId(payload.slotId, payload.appointmentId);
            response = updatedSlot;
          } catch (err) {
            console.error('Failed to update appointmentId:', err);
            response = { error: err.message };
          }
          break;

        case 'getUtilizationStatistics':
          try {
            const { startDate, endDate, roomIds, timeRange, shiftName } = payload;
            console.log('🔍 getUtilizationStatistics request:', { startDate, endDate, roomIds, timeRange, shiftName });
            
            // Parse ngày theo múi giờ Việt Nam
            const DateUtils = require('./dateUtils');
            const dateRange = DateUtils.parseDateRange(startDate, endDate);
            const startDateObj = dateRange.startDate;
            const endDateObj = dateRange.endDate
            
            // Xây dựng query
            const query = {
              isActive: true,
              startTime: { 
                $gte: startDateObj, 
                $lte: endDateObj 
              }
            };
            
            console.log('📅 Date filter:', {
              startDate: startDateObj.toISOString(),
              endDate: endDateObj.toISOString()
            });
            
            if (roomIds && Array.isArray(roomIds) && roomIds.length > 0) {
              const mongoose = require('mongoose');
              // Lọc các ObjectId hợp lệ
              const validRoomIds = roomIds.filter(id => mongoose.Types.ObjectId.isValid(id));
              if (validRoomIds.length > 0) {
                query.roomId = { $in: validRoomIds.map(id => new mongoose.Types.ObjectId(id)) };
              }
              console.log('🏠 Filtering by rooms:', validRoomIds);
            }
            
            if (shiftName) {
              query.shiftName = shiftName;
            }
            
            // Lấy slots - TỐI ƯU: chỉ chọn các trường cần thiết
            const Slot = require('../models/slot.model');
            console.log('📊 Querying slots with:', JSON.stringify(query, null, 2));
            const slotsStart = Date.now();
            
            // 🔍 DEBUG: Check query execution plan
            try {
              const explainResult = await Slot.find(query).explain('executionStats');
              console.log('🔍 Query Execution Plan:', {
                executionTimeMillis: explainResult.executionStats.executionTimeMillis,
                totalDocsExamined: explainResult.executionStats.totalDocsExamined,
                totalKeysExamined: explainResult.executionStats.totalKeysExamined,
                nReturned: explainResult.executionStats.nReturned,
                indexUsed: explainResult.executionStats.executionStages?.indexName || 
                          explainResult.queryPlanner?.winningPlan?.inputStage?.indexName || 
                          'NO INDEX'
              });
            } catch (explainError) {
              console.error('❌ Error getting query plan:', explainError.message);
            }
            
            // ✅ Tối ưu: Chỉ chọn các trường cần thiết
            // Thử index v2 trước, fallback sang v1 nếu không tìm thấy
            let slots;
            try {
              slots = await Slot.find(query)
                .hint('utilization_stats_query_v2')
                .select('roomId startTime shiftName appointmentId status')
                .lean()
                .maxTimeMS(30000);
            } catch (hintError) {
              // Fallback sang tên index cũ nếu v2 chưa tồn tại
              console.warn('⚠️ Index v2 not found, using v1:', hintError.message);
              slots = await Slot.find(query)
                .hint('utilization_stats_query')
                .select('roomId startTime shiftName appointmentId status')
                .lean()
                .maxTimeMS(30000);
            }
            
            const queryTime = Date.now() - slotsStart;
            console.log(`✅ Found ${slots.length} slots in ${queryTime}ms`);
            
            // ⚡ Early return if no slots found
            if (slots.length === 0) {
              console.log('⚠️ No slots found in date range');
              response = {
                success: true,
                data: {
                  summary: { 
                    totalSlots: 0, 
                    bookedSlots: 0, 
                    emptySlots: 0, 
                    utilizationRate: 0
                  },
                  byRoom: [],
                  byShift: {
                    'Ca Sáng': { total: 0, booked: 0, empty: 0, rate: 0 },
                    'Ca Chiều': { total: 0, booked: 0, empty: 0, rate: 0 },
                    'Ca Tối': { total: 0, booked: 0, empty: 0, rate: 0 }
                  },
                  timeline: []
                }
              };
              break;
            }
            
            // Log sample slots for debugging
            if (slots.length > 0) {
              console.log('📌 Sample slot:', {
                startTime: slots[0].startTime,
                roomId: slots[0].roomId,
                shiftName: slots[0].shiftName,
                appointmentId: slots[0].appointmentId,
                status: slots[0].status
              });
              
            // 🔍 DEBUG: Log ALL slot statuses to see the issue
            const statusCounts = {};
            const appointmentIdCount = { hasId: 0, noId: 0 };
            slots.forEach(s => {
              statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
              if (s.appointmentId) {
                appointmentIdCount.hasId++;
              } else {
                appointmentIdCount.noId++;
              }
            });
            console.log('🔍 Slot status distribution:', statusCounts);
            console.log('🔍 AppointmentId distribution:', appointmentIdCount);
            console.log('🔍 Booked/Locked slots (by status):', slots.filter(s => s.status === 'booked' || s.status === 'locked').length);
            console.log('🔍 Slots with appointmentId:', slots.filter(s => s.appointmentId).length);
            
            // 🔍 Show slots that have appointmentId but status is not booked/locked
            const mismatchedSlots = slots.filter(s => s.appointmentId && s.status !== 'booked' && s.status !== 'locked');
            if (mismatchedSlots.length > 0) {
              console.log('⚠️ FOUND MISMATCHED SLOTS:', mismatchedSlots.map(s => ({
                slotId: s._id.toString().substring(0, 8) + '...',
                startTime: s.startTime,
                status: s.status,
                appointmentId: s.appointmentId.toString().substring(0, 8) + '...'
              })));
            }
            }
            
            // Tính toán số liệu
            // Slot được coi là "đã đặt" nếu status là 'booked' hoặc 'locked' (có cuộc hẹn)
            const totalSlots = slots.length;
            const bookedSlots = slots.filter(s => s.status === 'booked' || s.status === 'locked').length;
            const emptySlots = totalSlots - bookedSlots;
            const utilizationRate = totalSlots > 0 ? parseFloat(((bookedSlots / totalSlots) * 100).toFixed(2)) : 0;
            
            console.log('📊 Summary metrics:', {
              totalSlots,
              bookedSlots,
              emptySlots,
              utilizationRate: utilizationRate + '%'
            });
            
            // Nhóm theo phòng
            const byRoomMap = {};
            slots.forEach(slot => {
              const roomId = slot.roomId.toString();
              if (!byRoomMap[roomId]) {
                byRoomMap[roomId] = { total: 0, booked: 0, empty: 0 };
              }
              byRoomMap[roomId].total++;
              if (slot.status === 'booked' || slot.status === 'locked') {
                byRoomMap[roomId].booked++;
              } else {
                byRoomMap[roomId].empty++;
              }
            });
            
            console.log('🏠 By Room breakdown:', Object.entries(byRoomMap).map(([roomId, stats]) => ({
              roomId: roomId.substring(0, 8) + '...',
              total: stats.total,
              booked: stats.booked,
              empty: stats.empty,
              rate: stats.total > 0 ? ((stats.booked / stats.total) * 100).toFixed(1) + '%' : '0%'
            })));
            
            const byRoom = Object.entries(byRoomMap).map(([roomId, stats]) => {
              const utilRate = stats.total > 0 ? parseFloat(((stats.booked / stats.total) * 100).toFixed(2)) : 0;
              
              // Calculate avgSlotsPerDay (include both start and end dates)
              // Use UTC to avoid DST issues
              const start = new Date(startDate);
              const end = new Date(endDate);
              const daysDiff = Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - 
                                          Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 
                                         (1000 * 60 * 60 * 24)) + 1;
              const avgSlots = stats.total / daysDiff;
              
              return {
                roomId,
                totalSlots: stats.total,
                bookedSlots: stats.booked,
                emptySlots: stats.empty,
                utilizationRate: utilRate,
                avgSlotsPerDay: parseFloat(avgSlots.toFixed(2))
              };
            });
            
            // Nhóm theo ca
            const byShiftMap = {
              'Ca Sáng': { total: 0, booked: 0, empty: 0 },
              'Ca Chiều': { total: 0, booked: 0, empty: 0 },
              'Ca Tối': { total: 0, booked: 0, empty: 0 }
            };
            
            slots.forEach(slot => {
              if (byShiftMap[slot.shiftName]) {
                byShiftMap[slot.shiftName].total++;
                if (slot.status === 'booked' || slot.status === 'locked') {
                  byShiftMap[slot.shiftName].booked++;
                } else {
                  byShiftMap[slot.shiftName].empty++;
                }
              }
            });
            
            console.log('⏰ By Shift breakdown:', Object.entries(byShiftMap).map(([shift, stats]) => ({
              shift,
              total: stats.total,
              booked: stats.booked,
              empty: stats.empty,
              rate: stats.total > 0 ? ((stats.booked / stats.total) * 100).toFixed(1) + '%' : '0%'
            })));
            
            // Chuyển đổi byShift sang dạng object cho FE tương thích
            const byShift = {};
            Object.entries(byShiftMap).forEach(([shift, stats]) => {
              byShift[shift] = {
                total: stats.total,
                booked: stats.booked,
                empty: stats.empty,
                rate: stats.total > 0 ? parseFloat(((stats.booked / stats.total) * 100).toFixed(2)) : 0
              };
            });
            
            // Generate timeline based on timeRange
            const timeline = [];
            const byDateMap = {};
            
            slots.forEach(slot => {
              let dateKey;
              const slotDate = new Date(slot.startTime);
              
              if (timeRange === 'day') {
                dateKey = slotDate.toISOString().split('T')[0]; // YYYY-MM-DD
              } else if (timeRange === 'month') {
                dateKey = `${slotDate.getFullYear()}-${String(slotDate.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
              } else if (timeRange === 'quarter') {
                const quarter = Math.floor(slotDate.getMonth() / 3) + 1;
                dateKey = `${slotDate.getFullYear()}-Q${quarter}`; // YYYY-Q1
              } else if (timeRange === 'year') {
                dateKey = String(slotDate.getFullYear()); // YYYY
              } else {
                // Mặc định sang định dạng ngày nếu timeRange không hợp lệ
                dateKey = slotDate.toISOString().split('T')[0];
              }
              
              if (!byDateMap[dateKey]) {
                byDateMap[dateKey] = { total: 0, booked: 0 };
              }
              byDateMap[dateKey].total++;
              if (slot.status === 'booked' || slot.status === 'locked') {
                byDateMap[dateKey].booked++;
              }
            });
            
            // Chuyển đổi sang mảng và sắp xếp theo ngày
            Object.entries(byDateMap).forEach(([date, stats]) => {
              timeline.push({
                date,
                totalSlots: stats.total,
                bookedSlots: stats.booked,
                utilizationRate: stats.total > 0 ? parseFloat(((stats.booked / stats.total) * 100).toFixed(2)) : 0
              });
            });
            timeline.sort((a, b) => a.date.localeCompare(b.date));
            
            console.log('📅 Timeline breakdown:', timeline.map(t => ({
              date: t.date,
              total: t.totalSlots,
              booked: t.bookedSlots,
              rate: t.utilizationRate + '%'
            })));
            
            response = {
              success: true,
              data: {
                summary: { 
                  totalSlots, 
                  bookedSlots, 
                  emptySlots, 
                  utilizationRate
                },
                byRoom,
                byShift,
                timeline
              }
            };
          } catch (err) {
            console.error('Failed to get utilization statistics:', err);
            response = { 
              success: false, 
              error: err.message 
            };
          }
          break;

        default:
          response = { error: `Unknown action: ${action}` };
      }

    } catch (err) {
      console.error('RPC server error:', err);
      response = { error: err.message };
    }

    // Gửi trả an toàn
    try {
      if (msg.properties.replyTo) {
        const payloadToSend = response ? JSON.stringify(response) : JSON.stringify({ error: 'No response' });
        channel.sendToQueue(
          msg.properties.replyTo,
          Buffer.from(payloadToSend),
          { correlationId: msg.properties.correlationId }
        );
      } else {
        console.warn('RPC message has no replyTo, cannot send response');
      }
    } catch (err) {
      console.error('Failed to send RPC response:', err);
    }

    channel.ack(msg);
  });
}

module.exports = startRpcServer;

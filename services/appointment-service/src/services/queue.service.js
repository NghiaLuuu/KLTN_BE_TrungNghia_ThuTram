const Appointment = require('../models/appointment.model');
const { getIO } = require('../utils/socket');
const serviceClient = require('../utils/serviceClient');
const redisClient = require('../utils/redis.client');

class QueueService {
  /**
   * Get queue for all rooms or specific room
   * ✅ Group by room AND subroom (if exists)
   * ✅ Don't filter by time - show all appointments today regardless of end time
   * @param {String} roomId - Optional room ID filter
   * @returns {Array} Queue data grouped by room/subroom
   */
  async getQueue(roomId = null) {
    try {
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      const query = {
        // ✅ Chỉ lấy appointment chưa hoàn thành (bao gồm cả khám lố giờ)
        status: { $in: ['in-progress', 'checked-in', 'confirmed'] },
        appointmentDate: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      };

      if (roomId) {
        query.roomId = roomId;
      }

      const appointments = await Appointment.find(query)
        .sort({ roomId: 1, subroomId: 1, startTime: 1 })
        .lean();

      console.log(`📊 [QueueService] Found ${appointments.length} appointments for queue`);
      console.log(`🔍 [QueueService] Query:`, JSON.stringify(query, null, 2));
      
      // Debug: Log first few appointments
      if (appointments.length > 0) {
        console.log(`📝 [QueueService] Sample appointments:`, 
          appointments.slice(0, 3).map(apt => ({
            code: apt.appointmentCode,
            startTime: apt.startTime,
            endTime: apt.endTime,
            status: apt.status,
            roomId: apt.roomId
          }))
        );
      }

      // 🔥 Load rooms from Redis cache (populated by room-service)
      const roomDataMap = new Map();
      const subroomDataMap = new Map();
      
      try {
        const roomsCacheStr = await redisClient.get('rooms_cache');
        
        if (roomsCacheStr) {
          const roomsCache = JSON.parse(roomsCacheStr);
          
          // Build maps for quick lookup
          roomsCache.forEach(room => {
            const roomIdStr = room._id.toString();
            roomDataMap.set(roomIdStr, room);
            
            // Also map subrooms
            if (room.subRooms && Array.isArray(room.subRooms)) {
              room.subRooms.forEach(subroom => {
                const subroomIdStr = subroom._id.toString();
                subroomDataMap.set(subroomIdStr, subroom);
              });
            }
          });
          
          console.log(`🏠 [QueueService] Loaded ${roomDataMap.size} rooms, ${subroomDataMap.size} subrooms from Redis cache`);
        } else {
          console.warn('⚠️ [QueueService] rooms_cache not found in Redis');
        }
      } catch (cacheError) {
        console.error('❌ [QueueService] Error loading rooms from cache:', cacheError.message);
      }

      // ✅ Group by room + subroom (nếu có subroom thì tách riêng)
      const queueByRoomSubroom = {};
      
      appointments.forEach(apt => {
        // Tạo key unique: roomId + subroomId (nếu có)
        const roomIdStr = apt.roomId.toString();
        const subroomIdStr = apt.subroomId ? apt.subroomId.toString() : null;
        
        const roomKey = roomIdStr;
        const subroomKey = subroomIdStr || 'main';
        const uniqueKey = `${roomKey}_${subroomKey}`;
        
        // ✅ Get room/subroom names from fetched data
        const roomData = roomDataMap.get(roomIdStr);
        const subroomData = subroomIdStr ? subroomDataMap.get(subroomIdStr) : null;
        
        const roomName = roomData?.name || apt.roomName || 'Phòng khám';
        const subroomName = subroomData?.name || apt.subroomName || null;
        
        if (!queueByRoomSubroom[uniqueKey]) {
          queueByRoomSubroom[uniqueKey] = {
            roomId: roomIdStr,
            roomName: roomName,
            subroomId: subroomIdStr,
            subroomName: subroomName,
            displayName: subroomName 
              ? `${roomName} - ${subroomName}` 
              : roomName,
            currentPatient: null,
            nextPatient: null,
            waitingList: [],
            totalWaiting: 0,
            allAppointments: []
          };
        }

        queueByRoomSubroom[uniqueKey].allAppointments.push(apt);
      });

      // Process each room/subroom
      Object.values(queueByRoomSubroom).forEach(room => {
        const appointmentsInRoom = room.allAppointments.sort((a, b) => {
          if (a.startTime === b.startTime) return 0;
          return a.startTime > b.startTime ? 1 : -1;
        });

        // ✅ Current patient: status = 'in-progress' (đang khám)
        const current = appointmentsInRoom.find(apt => apt.status === 'in-progress');
        
        if (current) {
          room.currentPatient = this._formatAppointment(current, roomDataMap, subroomDataMap);
        }

        // 🎯 Logic: Hiển thị tất cả phiếu chờ theo thứ tự thời gian
        // - Phiếu checked-in: Đã đến, ưu tiên hiển thị trước
        // - Phiếu confirmed: Chưa check-in, hiển thị sau
        // - Tất cả đều hiển thị để lễ tân biết có bao nhiêu người đang chờ
        
        const checkedInQueue = appointmentsInRoom.filter(apt => apt.status === 'checked-in');
        const confirmedQueue = appointmentsInRoom.filter(apt => apt.status === 'confirmed');

        // ✅ Next patient: Ưu tiên checked-in, sau đó confirmed
        if (checkedInQueue.length > 0) {
          room.nextPatient = this._formatAppointment(checkedInQueue[0], roomDataMap, subroomDataMap);
          room.waitingList = checkedInQueue.slice(1).map(apt => this._formatAppointment(apt, roomDataMap, subroomDataMap));
          room.waitingList.push(...confirmedQueue.map(apt => this._formatAppointment(apt, roomDataMap, subroomDataMap)));
        } else if (confirmedQueue.length > 0) {
          room.nextPatient = this._formatAppointment(confirmedQueue[0], roomDataMap, subroomDataMap);
          room.waitingList = confirmedQueue.slice(1).map(apt => this._formatAppointment(apt, roomDataMap, subroomDataMap));
        }

        room.totalWaiting = (room.nextPatient ? 1 : 0) + room.waitingList.length;
        delete room.allAppointments;
      });

      const result = Object.values(queueByRoomSubroom);
      console.log(`✅ [QueueService] Returning ${result.length} rooms/subrooms`);
      
      return result;
    } catch (error) {
      console.error('❌ [QueueService] getQueue error:', error);
      throw error;
    }
  }

  /**
   * ✅ Sau khi complete, chỉ cần emit event để FE reload queue
   * Không cần activate next patient vì tất cả đã có status 'in-progress' khi check-in
   * @param {String} completedAppointmentId - ID of completed appointment
   */
  async activateNextPatient(completedAppointmentId) {
    try {
      const completedApt = await Appointment.findById(completedAppointmentId);
      
      if (!completedApt) {
        console.warn('⚠️ [QueueService] Completed appointment not found');
        return null;
      }

      const roomId = completedApt.roomId;

      console.log(`🔄 [QueueService] Appointment completed in room ${completedApt.roomName || roomId}`);
      console.log(`ℹ️ [QueueService] Next patient in queue will automatically become current patient`);

      // Emit socket event for realtime update - FE sẽ reload và hiển thị patient tiếp theo
      this._emitQueueUpdate(roomId);

      return null; // Không cần return next patient vì logic đã tự động
    } catch (error) {
      console.error('❌ [QueueService] activateNextPatient error:', error);
      throw error;
    }
  }

  /**
   * ✅ KHÔNG CẦN AUTO-START NỮA
   * Tất cả appointment đã có status 'in-progress' ngay khi check-in
   * Chỉ cần hiển thị theo thứ tự trong queue
   */

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    try {
      const today = new Date();
      const stats = await Appointment.aggregate([
        {
          $match: {
            appointmentDate: {
              $gte: new Date(today.setHours(0, 0, 0, 0)),
              $lte: new Date(today.setHours(23, 59, 59, 999))
            }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);

      const result = {
        total: 0,
        confirmed: 0,
        checkedIn: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0
      };

      stats.forEach(stat => {
        const status = stat._id;
        const count = stat.count;
        result.total += count;

        switch (status) {
          case 'confirmed':
            result.confirmed = count;
            break;
          case 'checked-in':
            result.checkedIn = count;
            break;
          case 'in-progress':
            result.inProgress = count;
            break;
          case 'completed':
            result.completed = count;
            break;
          case 'cancelled':
            result.cancelled = count;
            break;
          case 'no-show':
            result.noShow = count;
            break;
        }
      });

      return result;
    } catch (error) {
      console.error('❌ [QueueService] getQueueStats error:', error);
      throw error;
    }
  }

  /**
   * Format appointment for queue response
   * @private
   */
  _formatAppointment(apt, roomDataMap = new Map(), subroomDataMap = new Map()) {
    // ✅ Get room/subroom names from fetched data
    const roomIdStr = apt.roomId.toString();
    const subroomIdStr = apt.subroomId ? apt.subroomId.toString() : null;
    
    const roomData = roomDataMap.get(roomIdStr);
    const subroomData = subroomIdStr ? subroomDataMap.get(subroomIdStr) : null;
    
    const roomName = roomData?.name || apt.roomName || 'Phòng khám';
    const subroomName = subroomData?.name || apt.subroomName || null;
    
    return {
      _id: apt._id,
      appointmentCode: apt.appointmentCode,
      patientInfo: apt.patientInfo,
      serviceName: apt.serviceName,
      serviceAddOnName: apt.serviceAddOnName,
      dentistName: apt.dentistName,
      nurseId: apt.nurseId || null,
      nurseName: apt.nurseName || null,
      roomId: roomIdStr,
      roomName: roomName,
      subroomId: subroomIdStr,
      subroomName: subroomName,
      startTime: apt.startTime,
      endTime: apt.endTime,
      appointmentDate: apt.appointmentDate,
      status: apt.status,
      checkedInAt: apt.checkedInAt,
      startedAt: apt.startedAt || null,
      recordId: apt.examRecordId || null,
      notes: apt.notes || null,
      estimatedWaitTime: this._calculateWaitTime(apt)
    };
  }

  /**
   * Calculate estimated wait time
   * @private
   */
  _calculateWaitTime(apt) {
    // Simple estimation based on position and service duration
    // Can be enhanced with ML or historical data
    return apt.serviceDuration || 30; // Default 30 minutes
  }

  /**
   * Emit socket event for queue update
   * @private
   */
  _emitQueueUpdate(roomId) {
    try {
      const io = getIO();
      if (io) {
        io.emit('queue_updated', {
          roomId: roomId.toString(),
          timestamp: new Date()
        });
        console.log(`📡 [QueueService] Emitted queue_updated for room ${roomId}`);
      }
    } catch (error) {
      console.warn('⚠️ [QueueService] Socket emit failed:', error.message);
    }
  }
}

module.exports = new QueueService();

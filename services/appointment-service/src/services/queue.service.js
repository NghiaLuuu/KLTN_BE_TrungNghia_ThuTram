const Appointment = require('../models/appointment.model');
const { getIO } = require('../utils/socket');
const serviceClient = require('../utils/serviceClient');
const redisClient = require('../utils/redis.client');
const { getStartOfDayVN, getEndOfDayVN, getNowVN } = require('../utils/timezone.helper');

class QueueService {
  /**
   * Lấy hàng đợi cho tất cả phòng hoặc một phòng cụ thể
   * ✅ Nhóm theo phòng VÀ phòng con (nếu có)
   * ✅ Không lọc theo thời gian - hiển thị tất cả lịch hẹn hôm nay bất kể giờ kết thúc
   * @param {String} roomId - ID phòng để lọc (tùy chọn)
   * @returns {Array} Dữ liệu hàng đợi nhóm theo phòng/phòng con
   */
  async getQueue(roomId = null) {
    try {
      // ✅ FIX: Sử dụng timezone helper để xử lý múi giờ VN nhất quán
      const startOfDayUTC = getStartOfDayVN();
      const endOfDayUTC = getEndOfDayVN();

      console.log(`📅 [QueueService] Khoảng query (UTC): ${startOfDayUTC.toISOString()} - ${endOfDayUTC.toISOString()}`);

      const query = {
        // ✅ Chỉ lấy appointment chưa hoàn thành (bao gồm cả khám lố giờ)
        status: { $in: ['in-progress', 'checked-in', 'confirmed'] },
        appointmentDate: {
          $gte: startOfDayUTC,
          $lte: endOfDayUTC
        }
      };

      if (roomId) {
        query.roomId = roomId;
      }

      const appointments = await Appointment.find(query)
        .sort({ roomId: 1, subroomId: 1, startTime: 1 })
        .lean();

      // console.log(`📊 [QueueService] Tìm thấy ${appointments.length} lịch hẹn cho hàng đợi`);
      // console.log(`🔍 [QueueService] Query:`, JSON.stringify(query, null, 2));
      
      // Debug: Log vài lịch hẹn đầu tiên
      if (appointments.length > 0) {
        console.log(`📝 [QueueService] Mẫu lịch hẹn:`, 
          appointments.slice(0, 3).map(apt => ({
            code: apt.appointmentCode,
            startTime: apt.startTime,
            endTime: apt.endTime,
            status: apt.status,
            roomId: apt.roomId
          }))
        );
      }

      // 🔥 Tải phòng từ room-service API (không còn cache Redis)
      const roomDataMap = new Map();
      const subroomDataMap = new Map();
      
      try {
        const { sendRpcRequest } = require('../utils/rabbitmq.client');
        const roomsResult = await sendRpcRequest('room_queue', {
          action: 'getAllRooms'
        }, 5000);
        
        if (roomsResult && roomsResult.success && Array.isArray(roomsResult.data)) {
          const roomsCache = roomsResult.data;
          
          // Xây dựng maps để tra cứu nhanh
          roomsCache.forEach(room => {
            const roomIdStr = room._id.toString();
            roomDataMap.set(roomIdStr, room);
            
            // Cũng map phòng con
            if (room.subRooms && Array.isArray(room.subRooms)) {
              room.subRooms.forEach(subroom => {
                const subroomIdStr = subroom._id.toString();
                subroomDataMap.set(subroomIdStr, subroom);
              });
            }
          });
          
          console.log(`🏠 [QueueService] Đã tải ${roomDataMap.size} phòng, ${subroomDataMap.size} phòng con từ room-service API`);
        } else {
          console.warn('⚠️ [QueueService] Không thể lấy phòng từ room-service API');
        }
      } catch (apiError) {
        console.error('❌ [QueueService] Lỗi tải phòng từ API:', apiError.message);
      }

      // ✅ Nhóm theo phòng + phòng con (nếu có phòng con thì tách riêng)
      const queueByRoomSubroom = {};
      
      appointments.forEach(apt => {
        // Tạo key unique: roomId + subroomId (nếu có)
        const roomIdStr = apt.roomId.toString();
        const subroomIdStr = apt.subroomId ? apt.subroomId.toString() : null;
        
        const roomKey = roomIdStr;
        const subroomKey = subroomIdStr || 'main';
        const uniqueKey = `${roomKey}_${subroomKey}`;
        
        // ✅ Lấy tên phòng/phòng con từ dữ liệu đã tải
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

      // Xử lý từng phòng/phòng con
      Object.values(queueByRoomSubroom).forEach(room => {
        const appointmentsInRoom = room.allAppointments.sort((a, b) => {
          if (a.startTime === b.startTime) return 0;
          return a.startTime > b.startTime ? 1 : -1;
        });

        // ✅ Bệnh nhân đang khám: status = 'in-progress'
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

        // ✅ Bệnh nhân tiếp theo: Ưu tiên checked-in, sau đó confirmed
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
      console.log(`✅ [QueueService] Trả về ${result.length} phòng/phòng con`);
      
      return result;
    } catch (error) {
      console.error('❌ [QueueService] Lỗi getQueue:', error);
      throw error;
    }
  }

  /**
   * ✅ Sau khi hoàn thành, chỉ cần emit event để FE reload queue
   * Không cần activate bệnh nhân tiếp theo vì tất cả đã có status 'in-progress' khi check-in
   * @param {String} completedAppointmentId - ID của lịch hẹn đã hoàn thành
   */
  async activateNextPatient(completedAppointmentId) {
    try {
      const completedApt = await Appointment.findById(completedAppointmentId);
      
      if (!completedApt) {
        console.warn('⚠️ [QueueService] Không tìm thấy lịch hẹn đã hoàn thành');
        return null;
      }

      const roomId = completedApt.roomId;

      console.log(`🔄 [QueueService] Lịch hẹn hoàn thành trong phòng ${completedApt.roomName || roomId}`);
      console.log(`ℹ️ [QueueService] Bệnh nhân tiếp theo trong hàng đợi sẽ tự động trở thành bệnh nhân đang khám`);

      // Emit socket event để cập nhật realtime - FE sẽ reload và hiển thị bệnh nhân tiếp theo
      this._emitQueueUpdate(roomId);

      return null; // Không cần return next patient vì logic đã tự động
    } catch (error) {
      console.error('❌ [QueueService] Lỗi activateNextPatient:', error);
      throw error;
    }
  }

  /**
   * ✅ KHÔNG CẦN AUTO-START NỮA
   * Tất cả appointment đã có status 'in-progress' ngay khi check-in
   * Chỉ cần hiển thị theo thứ tự trong queue
   */

  /**
   * Lấy thống kê hàng đợi
   */
  async getQueueStats() {
    try {
      // ✅ FIX: Sử dụng timezone helper để xử lý múi giờ VN nhất quán
      const startOfDayUTC = getStartOfDayVN();
      const endOfDayUTC = getEndOfDayVN();

      const stats = await Appointment.aggregate([
        {
          $match: {
            appointmentDate: {
              $gte: startOfDayUTC,
              $lte: endOfDayUTC
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
      console.error('❌ [QueueService] Lỗi getQueueStats:', error);
      throw error;
    }
  }

  /**
   * Format dữ liệu lịch hẹn cho response hàng đợi
   * @private
   */
  _formatAppointment(apt, roomDataMap = new Map(), subroomDataMap = new Map()) {
    // ✅ Lấy tên phòng/phòng con từ dữ liệu đã tải
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
   * Tính toán thời gian chờ ước tính
   * @private
   */
  _calculateWaitTime(apt) {
    // Ước tính đơn giản dựa trên vị trí và thời lượng dịch vụ
    // Có thể cải tiến với ML hoặc dữ liệu lịch sử
    return apt.serviceDuration || 30; // Mặc định 30 phút
  }

  /**
   * Phát sự kiện socket khi hàng đợi cập nhật
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
        console.log(`📡 [QueueService] Đã phát sự kiện queue_updated cho phòng ${roomId}`);
      }
    } catch (error) {
      console.warn('⚠️ [QueueService] Phát sự kiện socket thất bại:', error.message);
    }
  }
}

module.exports = new QueueService();

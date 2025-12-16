const Slot = require('../models/slot.model');
const rabbitmqClient = require('./rabbitmq.client');

/**
 * Xử lý sự kiện appointment.created
 * Cập nhật trạng thái slot thành đã đặt
 */
async function handleAppointmentCreated(data) {
  try {
    const {
      appointmentId,
      slotIds,
      patientId,
      patientName,
      serviceId,
      doctorId,
      appointmentDate,
      startTime,
      endTime
    } = data;

    console.log('[Schedule] Processing appointment.created event:', {
      appointmentId,
      slotCount: slotIds?.length
    });

    // Xác thực dữ liệu
    if (!appointmentId || !slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
      console.error('[Schedule] Dữ liệu cuộc hẹn không hợp lệ - thiếu slotIds');
      return;
    }

    // Cập nhật tất cả slots thành trạng thái booked
    const result = await Slot.updateMany(
      { _id: { $in: slotIds } },
      {
        $set: {
          status: 'booked',
          appointmentId: appointmentId,
          patientId: patientId,
          patientName: patientName,
          bookedAt: new Date()
        }
      }
    );

    console.log('[Schedule] Updated slots:', {
      appointmentId,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      slotIds
    });

    // Nếu không có slot nào được cập nhật, ghi cảnh báo
    if (result.matchedCount === 0) {
      console.warn('[Schedule] Không tìm thấy slot cho cuộc hẹn:', appointmentId);
    } else if (result.modifiedCount === 0) {
      console.warn('[Schedule] Tìm thấy slot nhưng không sửa đổi (đã đặt rồi?):', appointmentId);
    } else {
      console.log(`[Schedule] Đã đánh dấu ${result.modifiedCount} slots là đã đặt cho cuộc hẹn ${appointmentId}`);
    }
    
    // 🔥 CRITICAL: Invalidate Redis cache for affected rooms
    try {
      const updatedSlots = await Slot.find({ _id: { $in: slotIds } }).select('roomId').lean();
      const affectedRoomIds = [...new Set(updatedSlots.map(s => s.roomId.toString()))];
      
      const redisClient = require('./redis.client');
      let totalKeysDeleted = 0;
      
      for (const roomId of affectedRoomIds) {
        const pattern = `room_calendar:${roomId}:*`;
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(keys);
          totalKeysDeleted += keys.length;
        }
      }
      
      console.log(`[Schedule] Invalidated ${totalKeysDeleted} Redis cache keys for ${affectedRoomIds.length} rooms`);
    } catch (cacheError) {
      console.error('[Schedule] Failed to invalidate Redis cache:', cacheError.message);
    }

  } catch (error) {
    console.error('[Schedule] Error handling appointment.created event:', error);
    throw error;
  }
}

/**
 * Xử lý sự kiện appointment.cancelled
 * Giải phóng slots về trạng thái sẵn sàng
 */
async function handleAppointmentCancelled(data) {
  try {
    const { appointmentId, slotIds, reason } = data;

    console.log('[Schedule] Processing appointment.cancelled event:', {
      appointmentId,
      slotCount: slotIds?.length,
      reason
    });

    if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
      console.error('[Schedule] Dữ liệu hủy không hợp lệ - thiếu slotIds');
      return;
    }

    // Giải phóng slots về trạng thái sẵn sàng
    const result = await Slot.updateMany(
      { _id: { $in: slotIds } },
      {
        $set: {
          status: 'available',
          appointmentId: null,
          patientId: null,
          patientName: null,
          bookedAt: null
        }
      }
    );

    console.log('[Schedule] Released slots:', {
      appointmentId,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });

    if (result.modifiedCount > 0) {
      console.log(`[Schedule] Successfully released ${result.modifiedCount} slots from cancelled appointment ${appointmentId}`);
    }
    
    // 🔥 CRITICAL: Invalidate Redis cache for affected rooms
    try {
      const updatedSlots = await Slot.find({ _id: { $in: slotIds } }).select('roomId').lean();
      const affectedRoomIds = [...new Set(updatedSlots.map(s => s.roomId.toString()))];
      
      const redisClient = require('./redis.client');
      let totalKeysDeleted = 0;
      
      for (const roomId of affectedRoomIds) {
        const pattern = `room_calendar:${roomId}:*`;
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
          await redisClient.del(keys);
          totalKeysDeleted += keys.length;
        }
      }
      
      console.log(`[Schedule] Invalidated ${totalKeysDeleted} Redis cache keys for ${affectedRoomIds.length} rooms`);
    } catch (cacheError) {
      console.error('[Schedule] Failed to invalidate Redis cache:', cacheError.message);
    }

  } catch (error) {
    console.error('[Schedule] Error handling appointment.cancelled event:', error);
    throw error;
  }
}

/**
 * Cài đặt bộ lắng nghe sự kiện cho schedule service
 */
async function setupEventListeners() {
  try {
    // Kết nối tới RabbitMQ
    await rabbitmqClient.connect();

    // Lắng nghe sự kiện appointment.created
    await rabbitmqClient.consumeQueue('appointment.created', handleAppointmentCreated);

    // Lắng nghe sự kiện appointment.cancelled
    await rabbitmqClient.consumeQueue('appointment.cancelled', handleAppointmentCancelled);

    // ✅ Log đơn giản - sẽ hiển thị trong index.js

  } catch (error) {
    console.error('[Schedule] Lỗi khi cài đặt bộ lắng nghe sự kiện:', error);
    
    // Thử lại sau 5 giây
    setTimeout(() => {
      console.log('[Schedule] Đang thử lại cài đặt bộ lắng nghe sự kiện...');
      setupEventListeners();
    }, 5000);
  }
}

module.exports = {
  setupEventListeners,
  handleAppointmentCreated,
  handleAppointmentCancelled
};

const rabbitmqClient = require('../utils/rabbitmq.client');
const slotRepository = require('../repositories/slot.repository');

/**
 * Bắt đầu tiêu thụ messages từ schedule_queue
 */
async function startConsumer() {
  try {
    await rabbitmqClient.consumeFromQueue('schedule_queue', async (message) => {
      console.log('📥 [Schedule Consumer] Received message:', {
        hasEvent: !!message.event,
        hasAction: !!message.action,
        event: message.event,
        action: message.action,
        timestamp: new Date().toISOString()
      });

      // ⚠️ QUAN TRỌNG: Trả về false để requeue các RPC requests cho rpcServer xử lý
      if (message.action) {
        console.log('⏭️ [Schedule Consumer] Đang requeue RPC request cho rpcServer');
        return false; // NACK và requeue cho rpcServer
      }

      // Chỉ xử lý các EVENT messages (không phải RPC requests)
      if (message.event === 'slot.update_status') {
        const { slotIds, status, reservationId, appointmentId } = message.data;

        console.log('🔄 [Schedule Consumer] Processing slot.update_status:', {
          slotIds,
          count: slotIds?.length || 0,
          status,
          reservationId,
          appointmentId
        });

        if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
          console.warn('⚠️ [Schedule Consumer] No slotIds provided, skipping...');
          return;
        }

        if (!status) {
          console.warn('⚠️ [Schedule Consumer] No status provided, skipping...');
          return;
        }

        try {
          let updatedCount = 0;

          // Cập nhật từng slot
          for (const slotId of slotIds) {
            const updateData = {
              status: status, // 'booked'
              lockedBy: null, // Xóa lock
              lockedAt: null
            };

            // Thêm appointmentId nếu được cung cấp
            if (appointmentId) {
              updateData.appointmentId = appointmentId;
            }

            console.log(`🔄 [Schedule Consumer] Updating slot ${slotId}:`, updateData);

            const updatedSlot = await slotRepository.updateSlot(slotId, updateData);

            if (updatedSlot) {
              updatedCount++;
              console.log(`✅ [Schedule Consumer] Slot ${slotId} updated to ${status}`);
            } else {
              console.warn(`⚠️ [Schedule Consumer] Slot ${slotId} not found`);
            }
          }

          console.log('✅ [Schedule Consumer] Slots updated successfully:', {
            total: slotIds.length,
            updated: updatedCount,
            status,
            appointmentId: appointmentId || 'none'
          });

        } catch (error) {
          console.error('❌ [Schedule Consumer] Error updating slots:', {
            error: error.message,
            slotIds,
            status
          });
          throw error; // Sẽ kích hoạt RabbitMQ retry
        }
      } else if (message.event === 'appointment.created') {
        // Xử lý sự kiện tạo cuộc hẹn - cập nhật slots với appointmentId
        const { appointmentId, slotIds, reservationId, status } = message.data;



        if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
          console.warn('⚠️ [Schedule Consumer] No slotIds provided, skipping...');
          return;
        }

        if (!appointmentId) {
          console.warn('⚠️ [Schedule Consumer] No appointmentId provided, skipping...');
          return;
        }

        try {
          let updatedCount = 0;

          // Cập nhật từng slot với appointmentId
          for (const slotId of slotIds) {
            const updateData = {
              status: status || 'booked',
              appointmentId: appointmentId,
              lockedBy: null, // Xóa khóa
              lockedAt: null
            };

            const updatedSlot = await slotRepository.updateSlot(slotId, updateData);

            if (updatedSlot) {
              updatedCount++;
            } else {
              console.warn(`⚠️ Slot ${slotId} not found`);
            }
          }

          console.log(`✅ Đã liên kết ${updatedCount} slots với cuộc hẹn ${appointmentId}`);
          
          // 🔥 Xóa cache Redis cho lịch phòng
          const firstSlot = await slotRepository.getSlotById(slotIds[0]);
          if (firstSlot?.roomId) {
            try {
              const cachePattern = `room_calendar:${firstSlot.roomId}:*`;
              const keys = await redisClient.keys(cachePattern);
              if (keys.length > 0) {
                await Promise.all(keys.map(key => redisClient.del(key)));
                console.log(`🗑️ Đã xóa ${keys.length} khóa cache lịch`);
              }
            } catch (cacheError) {
              console.error('⚠️ Xóa cache thất bại:', cacheError.message);
            }
          }

        } catch (error) {
          console.error('❌ [Schedule Consumer] Error linking slots to appointment:', {
            error: error.message,
            appointmentId,
            slotIds
          });
          throw error; // Sẽ kích hoạt RabbitMQ retry
        }
      } else if (message.event === 'reservation.expired') {
        // ✅ MỚI: Xử lý hết hạn đặt chỗ - mở khóa slots
        const { reservationId, slotIds, expiredAt, reason } = message.data;

        console.log('⏰ [Schedule Consumer] ========================================');
        console.log('⏰ [Schedule Consumer] Received reservation.expired event');
        console.log('📊 [Schedule Consumer] Event data:', {
          reservationId,
          slotIds,
          slotCount: slotIds?.length || 0,
          expiredAt,
          reason
        });
        console.log('⏰ [Schedule Consumer] ========================================');

        if (!slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
          console.warn('⚠️ [Schedule Consumer] No slotIds provided, skipping...');
          return;
        }

        try {
          let unlockedCount = 0;

          // Mở khóa từng slot (chuyển về available)
          for (const slotId of slotIds) {
            // Trước tiên, kiểm tra xem slot vẫn đang bị khóa bởi reservation này không
            const currentSlot = await slotRepository.getSlotById(slotId);
            
            if (!currentSlot) {
              console.warn(`⚠️ [Schedule Consumer] Slot ${slotId} not found`);
              continue;
            }

            // Chỉ mở khóa nếu:
            // 1. Status là 'locked'
            // 2. lockedBy khớp với reservationId này (hoặc là null)
            if (currentSlot.status === 'locked' && 
                (!currentSlot.lockedBy || currentSlot.lockedBy === reservationId)) {
              
              const updateData = {
                status: 'available', // Chuyển về available
                lockedBy: null,
                lockedAt: null,
                appointmentId: null // Xóa liên kết appointment nếu có
              };

              console.log(`🔓 [Schedule Consumer] Unlocking slot ${slotId}:`, updateData);

              const updatedSlot = await slotRepository.updateSlot(slotId, updateData);

              if (updatedSlot) {
                unlockedCount++;
                console.log(`✅ [Schedule Consumer] Slot ${slotId} đã mở khóa (chuyển lại available)`);
              }
            } else {
              console.log(`ℹ️  [Schedule Consumer] Slot ${slotId} đã được xử lý:`, {
                currentStatus: currentSlot.status,
                lockedBy: currentSlot.lockedBy,
                appointmentId: currentSlot.appointmentId
              });
            }
          }

          console.log('✅ [Schedule Consumer] ========================================');
          console.log('✅ [Schedule Consumer] Đặt chỗ hết hạn - slots đã mở khóa');
          console.log('📊 [Schedule Consumer] Tóm tắt:', {
            totalSlots: slotIds.length,
            unlockedSlots: unlockedCount,
            reservationId: reservationId,
            reason: reason
          });
          console.log('✅ [Schedule Consumer] ========================================');

        } catch (error) {
          console.error('❌ [Schedule Consumer] Lỗi khi mở khóa slots hết hạn:', {
            error: error.message,
            reservationId,
            slotIds
          });
          throw error; // Sẽ kích hoạt RabbitMQ retry
        }
      } else if (message.event === 'log_appointment_cancellation') {
        // 🔥 MỚI: Ghi log hủy cuộc hẹn vào DayClosure
        const slotService = require('../services/slot.service');
        
        console.log('📝 [Schedule Consumer] Processing log_appointment_cancellation:', {
          appointmentId: message.data?.appointmentId,
          appointmentCode: message.data?.appointmentCode
        });

        try {
          await slotService.logAppointmentCancellation(message.data);
          console.log('✅ [Schedule Consumer] Đã ghi log hủy cuộc hẹn vào DayClosure');
        } catch (error) {
          console.error('❌ [Schedule Consumer] Lỗi khi ghi log hủy cuộc hẹn:', error.message);
          // Không throw - đây là audit logging, không nên chặn luồng
        }
      } else {
        console.log('ℹ️ [Schedule Consumer] Loại sự kiện chưa xử lý:', message.event);
      }
    });

    console.log('👂 [Schedule Consumer] Đang lắng nghe schedule_queue...');
  } catch (error) {
    console.error('❌ [Schedule Consumer] Không thể khởi động consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };

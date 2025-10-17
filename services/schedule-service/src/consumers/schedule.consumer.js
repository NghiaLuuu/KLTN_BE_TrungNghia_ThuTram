const rabbitmqClient = require('../utils/rabbitmq.client');
const slotRepository = require('../repositories/slot.repository');

/**
 * Start consuming messages from schedule_queue
 */
async function startConsumer() {
  try {
    await rabbitmqClient.consumeFromQueue('schedule_queue', async (message) => {
      console.log('📥 [Schedule Consumer] Received event:', {
        event: message.event,
        timestamp: new Date().toISOString()
      });

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

          // Update each slot
          for (const slotId of slotIds) {
            const updateData = {
              status: status, // 'booked'
              lockedBy: null, // Clear lock
              lockedAt: null
            };

            // Add appointmentId if provided
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
          throw error; // Will trigger RabbitMQ retry
        }
      } else if (message.event === 'appointment.created') {
        // Handle appointment created event - update slots with appointmentId
        const { appointmentId, slotIds, reservationId, status } = message.data;

        console.log('🔄 [Schedule Consumer] Processing appointment.created:', {
          appointmentId,
          slotIds,
          count: slotIds?.length || 0,
          reservationId
        });

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

          // Update each slot with appointmentId
          for (const slotId of slotIds) {
            const updateData = {
              status: status || 'booked',
              appointmentId: appointmentId,
              lockedBy: null, // Clear lock
              lockedAt: null
            };

            console.log(`🔄 [Schedule Consumer] Updating slot ${slotId} with appointmentId:`, appointmentId);

            const updatedSlot = await slotRepository.updateSlot(slotId, updateData);

            if (updatedSlot) {
              updatedCount++;
              console.log(`✅ [Schedule Consumer] Slot ${slotId} linked to appointment ${appointmentId}`);
            } else {
              console.warn(`⚠️ [Schedule Consumer] Slot ${slotId} not found`);
            }
          }

          console.log('✅ [Schedule Consumer] Slots linked to appointment successfully:', {
            total: slotIds.length,
            updated: updatedCount,
            appointmentId
          });

        } catch (error) {
          console.error('❌ [Schedule Consumer] Error linking slots to appointment:', {
            error: error.message,
            appointmentId,
            slotIds
          });
          throw error; // Will trigger RabbitMQ retry
        }
      } else {
        console.log('ℹ️ [Schedule Consumer] Unhandled event type:', message.event);
      }
    });

    console.log('👂 [Schedule Consumer] Listening to schedule_queue...');
  } catch (error) {
    console.error('❌ [Schedule Consumer] Failed to start consumer:', error);
    throw error;
  }
}

module.exports = { startConsumer };

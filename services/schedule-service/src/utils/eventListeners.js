const Slot = require('../models/slot.model');
const rabbitmqClient = require('./rabbitmq.client');

/**
 * Handle appointment.created event
 * Update slots to mark them as booked
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

    // Validate data
    if (!appointmentId || !slotIds || !Array.isArray(slotIds) || slotIds.length === 0) {
      console.error('[Schedule] Invalid appointment data - missing slotIds');
      return;
    }

    // Update all slots to booked status
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

    // If no slots were updated, log warning
    if (result.matchedCount === 0) {
      console.warn('[Schedule] No slots found for appointment:', appointmentId);
    } else if (result.modifiedCount === 0) {
      console.warn('[Schedule] Slots found but not modified (already booked?):', appointmentId);
    } else {
      console.log(`[Schedule] Successfully marked ${result.modifiedCount} slots as booked for appointment ${appointmentId}`);
    }

  } catch (error) {
    console.error('[Schedule] Error handling appointment.created event:', error);
    throw error;
  }
}

/**
 * Handle appointment.cancelled event
 * Release slots back to available status
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
      console.error('[Schedule] Invalid cancellation data - missing slotIds');
      return;
    }

    // Release slots back to available
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

  } catch (error) {
    console.error('[Schedule] Error handling appointment.cancelled event:', error);
    throw error;
  }
}

/**
 * Setup event listeners for schedule service
 */
async function setupEventListeners() {
  try {
    // Connect to RabbitMQ
    await rabbitmqClient.connect();

    // Listen to appointment.created events
    await rabbitmqClient.consumeQueue('appointment.created', handleAppointmentCreated);

    // Listen to appointment.cancelled events
    await rabbitmqClient.consumeQueue('appointment.cancelled', handleAppointmentCancelled);

    // ✅ Simplified logs - will show in index.js only

  } catch (error) {
    console.error('[Schedule] Error setting up event listeners:', error);
    
    // Retry after 5 seconds
    setTimeout(() => {
      console.log('[Schedule] Retrying event listeners setup...');
      setupEventListeners();
    }, 5000);
  }
}

module.exports = {
  setupEventListeners,
  handleAppointmentCreated,
  handleAppointmentCancelled
};

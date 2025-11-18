const cron = require('node-cron');
const Appointment = require('../models/appointment.model');
const axios = require('axios');
// const Record = require('../models/record.model'); // If needed

/**
 * ❌ REMOVED: Auto-progress cron (replaced by Socket.IO event on check-in)
 * Reason: Event-driven is more efficient and real-time
 */

/**
 * ❌ REMOVED: Auto-complete cron (replaced by Socket.IO event on doctor complete)
 * Reason: Event-driven is more efficient and real-time
 */

/**
 * Cleanup expired slot locks (locked > 15 minutes)
 * Runs every 5 minutes
 */
function startCleanupExpiredLocksCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

      // console.log('🔍 [Cron] Checking for expired slot locks...');

      // Call schedule-service to get all locked slots
      const scheduleServiceUrl = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';
      
      const response = await axios.get(`${scheduleServiceUrl}/api/slot/locked`, {
        timeout: 5000 // 5 second timeout
      });

      if (!response.data || !response.data.success || !response.data.slots) {
        console.log('⚠️ [Cron] No locked slots found or API error');
        return;
      }

      const lockedSlots = response.data.slots;

      // Filter expired slots (locked > 15 minutes ago)
      const expiredSlots = lockedSlots.filter(slot => {
        return slot.lockedAt && new Date(slot.lockedAt) < fifteenMinutesAgo;
      });

      if (expiredSlots.length === 0) {
        // console.log('✅ [Cron] No expired slot locks found');
        return;
      }

      console.log(`⚠️ [Cron] Found ${expiredSlots.length} expired slot locks`);

      // Unlock expired slots
      const slotIds = expiredSlots.map(slot => slot._id);
      await axios.put(`${scheduleServiceUrl}/api/slot/bulk-update`, {
        slotIds,
        updates: {
          status: 'available',
          lockedAt: null,
          lockedBy: null
        }
      }, {
        timeout: 5000 // 5 second timeout
      });

      console.log(`✅ [Cron] Unlocked ${expiredSlots.length} expired slots:`, slotIds);

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ [Cron] Cannot connect to schedule-service. Is it running?');
      } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        console.error('❌ [Cron] Timeout connecting to schedule-service');
      } else if (error.response) {
        console.error('❌ [Cron] Schedule-service error:', error.response.status, error.response.data);
      } else {
        console.error('❌ [Cron] Error in cleanup expired locks job:', error.message || error);
        console.error('Stack trace:', error.stack);
      }
    }
  });

  console.log('⏰ Cron job started: Cleanup expired slot locks (15 min)');
}

/**
 * Send reminder email 1 day before appointment
 * Runs every 1 minute (production-safe with compound index)
 */
function startReminderEmailCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const twoDaysLater = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      
      const appointments = await Appointment.find({
        bookedByRole: 'patient',
        patientId: { $ne: null, $exists: true },
        status: { $in: ['confirmed', 'checked-in'] },
        reminderEmailSent: false,
        appointmentDate: {
          $gte: now,
          $lte: twoDaysLater
        }
      }).select('_id appointmentCode patientId patientInfo appointmentDate startTime endTime dentistName serviceName serviceAddOnName roomName subroomName').lean();

      // Filter appointments by exact start time (appointmentDate + startTime)
      const filteredAppointments = appointments.filter(apt => {
        const [hours, minutes] = apt.startTime.split(':').map(Number);
        const appointmentStartTime = new Date(apt.appointmentDate);
        appointmentStartTime.setHours(hours, minutes, 0, 0);
        
        const timeDiff = appointmentStartTime - now;
        const isWithin24Hours = timeDiff > 0 && timeDiff <= 24 * 60 * 60 * 1000;
        
        return isWithin24Hours;
      });
      
      if (filteredAppointments.length === 0) {
        return;
      }

      console.log(`📧 [Reminder] Sending emails for ${filteredAppointments.length} appointments...`);

      const rabbitmqClient = require('./rabbitmq.client');
      
      for (const apt of filteredAppointments) {
        try {
          await rabbitmqClient.publishToQueue('email_notifications', {
            type: 'appointment_reminder',
            patientId: apt.patientId.toString(),
            appointment: {
              appointmentCode: apt.appointmentCode,
              patientName: apt.patientInfo.name,
              patientEmail: apt.patientInfo.email,
              appointmentDate: apt.appointmentDate,
              startTime: apt.startTime,
              endTime: apt.endTime,
              dentistName: apt.dentistName,
              serviceName: apt.serviceName,
              serviceAddOnName: apt.serviceAddOnName,
              roomName: apt.roomName,
              subroomName: apt.subroomName
            }
          });

          await Appointment.updateOne(
            { _id: apt._id },
            { $set: { reminderEmailSent: true } }
          );

          console.log(`✅ [Reminder] Sent: ${apt.appointmentCode} → ${apt.patientInfo.email}`);
        } catch (error) {
          console.error(`❌ [Reminder] Failed ${apt.appointmentCode}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ [Reminder] Cron error:', error.message);
    }
  });

  console.log('⏰ Reminder email cron started (every 1 minute)');
}

/**
 * Auto mark no-show for confirmed appointments that are 1 day overdue
 * Runs every 10 minutes
 */
function startNoShowCron() {
  cron.schedule('*/10 * * * *', async () => {
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Find appointments with status 'confirmed' that are more than 1 day overdue
      const appointments = await Appointment.find({
        status: 'confirmed',
        appointmentDate: { $lt: oneDayAgo }
      }).select('_id appointmentCode appointmentDate startTime endTime patientInfo').lean();

      // Filter by exact appointment time (appointmentDate + startTime + endTime)
      const overdueAppointments = appointments.filter(apt => {
        const [endHours, endMinutes] = apt.endTime.split(':').map(Number);
        const appointmentEndTime = new Date(apt.appointmentDate);
        appointmentEndTime.setHours(endHours, endMinutes, 0, 0);
        
        // Check if appointment end time + 1 day < now
        const oneDayAfterEnd = new Date(appointmentEndTime.getTime() + 24 * 60 * 60 * 1000);
        
        return now > oneDayAfterEnd;
      });

      if (overdueAppointments.length === 0) {
        return;
      }

      console.log(`⚠️ [No-Show] Found ${overdueAppointments.length} overdue confirmed appointments`);

      // Update status to no-show
      const appointmentIds = overdueAppointments.map(apt => apt._id);
      const result = await Appointment.updateMany(
        { _id: { $in: appointmentIds } },
        { 
          $set: { 
            status: 'no-show',
            updatedAt: now
          } 
        }
      );

      console.log(`✅ [No-Show] Marked ${result.modifiedCount} appointments as no-show:`);
      overdueAppointments.forEach(apt => {
        console.log(`   - ${apt.appointmentCode} (${apt.appointmentDate.toLocaleDateString()}) - ${apt.patientInfo?.name || 'N/A'}`);
      });

      // 🔥 Optional: Send notification/email about no-show (future enhancement)
      // Can publish to RabbitMQ queue for email service to notify staff

    } catch (error) {
      console.error('❌ [No-Show] Cron error:', error.message);
      console.error('Stack trace:', error.stack);
    }
  });

  console.log('⏰ No-show check cron started (every 10 minutes)');
}

/**
 * Start essential cron jobs only
 * Note: Auto-progress and auto-complete removed (replaced by Socket.IO)
 */
function startAllCronJobs() {
  startCleanupExpiredLocksCron();
  startReminderEmailCron();
  startNoShowCron();
  console.log('✅ Essential cron jobs started (cleanup + reminder + no-show)');
  console.log('ℹ️  Auto-progress and auto-complete now handled by Socket.IO events');
}

module.exports = {
  startAllCronJobs,
  startCleanupExpiredLocksCron,
  startReminderEmailCron,
  startNoShowCron
};

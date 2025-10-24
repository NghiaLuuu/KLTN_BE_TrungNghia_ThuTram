const cron = require('node-cron');
const Appointment = require('../models/appointment.model');
// const Record = require('../models/record.model'); // If needed

/**
 * Auto-update appointment to in-progress 1 minute before start time
 * Runs every minute
 */
function startAutoProgressCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const oneMinuteLater = new Date(now.getTime() + 1 * 60000);

      // Find appointments that should start in 1 minute
      const appointments = await Appointment.find({
        status: 'checked-in',
        appointmentDate: {
          $gte: new Date(now.toDateString()),
          $lte: new Date(now.toDateString() + ' 23:59:59')
        }
      });

      for (const apt of appointments) {
        // Parse startTime (format: "09:00")
        const [hours, minutes] = apt.startTime.split(':').map(Number);
        const aptStart = new Date(apt.appointmentDate);
        aptStart.setHours(hours, minutes, 0, 0);

        // Check if start time is within next 1 minute
        if (aptStart <= oneMinuteLater && aptStart > now) {
          apt.status = 'in-progress';
          await apt.save();
          console.log(`✅ [Cron] Auto-updated appointment ${apt.appointmentCode} to in-progress`);
        }
      }
    } catch (error) {
      console.error('❌ [Cron] Error in auto-progress job:', error);
    }
  });

  console.log('⏰ Cron job started: Auto-update to in-progress');
}

/**
 * Auto-update appointment to completed after endTime
 * Runs every 5 minutes
 */
function startAutoCompleteCron() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();

      // Find appointments in-progress that are past end time
      const appointments = await Appointment.find({
        status: 'in-progress',
        appointmentDate: {
          $lt: now // Past dates
        }
      });

      for (const apt of appointments) {
        // Parse endTime
        const [hours, minutes] = apt.endTime.split(':').map(Number);
        const aptEnd = new Date(apt.appointmentDate);
        aptEnd.setHours(hours, minutes, 0, 0);

        // If end time has passed
        if (aptEnd < now) {
          apt.status = 'completed';
          apt.completedAt = new Date();
          await apt.save();
          console.log(`✅ [Cron] Auto-completed appointment ${apt.appointmentCode}`);
        }
      }
    } catch (error) {
      console.error('❌ [Cron] Error in auto-complete job:', error);
    }
  });

  console.log('⏰ Cron job started: Auto-complete appointments');
}

/**
 * Start all cron jobs
 */
function startAllCronJobs() {
  startAutoProgressCron();
  startAutoCompleteCron();
  console.log('✅ All cron jobs started');
}

module.exports = {
  startAllCronJobs,
  startAutoProgressCron,
  startAutoCompleteCron
};

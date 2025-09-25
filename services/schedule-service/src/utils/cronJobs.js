const cron = require('node-cron');
const autoScheduleService = require('../services/autoSchedule.service');

class CronJobManager {
  static init() {
    console.log('Initializing auto-schedule cron jobs...');
    
    // Chạy vào 23:59 ngày cuối tháng để kiểm tra và sinh lịch cho quý tiếp theo
    cron.schedule('59 23 28-31 * *', async () => {
      console.log('Running end-of-month auto-schedule check...');
      
      try {
        const shouldRun = await autoScheduleService.shouldRunAutoGeneration();
        
        if (shouldRun) {
          console.log('Triggering auto-generation for all rooms...');
          const results = await autoScheduleService.autoGenerateSchedulesForAllRooms();
          
          console.log('Auto-generation completed:', {
            totalRooms: results.totalRooms,
            successful: results.totalCreated,
            failed: results.totalErrors
          });
        } else {
          console.log('Auto-generation is disabled or not needed at this time');
        }
      } catch (error) {
        console.error('Error in auto-schedule cron job:', error);
      }
    });

    // Chạy hàng ngày vào 0:00 để kiểm tra và thông báo status
    cron.schedule('0 0 * * *', async () => {
      console.log('Running daily auto-schedule status check...');
      
      try {
        const shouldRun = await autoScheduleService.shouldRunAutoGeneration();
        if (shouldRun) {
          console.log('⚠️  Auto-generation should run - approaching end of month');
        }
      } catch (error) {
        console.error('Error in daily status check:', error);
      }
    });

    // Chạy vào đầu quý mới (ngày 1 tháng 1, 4, 7, 10) để kiểm tra và sinh lịch
    cron.schedule('0 0 1 1,4,7,10 *', async () => {
      console.log('Running start-of-quarter auto-schedule check...');
      
      try {
        const config = await autoScheduleService.getAutoScheduleConfig();
        if (!config.enabled) {
          console.log('Auto-schedule is disabled, skipping start-of-quarter check...');
          return;
        }

        const results = await autoScheduleService.autoGenerateSchedulesForAllRooms();
        
        console.log('Start-of-quarter auto-generation completed:', {
          totalRooms: results.totalRooms,
          successful: results.totalCreated,
          failed: results.totalErrors
        });
      } catch (error) {
        console.error('Error in start-of-quarter auto-generation:', error);
      }
    });

    console.log('Auto-schedule cron jobs initialized successfully');
  }

  static getScheduleInfo() {
    return {
      endOfMonth: {
        schedule: '59 23 28-31 * *',
        description: 'Check and generate schedules at end of month (23:59 on days 28-31)'
      },
      dailyCheck: {
        schedule: '0 0 * * *',
        description: 'Daily status check at midnight'
      },
      startOfQuarter: {
        schedule: '0 0 1 1,4,7,10 *',
        description: 'Generate schedules at start of quarter (January 1, April 1, July 1, October 1)'
      }
    };
  }
}

module.exports = CronJobManager;
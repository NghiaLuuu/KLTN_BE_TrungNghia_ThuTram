/**
 * Verification Script: Check holiday detection issue in October/November schedules
 * 
 * This script will:
 * 1. Find schedules for Oct/Nov/Dec 2024
 * 2. Check their computedDaysOff
 * 3. Compare with current holiday data
 * 4. Show discrepancies
 * 
 * Usage: node verify-holiday-issue.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Ho_Chi_Minh');

// Import models
const Schedule = require('./src/models/schedule.model');
const HolidayConfig = require('./src/models/scheduleConfig.model').HolidayConfig;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/kltn_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function verifyHolidayIssue() {
  try {
    console.log('🔍 Verifying holiday detection issue...\n');
    
    // Get current recurring holidays
    const holidayConfig = await HolidayConfig.findOne();
    if (!holidayConfig) {
      throw new Error('Holiday config not found in database');
    }
    
    const recurringHolidays = holidayConfig.holidays
      .filter(h => h.isRecurring && h.isActive)
      .map(h => ({ name: h.name, dayOfWeek: h.dayOfWeek }));
    
    console.log('📋 Current Recurring Holidays in DB:');
    recurringHolidays.forEach(h => {
      const dayNames = ['', 'Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
      console.log(`   ${h.name}: dayOfWeek=${h.dayOfWeek} (${dayNames[h.dayOfWeek]})`);
    });
    console.log('');
    
    // Check schedules for Oct, Nov, Dec 2024
    const targetMonths = [
      { month: 10, year: 2024, name: 'October 2024' },
      { month: 11, year: 2024, name: 'November 2024' },
      { month: 12, year: 2024, name: 'December 2024' }
    ];
    
    for (const { month, year, name } of targetMonths) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`📅 Checking ${name}...`);
      console.log('='.repeat(70));
      
      const schedules = await Schedule.find({ month, year }).lean();
      
      if (schedules.length === 0) {
        console.log(`   ⚠️  No schedules found for ${name}`);
        continue;
      }
      
      console.log(`   Found ${schedules.length} schedule(s)\n`);
      
      for (const schedule of schedules) {
        console.log(`   📄 Schedule ID: ${schedule._id}`);
        console.log(`      Room: ${schedule.roomId}, SubRoom: ${schedule.subRoomId || 'N/A'}`);
        
        const computedDaysOff = schedule.holidaySnapshot?.computedDaysOff || [];
        console.log(`      computedDaysOff count: ${computedDaysOff.length}`);
        
        if (computedDaysOff.length === 0) {
          console.log(`      ⚠️  No computedDaysOff! Will use fallback logic.`);
          
          // Check what recurringHolidays are stored in snapshot
          const snapshotRecurring = schedule.holidaySnapshot?.recurringHolidays || [];
          console.log(`      Snapshot recurring holidays:`);
          snapshotRecurring.forEach(h => {
            const dayNames = ['', 'Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
            console.log(`         ${h.name}: dayOfWeek=${h.dayOfWeek} (${dayNames[h.dayOfWeek]})`);
          });
        } else {
          // Show first 5 days
          console.log(`      First 5 computed days off:`);
          computedDaysOff.slice(0, 5).forEach(day => {
            const date = dayjs(day.date);
            const jsDay = date.day(); // 0=Sunday, 1=Monday, etc.
            const ourConvention = jsDay + 1; // 1=Sunday, 2=Monday, etc.
            const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
            const dayName = dayNames[jsDay];
            
            console.log(`         ${day.date} (${dayName}, dayOfWeek=${ourConvention}): ${day.reason}`);
          });
          
          // Check if Sunday (dayOfWeek=1) is being detected
          const sundays = computedDaysOff.filter(day => {
            const date = dayjs(day.date);
            return date.day() === 0; // JavaScript: 0=Sunday
          });
          
          const mondays = computedDaysOff.filter(day => {
            const date = dayjs(day.date);
            return date.day() === 1; // JavaScript: 1=Monday
          });
          
          console.log(`\n      🔍 Analysis:`);
          console.log(`         Sundays detected: ${sundays.length}`);
          console.log(`         Mondays detected: ${mondays.length}`);
          
          if (sundays.length === 0 && mondays.length > 0) {
            console.log(`         ⚠️  ISSUE FOUND: No Sundays but has Mondays!`);
            console.log(`         This suggests dayOfWeek mapping was wrong when this schedule was created.`);
          } else if (sundays.length > 0 && mondays.length === 0) {
            console.log(`         ✅ CORRECT: Has Sundays, no Mondays`);
          } else if (sundays.length > 0 && mondays.length > 0) {
            console.log(`         ⚠️  BOTH Sundays and Mondays detected - check if multiple holidays configured`);
          }
        }
        
        console.log('');
      }
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ Verification complete!');
    console.log('='.repeat(70));
    
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  }
}

async function main() {
  try {
    await mongoose.connection.once('open', async () => {
      console.log('✅ Connected to MongoDB\n');
      await verifyHolidayIssue();
      await mongoose.connection.close();
      console.log('\n✅ Disconnected from MongoDB');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

main();

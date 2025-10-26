/**
 * Migration Script: Regenerate computedDaysOff for existing schedules
 * 
 * Problem: Old schedules (Oct/Nov 2024) have computedDaysOff generated from
 * incorrect recurringHolidays data (before timezone bug was fixed).
 * 
 * Solution: Re-compute computedDaysOff using current (corrected) holiday data.
 * 
 * Usage: node fix-computed-daysoff-migration.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');

// Import models
const Schedule = require('./src/models/schedule.model');
const HolidayConfig = require('./src/models/scheduleConfig.model').HolidayConfig;

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/kltn_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

/**
 * Re-compute days off from current holiday data
 * (Same logic as computeDaysOff in schedule.service.js)
 */
function computeDaysOff(startDate, endDate, recurringHolidays = [], nonRecurringHolidays = []) {
  const daysOffMap = new Map();
  
  const start = dayjs(startDate).startOf('day');
  const end = dayjs(endDate).endOf('day');
  
  // 1. Recurring holidays
  let currentDate = start;
  while (currentDate.isSameOrBefore(end, 'day')) {
    const dayOfWeek = currentDate.day() + 1; // 0->1 (Sunday), 1->2 (Monday), etc.
    
    const matchingRecurring = recurringHolidays.find(h => h.dayOfWeek === dayOfWeek);
    if (matchingRecurring) {
      const dateStr = currentDate.format('YYYY-MM-DD');
      if (!daysOffMap.has(dateStr)) {
        daysOffMap.set(dateStr, {
          date: dateStr,
          reason: matchingRecurring.name,
          shifts: {
            morning: { isOverridden: false, overriddenAt: null },
            afternoon: { isOverridden: false, overriddenAt: null },
            evening: { isOverridden: false, overriddenAt: null }
          }
        });
      }
    }
    
    currentDate = currentDate.add(1, 'day');
  }
  
  // 2. Non-recurring holidays
  for (const holiday of nonRecurringHolidays) {
    const holidayStart = dayjs(holiday.startDate).startOf('day');
    const holidayEnd = dayjs(holiday.endDate).endOf('day');
    
    const overlapStart = holidayStart.isAfter(start) ? holidayStart : start;
    const overlapEnd = holidayEnd.isBefore(end) ? holidayEnd : end;
    
    if (overlapStart.isSameOrBefore(overlapEnd)) {
      let hDate = overlapStart;
      while (hDate.isSameOrBefore(overlapEnd, 'day')) {
        const dateStr = hDate.format('YYYY-MM-DD');
        if (!daysOffMap.has(dateStr)) {
          daysOffMap.set(dateStr, {
            date: dateStr,
            reason: holiday.name,
            shifts: {
              morning: { isOverridden: false, overriddenAt: null },
              afternoon: { isOverridden: false, overriddenAt: null },
              evening: { isOverridden: false, overriddenAt: null }
            }
          });
        }
        hDate = hDate.add(1, 'day');
      }
    }
  }
  
  return Array.from(daysOffMap.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Get holiday snapshot for date range
 */
async function getHolidaySnapshot(startDate, endDate) {
  const startOfDay = new Date(startDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  
  const endOfDay = new Date(endDate);
  endOfDay.setUTCHours(23, 59, 59, 999);
  
  // Get holiday config
  const holidayConfig = await HolidayConfig.findOne();
  if (!holidayConfig) {
    throw new Error('Holiday config not found in database');
  }
  
  // Get recurring holidays (active)
  const recurringHolidays = holidayConfig.holidays
    .filter(h => h.isRecurring && h.isActive)
    .map(h => ({ name: h.name, dayOfWeek: h.dayOfWeek }));
  
  // Get non-recurring holidays (active and overlapping date range)
  const nonRecurringHolidays = holidayConfig.holidays
    .filter(h => {
      if (h.isRecurring || !h.isActive) return false;
      
      const hStart = new Date(h.startDate);
      const hEnd = new Date(h.endDate);
      hStart.setUTCHours(0, 0, 0, 0);
      hEnd.setUTCHours(23, 59, 59, 999);
      
      // Check overlap
      return hStart <= endOfDay && hEnd >= startOfDay;
    })
    .map(h => ({ 
      name: h.name, 
      startDate: h.startDate, 
      endDate: h.endDate 
    }));
  
  const computedDaysOff = computeDaysOff(
    startOfDay,
    endOfDay,
    recurringHolidays,
    nonRecurringHolidays
  );
  
  return {
    recurringHolidays,
    nonRecurringHolidays,
    computedDaysOff
  };
}

/**
 * Migrate existing schedules
 */
async function migrateSchedules() {
  try {
    console.log('🚀 Starting migration: Regenerate computedDaysOff...\n');
    
    // Find all schedules
    const schedules = await Schedule.find({}).lean();
    console.log(`📊 Found ${schedules.length} schedules to check\n`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    for (const schedule of schedules) {
      try {
        const scheduleId = schedule._id;
        const month = schedule.month;
        const year = schedule.year;
        
        console.log(`\n📅 Processing Schedule: ${month}/${year} (ID: ${scheduleId})`);
        console.log(`   Room: ${schedule.roomId}, SubRoom: ${schedule.subRoomId || 'N/A'}`);
        console.log(`   Date Range: ${schedule.startDate} to ${schedule.endDate}`);
        
        // Check if schedule has old computedDaysOff
        const oldComputedDaysOff = schedule.holidaySnapshot?.computedDaysOff || [];
        console.log(`   Old computedDaysOff count: ${oldComputedDaysOff.length}`);
        
        // Regenerate holiday snapshot with current data
        const newHolidaySnapshot = await getHolidaySnapshot(
          schedule.startDate,
          schedule.endDate
        );
        
        console.log(`   New computedDaysOff count: ${newHolidaySnapshot.computedDaysOff.length}`);
        
        // Preserve existing shift override status
        const newComputedDaysOff = newHolidaySnapshot.computedDaysOff.map(newDay => {
          // Find if this date was in old computedDaysOff
          const oldDay = oldComputedDaysOff.find(d => d.date === newDay.date);
          
          if (oldDay && oldDay.shifts) {
            // Preserve override status from old data
            return {
              ...newDay,
              shifts: {
                morning: oldDay.shifts.morning || newDay.shifts.morning,
                afternoon: oldDay.shifts.afternoon || newDay.shifts.afternoon,
                evening: oldDay.shifts.evening || newDay.shifts.evening
              }
            };
          }
          
          return newDay;
        });
        
        // Update schedule with new computedDaysOff
        await Schedule.updateOne(
          { _id: scheduleId },
          {
            $set: {
              'holidaySnapshot.computedDaysOff': newComputedDaysOff,
              'holidaySnapshot.recurringHolidays': newHolidaySnapshot.recurringHolidays,
              'holidaySnapshot.nonRecurringHolidays': newHolidaySnapshot.nonRecurringHolidays
            }
          }
        );
        
        console.log(`   ✅ Updated successfully`);
        updatedCount++;
        
        // Show sample of changes
        if (oldComputedDaysOff.length !== newComputedDaysOff.length) {
          console.log(`   ⚠️  Day count changed: ${oldComputedDaysOff.length} → ${newComputedDaysOff.length}`);
        }
        
        // Show first 3 days for verification
        console.log(`   Sample days (first 3):`);
        newComputedDaysOff.slice(0, 3).forEach(day => {
          const dayOfWeek = dayjs(day.date).format('dddd');
          console.log(`      ${day.date} (${dayOfWeek}): ${day.reason}`);
        });
        
      } catch (err) {
        console.error(`   ❌ Error processing schedule ${schedule._id}:`, err.message);
        errorCount++;
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📝 Total: ${schedules.length}`);
    console.log('='.repeat(60));
    
    if (errorCount === 0) {
      console.log('\n🎉 Migration completed successfully!');
    } else {
      console.log('\n⚠️  Migration completed with some errors. Please review.');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
async function main() {
  try {
    await mongoose.connection.once('open', async () => {
      console.log('✅ Connected to MongoDB\n');
      await migrateSchedules();
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

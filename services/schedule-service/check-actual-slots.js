/**
 * Check actual slots created in database for October/November
 * to see which days were skipped
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Slot = require('./src/models/slot.model');
const Schedule = require('./src/models/schedule.model');

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/kltn_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function checkSlots() {
  try {
    console.log('🔍 Checking slots for October and November 2025...\n');
    
    // Find schedules for Oct/Nov 2025
    const schedules = await Schedule.find({
      year: 2025,
      month: { $in: [10, 11] }
    }).sort({ month: 1, startDate: 1 }).lean();
    
    if (schedules.length === 0) {
      console.log('⚠️  No schedules found for Oct/Nov 2025');
      return;
    }
    
    console.log(`Found ${schedules.length} schedule(s):\n`);
    
    for (const schedule of schedules) {
      console.log('='.repeat(70));
      console.log(`📅 Schedule: Month ${schedule.month}/${schedule.year}`);
      console.log(`   ID: ${schedule._id}`);
      console.log(`   Room: ${schedule.roomId}, SubRoom: ${schedule.subRoomId || 'N/A'}`);
      console.log(`   Date range: ${schedule.startDate} to ${schedule.endDate}`);
      console.log(`   computedDaysOff: ${schedule.holidaySnapshot?.computedDaysOff?.length || 0} days`);
      
      if (schedule.holidaySnapshot?.computedDaysOff?.length > 0) {
        console.log(`   Holidays in snapshot:`);
        schedule.holidaySnapshot.computedDaysOff.forEach(day => {
          const date = new Date(day.date);
          const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
          const dayName = dayNames[date.getUTCDay()];
          console.log(`      ${day.date} (${dayName}): ${day.reason}`);
        });
      }
      
      // Get all slots for this schedule
      const slots = await Slot.find({ scheduleId: schedule._id })
        .sort({ date: 1, startTime: 1 })
        .lean();
      
      console.log(`\n   Total slots created: ${slots.length}`);
      
      if (slots.length > 0) {
        // Group slots by date
        const slotsByDate = {};
        slots.forEach(slot => {
          const dateStr = new Date(slot.date).toISOString().split('T')[0];
          if (!slotsByDate[dateStr]) {
            slotsByDate[dateStr] = [];
          }
          slotsByDate[dateStr].push(slot);
        });
        
        const dates = Object.keys(slotsByDate).sort();
        console.log(`   Dates with slots: ${dates.length} days`);
        console.log(`   First date: ${dates[0]}`);
        console.log(`   Last date: ${dates[dates.length - 1]}`);
        
        // Check for gaps (skipped days)
        const startDate = new Date(schedule.startDate);
        startDate.setUTCHours(0, 0, 0, 0);
        
        const endDate = new Date(schedule.endDate);
        endDate.setUTCHours(0, 0, 0, 0);
        
        console.log(`\n   📊 Day-by-day analysis:`);
        
        const currentDate = new Date(startDate);
        const dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        
        while (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0];
          const dayOfWeek = currentDate.getUTCDay();
          const dayName = dayNames[dayOfWeek];
          const hasSlots = slotsByDate[dateStr];
          
          if (hasSlots) {
            console.log(`      ✅ ${dateStr} (${dayName}): ${hasSlots.length} slots`);
          } else {
            // Check if it's in computedDaysOff
            const isInDaysOff = schedule.holidaySnapshot?.computedDaysOff?.some(d => d.date === dateStr);
            if (isInDaysOff) {
              console.log(`      ⏭️  ${dateStr} (${dayName}): SKIPPED (Holiday)`);
            } else {
              console.log(`      ❌ ${dateStr} (${dayName}): NO SLOTS (Not holiday - BUG!)`);
            }
          }
          
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
      }
      
      console.log('');
    }
    
    console.log('='.repeat(70));
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

async function main() {
  try {
    await mongoose.connection.once('open', async () => {
      console.log('✅ Connected to MongoDB\n');
      await checkSlots();
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

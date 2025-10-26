/**
 * List all schedules in database to see what months/years exist
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Schedule = require('./src/models/schedule.model');

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/kltn_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function listAllSchedules() {
  try {
    console.log('📊 Fetching all schedules...\n');
    
    const schedules = await Schedule.find({})
      .select('month year roomId subRoomId startDate endDate holidaySnapshot')
      .lean();
    
    console.log(`Total schedules found: ${schedules.length}\n`);
    
    // Group by year and month
    const groupedByDate = {};
    
    for (const schedule of schedules) {
      const key = `${schedule.year}-${String(schedule.month).padStart(2, '0')}`;
      if (!groupedByDate[key]) {
        groupedByDate[key] = [];
      }
      groupedByDate[key].push(schedule);
    }
    
    // Sort by year/month
    const sortedKeys = Object.keys(groupedByDate).sort();
    
    console.log('📅 Schedules grouped by month:\n');
    for (const key of sortedKeys) {
      const [year, month] = key.split('-');
      const monthSchedules = groupedByDate[key];
      
      console.log(`${key} (${year} tháng ${parseInt(month)}):`);
      console.log(`   Total: ${monthSchedules.length} schedule(s)`);
      
      for (const schedule of monthSchedules) {
        const hasComputedDaysOff = schedule.holidaySnapshot?.computedDaysOff?.length > 0;
        console.log(`   - ID: ${schedule._id}`);
        console.log(`     Room: ${schedule.roomId}, SubRoom: ${schedule.subRoomId || 'N/A'}`);
        console.log(`     Date range: ${schedule.startDate} to ${schedule.endDate}`);
        console.log(`     computedDaysOff: ${hasComputedDaysOff ? schedule.holidaySnapshot.computedDaysOff.length + ' days' : 'MISSING'}`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

async function main() {
  try {
    await mongoose.connection.once('open', async () => {
      console.log('✅ Connected to MongoDB\n');
      await listAllSchedules();
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

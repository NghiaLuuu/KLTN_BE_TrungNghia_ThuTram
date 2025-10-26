const mongoose = require('mongoose');

async function checkComputedDaysOff() {
  try {
    const dbName = process.argv[2] || 'dental_clinic_schedule';
    await mongoose.connect(`mongodb://localhost:27017/${dbName}`);
    console.log(`✅ Connected to MongoDB: ${dbName}\n`);
    
    const Schedule = mongoose.model('Schedule', new mongoose.Schema({}, { strict: false, collection: 'schedules' }));
    
    // Lấy TẤT CẢ schedules
    const allSchedules = await Schedule.find({}).sort({ createdAt: -1 }).limit(5);
    console.log(`📋 Found ${allSchedules.length} recent schedules:`);
    allSchedules.forEach(s => {
      console.log(`  - ${s._id}: month=${s.month}/${s.year}, created=${s.createdAt}`);
    });
    
    // Lấy lịch tháng 11/2025 HOẶC lịch gần nhất
    let schedule = await Schedule.findOne({ month: 11, year: 2025 }).sort({ createdAt: -1 });
    
    if (!schedule) {
      console.log('\n⚠️  No schedule for month 11/2025, using most recent schedule...');
      schedule = await Schedule.findOne({}).sort({ createdAt: -1 });
    }
    
    if (!schedule) {
      console.log('❌ No schedule found for month 11/2025!');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`📅 Schedule ID: ${schedule._id}`);
    console.log(`   Month: ${schedule.month}/${schedule.year}`);
    console.log(`   Created: ${schedule.createdAt}\n`);
    
    if (!schedule.holidaySnapshot) {
      console.log('❌ No holidaySnapshot!');
      await mongoose.disconnect();
      return;
    }
    
    console.log('🔍 RECURRING HOLIDAYS IN SNAPSHOT:');
    if (schedule.holidaySnapshot.recurringHolidays) {
      schedule.holidaySnapshot.recurringHolidays.forEach(h => {
        console.log(`  - dayOfWeek=${h.dayOfWeek}: ${h.name}`);
      });
    }
    
    console.log('\n📋 COMPUTED DAYS OFF (first 15):');
    if (schedule.holidaySnapshot.computedDaysOff) {
      const dayjs = require('dayjs');
      schedule.holidaySnapshot.computedDaysOff.slice(0, 15).forEach(d => {
        const date = dayjs(d.date);
        const dayOfWeek = date.day();
        const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
        console.log(`  ${d.date} (${dayNames[dayOfWeek]}) - ${d.reason}`);
      });
    } else {
      console.log('  (empty)');
    }
    
    console.log('\n🔍 ANALYSIS:');
    console.log('If "Nghỉ Thứ Hai" (Monday, dayOfWeek=2) is active:');
    console.log('  → Should skip all Mondays in computedDaysOff');
    console.log('  → Mondays in Nov 2025: 03, 10, 17, 24');
    
    const mondaysInComputed = schedule.holidaySnapshot.computedDaysOff?.filter(d => {
      const dayjs = require('dayjs');
      return dayjs(d.date).day() === 1; // dayjs: 1=Monday
    }) || [];
    
    console.log(`\n  Found ${mondaysInComputed.length} Mondays in computedDaysOff:`);
    mondaysInComputed.forEach(d => console.log(`    - ${d.date}: ${d.reason}`));
    
    await mongoose.disconnect();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkComputedDaysOff();

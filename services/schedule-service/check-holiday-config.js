const mongoose = require('mongoose');

async function checkHolidayConfig() {
  try {
    const dbName = process.argv[2] || 'dental_clinic_schedule';
    await mongoose.connect(`mongodb://localhost:27017/${dbName}`);
    console.log(`✅ Connected to MongoDB: ${dbName}\n`);
    
    const HolidayConfig = mongoose.model('HolidayConfig', new mongoose.Schema({}, { strict: false, collection: 'holidayconfigs' }));
    
    const config = await HolidayConfig.findOne();
    
    if (!config) {
      console.log('❌ No holiday config found!');
      await mongoose.disconnect();
      return;
    }
    
    console.log('📋 RECURRING HOLIDAYS IN DB:');
    console.log('ID | dayOfWeek | isActive | Name');
    console.log('---|-----------|----------|-----');
    
    const dayNames = {
      1: 'Chủ nhật',
      2: 'Thứ Hai',
      3: 'Thứ Ba',
      4: 'Thứ Tư',
      5: 'Thứ Năm',
      6: 'Thứ Sáu',
      7: 'Thứ Bảy'
    };
    
    const recurringHolidays = config.holidays.filter(h => h.isRecurring);
    
    recurringHolidays.forEach(h => {
      const expected = dayNames[h.dayOfWeek] || 'UNKNOWN';
      const match = h.name.includes(expected) ? '✅' : '❌';
      console.log(`${h._id.toString().substr(-6)} | ${h.dayOfWeek}         | ${h.isActive ? 'true    ' : 'false   '} | ${h.name} ${match}`);
    });
    
    console.log('\n🔍 VALIDATION:');
    const sundayHoliday = recurringHolidays.find(h => h.name.includes('Chủ nhật'));
    if (sundayHoliday) {
      console.log(`  "Nghỉ Chủ nhật" has dayOfWeek = ${sundayHoliday.dayOfWeek}`);
      if (sundayHoliday.dayOfWeek === 1) {
        console.log('  ✅ CORRECT! 1 = Sunday');
      } else {
        console.log(`  ❌ WRONG! Should be 1 but got ${sundayHoliday.dayOfWeek}`);
      }
    }
    
    const mondayHoliday = recurringHolidays.find(h => h.name.includes('Thứ Hai'));
    if (mondayHoliday) {
      console.log(`  "Nghỉ Thứ Hai" has dayOfWeek = ${mondayHoliday.dayOfWeek}`);
      if (mondayHoliday.dayOfWeek === 2) {
        console.log('  ✅ CORRECT! 2 = Monday');
      } else {
        console.log(`  ❌ WRONG! Should be 2 but got ${mondayHoliday.dayOfWeek}`);
      }
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkHolidayConfig();

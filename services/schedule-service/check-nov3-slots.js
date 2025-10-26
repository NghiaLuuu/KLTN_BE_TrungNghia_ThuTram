const mongoose = require('mongoose');

async function checkNov3Slots() {
  try {
    await mongoose.connect('mongodb://localhost:27017/dental_clinic_schedule');
    console.log('✅ Connected\n');
    
    const Slot = mongoose.model('Slot', new mongoose.Schema({}, { strict: false, collection: 'slots' }));
    
    // Check slots for 03/11/2025
    const date = new Date('2025-11-03T00:00:00.000Z');
    const nextDay = new Date('2025-11-04T00:00:00.000Z');
    
    const slots = await Slot.find({
      date: { $gte: date, $lt: nextDay }
    }).limit(5);
    
    console.log(`📅 Slots for 2025-11-03 (Thứ 2): ${slots.length} found`);
    
    if (slots.length > 0) {
      console.log('\n✅ Sample slots:');
      slots.forEach(s => {
        console.log(`  - ${s.shiftName}: ${s.startTime} - ${s.endTime}, status=${s.status}`);
      });
    } else {
      console.log('\n❌ NO SLOTS! This date was skipped during generation!');
    }
    
    // Check 04/11
    const date2 = new Date('2025-11-04T00:00:00.000Z');
    const nextDay2 = new Date('2025-11-05T00:00:00.000Z');
    
    const slots2 = await Slot.find({
      date: { $gte: date2, $lt: nextDay2 }
    }).limit(5);
    
    console.log(`\n📅 Slots for 2025-11-04 (Thứ 3): ${slots2.length} found`);
    
    if (slots2.length > 0) {
      console.log('\n✅ Sample slots:');
      slots2.forEach(s => {
        console.log(`  - ${s.shiftName}: ${s.startTime} - ${s.endTime}`);
      });
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkNov3Slots();

const mongoose = require('mongoose');

async function checkSundaySlots() {
  try {
    // Thử kết nối đến cả 2 DB để kiểm tra
    const dbName = process.argv[2] || 'dental_clinic_schedule';
    await mongoose.connect(`mongodb://localhost:27017/${dbName}`);
    console.log(`✅ Connected to MongoDB: ${dbName}`);
    
    const Slot = mongoose.model('Slot', new mongoose.Schema({}, { strict: false, collection: 'slots' }));
    
    const scheduleId = '68fdd4776505d4dfbd458a72';
    
    // Các ngày Chủ nhật trong tháng 11/2025
    const sundayDates = [
      '2025-11-02',
      '2025-11-09', 
      '2025-11-16',
      '2025-11-23',
      '2025-11-30'
    ];
    
    console.log('\n📅 Kiểm tra slots cho các ngày Chủ nhật:');
    
    for (const dateStr of sundayDates) {
      const startOfDay = new Date(dateStr + 'T00:00:00.000Z');
      const endOfDay = new Date(dateStr + 'T23:59:59.999Z');
      
      const count = await Slot.countDocuments({
        scheduleId: new mongoose.Types.ObjectId(scheduleId),
        date: { $gte: startOfDay, $lte: endOfDay }
      });
      
      console.log(`  ${dateStr} (Chủ nhật): ${count} slots`);
    }
    
    // Tổng slots của lịch
    const totalSlots = await Slot.countDocuments({
      scheduleId: new mongoose.Types.ObjectId(scheduleId)
    });
    
    console.log(`\n📊 Tổng slots trong lịch: ${totalSlots}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Done');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkSundaySlots();

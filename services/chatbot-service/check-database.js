/**
 * Check REAL data in MongoDB services collection
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function checkDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB:', process.env.MONGODB_URI);
    console.log('');

    const Service = mongoose.model('Service', new mongoose.Schema({}, {
      strict: false,
      collection: 'services'
    }));

    const allServices = await Service.find({});
    const activeServices = await Service.find({ isActive: true });

    console.log('📊 TỔNG SỐ SERVICES TRONG DATABASE:');
    console.log('   - Tất cả:', allServices.length);
    console.log('   - Đang hoạt động (isActive=true):', activeServices.length);
    console.log('\n============================================================\n');

    if (allServices.length === 0) {
      console.log('❌ DATABASE TRỐNG! Không có dịch vụ nào!');
      console.log('💡 Chạy: node seed-database.js --clear để tạo data\n');
    } else {
      console.log('📋 DANH SÁCH SERVICES TRONG DATABASE:\n');
      allServices.forEach((service, idx) => {
        console.log(`${idx + 1}. ${service.name}`);
        console.log(`   - ID: ${service._id}`);
        console.log(`   - Giá: ${service.basePrice?.toLocaleString() || 'N/A'} VND`);
        console.log(`   - Category: ${service.category || 'N/A'}`);
        console.log(`   - isActive: ${service.isActive}`);
        console.log('');
      });
    }

    await mongoose.connection.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkDatabase();

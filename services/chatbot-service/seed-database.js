/**
 * 🌱 Seed Sample Data for Testing Query Engine
 * 
 * Populate database with sample data for services, rooms, users, slots
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { registerAllModels } = require('./src/models');

async function seedData() {
  console.log('🌱 ========================================');
  console.log('   SEEDING SAMPLE DATA');
  console.log('========================================\n');

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Register models
    console.log('📦 Registering models...');
    const models = registerAllModels();
    console.log('');

    // Clear existing data (optional)
    const clearExisting = process.argv.includes('--clear');
    if (clearExisting) {
      console.log('🗑️  Clearing existing data...');
      await models.Service.deleteMany({});
      await models.Room.deleteMany({});
      await models.User.deleteMany({});
      await models.Slot.deleteMany({});
      console.log('✅ Cleared existing data\n');
    }

    // Seed Services
    console.log('📋 Seeding Services...');
    const services = await models.Service.insertMany([
      {
        name: 'Tẩy trắng răng Laser',
        category: 'Thẩm mỹ',
        description: 'Tẩy trắng răng bằng công nghệ Laser hiện đại, an toàn và hiệu quả',
        basePrice: 1500000,
        duration: 60,
        isActive: true,
        serviceAddOns: [
          { name: 'Tẩy trắng Laser cơ bản', effectivePrice: 1500000, duration: 60 },
          { name: 'Tẩy trắng Laser cao cấp', effectivePrice: 2500000, duration: 90 }
        ]
      },
      {
        name: 'Niềng răng invisalign',
        category: 'Chỉnh nha',
        description: 'Niềng răng trong suốt, tháo lắp được, thoải mái và thẩm mỹ',
        basePrice: 50000000,
        duration: 1800, // 30 tháng
        isActive: true,
        serviceAddOns: []
      },
      {
        name: 'Trám răng sâu',
        category: 'Điều trị',
        description: 'Điều trị và trám răng sâu bằng vật liệu composite cao cấp',
        basePrice: 300000,
        duration: 30,
        isActive: true,
        serviceAddOns: []
      },
      {
        name: 'Nhổ răng khôn',
        category: 'Phẫu thuật',
        description: 'Nhổ răng khôn an toàn, không đau với gây tê hiệu quả',
        basePrice: 1000000,
        duration: 45,
        isActive: true,
        serviceAddOns: []
      },
      {
        name: 'Cấy ghép Implant',
        category: 'Cấy ghép',
        description: 'Cấy ghép implant răng với vật liệu Titan chuẩn quốc tế',
        basePrice: 15000000,
        duration: 120,
        isActive: true,
        serviceAddOns: []
      },
      {
        name: 'Lấy cao răng',
        category: 'Vệ sinh',
        description: 'Lấy cao răng sạch sẽ, phòng ngừa viêm nướu và sâu răng',
        basePrice: 200000,
        duration: 30,
        isActive: true,
        serviceAddOns: []
      },
      {
        name: 'Bọc răng sứ Veneer',
        category: 'Thẩm mỹ',
        description: 'Bọc răng sứ Veneer siêu mỏng, thẩm mỹ cao',
        basePrice: 5000000,
        duration: 90,
        isActive: true,
        serviceAddOns: []
      },
      {
        name: 'Điều trị tủy (Nội nha)',
        category: 'Điều trị',
        description: 'Điều trị tủy răng chuyên sâu, bảo tồn răng thật',
        basePrice: 800000,
        duration: 60,
        isActive: false, // Tạm ngưng
        serviceAddOns: []
      }
    ]);
    console.log(`✅ Seeded ${services.length} services\n`);

    // Seed Rooms
    console.log('🏥 Seeding Rooms...');
    const rooms = await models.Room.insertMany([
      {
        name: 'Phòng khám 1',
        roomType: 'EXAM',
        floor: 1,
        capacity: 1,
        isActive: true,
        hasSubRooms: false
      },
      {
        name: 'Phòng khám 2',
        roomType: 'EXAM',
        floor: 1,
        capacity: 1,
        isActive: true,
        hasSubRooms: false
      },
      {
        name: 'Phòng phẫu thuật',
        roomType: 'SURGERY',
        floor: 2,
        capacity: 2,
        isActive: true,
        hasSubRooms: false
      },
      {
        name: 'Phòng X-quang',
        roomType: 'X_RAY',
        floor: 1,
        capacity: 1,
        isActive: true,
        hasSubRooms: false
      },
      {
        name: 'Phòng chờ tầng 1',
        roomType: 'WAITING',
        floor: 1,
        capacity: 20,
        isActive: true,
        hasSubRooms: false
      }
    ]);
    console.log(`✅ Seeded ${rooms.length} rooms\n`);

    // Seed Users (Dentists)
    console.log('👨‍⚕️ Seeding Users (Dentists)...');
    const users = await models.User.insertMany([
      {
        fullName: 'BS. Nguyễn Văn An',
        email: 'nguyenvanan@smilecare.vn',
        phone: '0901234567',
        roles: ['DENTIST'],
        specialization: 'Nha chu',
        experience: 10,
        isActive: true
      },
      {
        fullName: 'BS. Trần Thị Bình',
        email: 'tranthib@smilecare.vn',
        phone: '0901234568',
        roles: ['DENTIST'],
        specialization: 'Chỉnh nha',
        experience: 8,
        isActive: true
      },
      {
        fullName: 'BS. Lê Hoàng Cường',
        email: 'lehoangcuong@smilecare.vn',
        phone: '0901234569',
        roles: ['DENTIST'],
        specialization: 'Phẫu thuật',
        experience: 15,
        isActive: true
      },
      {
        fullName: 'BS. Phạm Minh Đức',
        email: 'phamminhduc@smilecare.vn',
        phone: '0901234570',
        roles: ['DENTIST'],
        specialization: 'Cấy ghép Implant',
        experience: 12,
        isActive: true
      },
      {
        fullName: 'Lễ tân Nguyễn Thị Em',
        email: 'receptionist@smilecare.vn',
        phone: '0901234571',
        roles: ['RECEPTIONIST'],
        isActive: true
      }
    ]);
    console.log(`✅ Seeded ${users.length} users\n`);

    // Seed Slots (for next 7 days)
    console.log('📅 Seeding Slots...');
    const slots = [];
    const dentists = users.filter(u => u.roles.includes('DENTIST'));
    const examRooms = rooms.filter(r => r.roomType === 'EXAM');
    
    // Generate slots for next 7 days
    for (let day = 0; day < 7; day++) {
      const date = new Date();
      date.setDate(date.getDate() + day);
      const dateStr = date.toISOString().split('T')[0];

      // Morning slots: 8:00 - 12:00
      const morningSlots = [
        { start: '08:00', end: '09:00' },
        { start: '09:00', end: '10:00' },
        { start: '10:00', end: '11:00' },
        { start: '11:00', end: '12:00' }
      ];

      // Afternoon slots: 13:00 - 17:00
      const afternoonSlots = [
        { start: '13:00', end: '14:00' },
        { start: '14:00', end: '15:00' },
        { start: '15:00', end: '16:00' },
        { start: '16:00', end: '17:00' }
      ];

      const allSlots = [...morningSlots, ...afternoonSlots];

      // Create slots for each dentist and room
      dentists.forEach((dentist, dentistIndex) => {
        const room = examRooms[dentistIndex % examRooms.length];
        
        allSlots.forEach(slot => {
          slots.push({
            date: dateStr,
            startTime: slot.start,
            endTime: slot.end,
            dentistId: dentist._id,
            roomId: room._id,
            roomType: room.roomType,
            isAvailable: Math.random() > 0.3 // 70% available
          });
        });
      });
    }

    await models.Slot.insertMany(slots);
    console.log(`✅ Seeded ${slots.length} slots (7 days)\n`);

    // Summary
    console.log('=' .repeat(60));
    console.log('📊 SEED SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Services: ${services.length} (7 active, 1 inactive)`);
    console.log(`✅ Rooms: ${rooms.length} (4 types)`);
    console.log(`✅ Users: ${users.length} (4 dentists, 1 receptionist)`);
    console.log(`✅ Slots: ${slots.length} (next 7 days)`);
    console.log('='.repeat(60));
    console.log('\n🎉 Database seeded successfully!\n');

    // Test queries
    console.log('🧪 Testing sample queries...\n');
    
    const activeServices = await models.Service.find({ isActive: true });
    console.log(`✓ Active services: ${activeServices.length}`);
    
    const xrayRooms = await models.Room.find({ roomType: 'X_RAY', isActive: true });
    console.log(`✓ X-ray rooms: ${xrayRooms.length}`);
    
    const dentistsWithNhaChu = await models.User.find({ 
      roles: { $in: ['DENTIST'] }, 
      specialization: /nha chu/i 
    });
    console.log(`✓ Dentists (Nha chu): ${dentistsWithNhaChu.length}`);
    
    const today = new Date().toISOString().split('T')[0];
    const availableSlots = await models.Slot.find({ date: today, isAvailable: true });
    console.log(`✓ Available slots today: ${availableSlots.length}\n`);

  } catch (error) {
    console.error('💥 Seed error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run seeding
console.log('');
console.log('💡 Usage:');
console.log('  node seed-database.js           # Seed data (keep existing)');
console.log('  node seed-database.js --clear   # Clear + seed data');
console.log('');

seedData().catch(console.error);

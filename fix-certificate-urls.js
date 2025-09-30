/**
 * Script để update tất cả certificate URLs từ folder 'certificates' sang 'avatars'
 * Chạy script này để fix các URL cũ trong database
 */

const mongoose = require('mongoose');
const User = require('./services/auth-service/src/models/user.model');

async function fixCertificateUrls() {
  try {
    console.log('🔧 Đang kết nối MongoDB...');
    await mongoose.connect('mongodb://localhost:27017/dental_clinic');
    console.log('✅ Đã kết nối MongoDB');

    // Tìm tất cả users có certificates với URL folder 'certificates'
    const users = await User.find({ 
      role: 'dentist',
      $or: [
        { 'certificates.frontImage': { $regex: '/certificates/' } },
        { 'certificates.backImage': { $regex: '/certificates/' } }
      ]
    });

    console.log(`🔍 Tìm thấy ${users.length} user có certificate URLs cần update`);

    let totalUpdated = 0;

    for (const user of users) {
      let hasUpdates = false;
      
      console.log(`\n📝 Đang xử lý user: ${user.fullName}`);
      
      if (user.certificates && user.certificates.length > 0) {
        user.certificates.forEach((cert, index) => {
          // Fix frontImage URL
          if (cert.frontImage && cert.frontImage.includes('/certificates/')) {
            const oldUrl = cert.frontImage;
            cert.frontImage = cert.frontImage.replace('/certificates/', '/avatars/');
            console.log(`  ✏️  Certificate ${index + 1} - frontImage:`);
            console.log(`      Cũ: ${oldUrl}`);
            console.log(`      Mới: ${cert.frontImage}`);
            hasUpdates = true;
          }

          // Fix backImage URL
          if (cert.backImage && cert.backImage.includes('/certificates/')) {
            const oldUrl = cert.backImage;
            cert.backImage = cert.backImage.replace('/certificates/', '/avatars/');
            console.log(`  ✏️  Certificate ${index + 1} - backImage:`);
            console.log(`      Cũ: ${oldUrl}`);
            console.log(`      Mới: ${cert.backImage}`);
            hasUpdates = true;
          }
        });

        if (hasUpdates) {
          await user.save();
          totalUpdated++;
          console.log(`  ✅ Đã cập nhật user ${user.fullName}`);
        } else {
          console.log(`  ⏭️  User ${user.fullName} không cần cập nhật`);
        }
      }
    }

    console.log(`\n🎉 Hoàn thành! Đã cập nhật ${totalUpdated}/${users.length} users`);

    // Refresh cache sau khi update
    console.log('\n🔄 Đang refresh cache...');
    const redis = require('./services/auth-service/src/utils/redis.client');
    await redis.del('users_cache');
    await redis.del('dentists_public');
    console.log('✅ Cache đã được refresh');

  } catch (error) {
    console.error('❌ Lỗi:', error);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Đã ngắt kết nối MongoDB');
    process.exit(0);
  }
}

// Chạy script
console.log('🚀 Bắt đầu fix certificate URLs...');
fixCertificateUrls();
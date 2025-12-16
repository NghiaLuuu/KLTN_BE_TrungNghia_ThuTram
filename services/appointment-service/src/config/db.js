const mongoose = require('mongoose');

/**
 * Kết nối đến MongoDB
 * Sử dụng biến môi trường MONGODB_URI hoặc MONGO_URI
 */
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/dental_clinic_appointment';
    console.log('🔧 Appointment Service - MongoDB URI:', mongoUri);
    
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    console.log('✅ Appointment Service - MongoDB đã kết nối');
  } catch (err) {
    console.error('❌ Appointment Service - Lỗi kết nối MongoDB:', err.message);
    process.exit(1);
  }
};
module.exports = connectDB;
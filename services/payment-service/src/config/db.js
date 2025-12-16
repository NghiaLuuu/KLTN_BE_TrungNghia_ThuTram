const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/KLTN';
    
    const conn = await mongoose.connect(mongoUri, {
      maxPoolSize: 10, // Duy trì tối đa 10 kết nối socket
      serverSelectionTimeoutMS: 5000, // Tiếp tục thử gửi các thao tác trong 5 giây
      socketTimeoutMS: 45000 // Đóng socket sau 45 giây không hoạt động
    });
    
    // ✅ Log sẽ chỉ xuất hiện trong index.js
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
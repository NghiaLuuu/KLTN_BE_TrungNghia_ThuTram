const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/dental_clinic_statistic';
    console.log('� Statistic Service - MongoDB URI:', mongoUri);
    
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    console.log('✅ Statistic Service - MongoDB connected');
  } catch (error) {
    console.error('❌ Statistic Service - MongoDB connection error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
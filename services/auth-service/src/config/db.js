const mongoose = require('mongoose');
const connectDB = async () => {
  try {
    // Use MONGODB_URI if available, fallback to MONGO_URI
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/dental_clinic_auth';
    console.log('🔧 Auth Service - MongoDB URI:', mongoUri);
    
    await mongoose.connect(mongoUri, {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000 // Close sockets after 45 seconds of inactivity
    });
    console.log('✅ Auth Service - MongoDB connected');
  } catch (err) {
    console.error('❌ Auth Service - MongoDB connection error:', err.message);
    process.exit(1);
  }
};
module.exports = connectDB;
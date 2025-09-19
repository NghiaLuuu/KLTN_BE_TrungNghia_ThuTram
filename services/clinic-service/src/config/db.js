require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Sử dụng MONGO_URI theo .env file
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log('🏥 Organization Service - MongoDB connected successfully');
    
    // NOTE: Removed automatic creation of default Organization on connect.
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

// initializeDefaultOrganization removed per request

module.exports = connectDB;
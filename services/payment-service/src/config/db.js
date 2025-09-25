const mongoose = require('mongoose');
const config = require('./index');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(config.MONGO_URI, {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000 // Close sockets after 45 seconds of inactivity
    });
    
    console.log(`✅ Payment Service - MongoDB Connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('❌ Payment Service - MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
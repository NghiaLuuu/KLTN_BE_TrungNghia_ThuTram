/**
 * Initialize default admin user
 * This script runs on service startup to ensure admin user exists
 */
const User = require('../models/user.model');
const bcrypt = require('bcryptjs');

const initAdminUser = async () => {
  try {
    console.log('🔍 Checking for default admin user...');

    // Check if admin user already exists
    const existingAdmin = await User.findOne({ 
      email: 'adminn@gmail.com' 
    });

    if (existingAdmin) {
      console.log('✅ Admin user already exists, skipping initialization');
      return;
    }

    console.log('📝 Creating default admin user...');

    // Hash password using bcrypt (same as register function)
    const hashedPassword = await bcrypt.hash('admin123', 10);

    // Create default admin user
    const adminUser = new User({
      avatar: null,
      email: 'adminn@gmail.com',
      phone: '0000000000',
      password: hashedPassword,
      fullName: 'admin',
      description: '<p>admin</p>',
      gender: 'female',
      dateOfBirth: new Date('1990-01-01'),
      isActive: true,
      hasBeenUsed: false,
      employeeCode: 'admin',
      certificateNotes: '',
      isFirstLogin: false,
      specialties: [],
      roles: ['admin'],
      refreshTokens: [],
      certificates: []
    });

    await adminUser.save();
    
    console.log('✅ Default admin user created successfully');
    console.log('   Email: adminn@gmail.com');
    console.log('   Password: admin123');
    console.log('   Employee Code: admin');
    
  } catch (error) {
    console.error('❌ Error initializing admin user:', error.message);
    // Don't throw error - service should continue even if admin init fails
  }
};

module.exports = initAdminUser;

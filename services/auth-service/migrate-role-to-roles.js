/**
 * Migration Script: Convert role (string) to roles (array)
 * 
 * This script migrates all users from single role to multiple roles array
 * Run this once to update existing data
 */

require('dotenv').config();
const mongoose = require('mongoose');

const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dental-clinic';

async function migrate() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(DB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');

    // Find all users
    const users = await usersCollection.find({}).toArray();
    console.log(`📊 Found ${users.length} users to migrate`);

    let updated = 0;
    let skipped = 0;

    for (const user of users) {
      // Check if user already has roles array
      if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
        console.log(`⏭️  Skipping ${user.fullName} - already has roles array`);
        skipped++;
        continue;
      }

      // Convert role to roles array
      if (user.role) {
        await usersCollection.updateOne(
          { _id: user._id },
          { 
            $set: { 
              roles: [user.role] // Convert single role to array
            } 
          }
        );
        console.log(`✅ Updated ${user.fullName}: role="${user.role}" → roles=["${user.role}"]`);
        updated++;
      } else {
        console.log(`⚠️  Warning: User ${user.fullName} has no role field`);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updated} users`);
    console.log(`   ⏭️  Skipped: ${skipped} users`);
    console.log(`   📋 Total: ${users.length} users`);

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
migrate();

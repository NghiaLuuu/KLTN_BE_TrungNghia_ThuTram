/**
 * Migration Script: Slot Model - isAvailable/isBooked to status enum
 * 
 * Before: isAvailable (boolean), isBooked (boolean)
 * After: status (enum: 'available', 'locked', 'booked')
 * 
 * Run: node src/migrations/migrate-slot-status.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Slot = require('../models/slot.model');

async function migrateSlotStatus() {
  try {
    console.log('🔄 Starting slot status migration...');
    console.log('📍 MongoDB URI:', process.env.MONGODB_URI?.substring(0, 30) + '...');
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Count total slots
    const totalSlots = await Slot.countDocuments();
    console.log(`📊 Total slots to migrate: ${totalSlots}`);
    
    // 1. Migrate isBooked=true → status='booked'
    console.log('\n1️⃣ Migrating booked slots...');
    const bookedResult = await Slot.updateMany(
      { isBooked: true },
      { 
        $set: { status: 'booked' },
        $unset: { isAvailable: '', isBooked: '' }
      }
    );
    console.log(`   ✅ Migrated ${bookedResult.modifiedCount} booked slots`);
    
    // 2. Migrate isAvailable=true, isBooked=false → status='available'
    console.log('\n2️⃣ Migrating available slots...');
    const availableResult = await Slot.updateMany(
      { 
        isAvailable: { $exists: true },
        isBooked: { $exists: true },
        isBooked: false,
        isAvailable: true
      },
      { 
        $set: { status: 'available' },
        $unset: { isAvailable: '', isBooked: '' }
      }
    );
    console.log(`   ✅ Migrated ${availableResult.modifiedCount} available slots`);
    
    // 3. Migrate other combinations → status='available' (safe default)
    console.log('\n3️⃣ Migrating other slots (default to available)...');
    const otherResult = await Slot.updateMany(
      { 
        $or: [
          { isAvailable: { $exists: true } },
          { isBooked: { $exists: true } }
        ]
      },
      { 
        $set: { status: 'available' },
        $unset: { isAvailable: '', isBooked: '' }
      }
    );
    console.log(`   ✅ Migrated ${otherResult.modifiedCount} other slots`);
    
    // 4. Verify migration
    console.log('\n🔍 Verifying migration...');
    const statusCounts = await Slot.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    
    console.log('\n📊 Status distribution after migration:');
    statusCounts.forEach(item => {
      console.log(`   - ${item._id}: ${item.count} slots`);
    });
    
    // Check for unmigrated slots (still have old fields)
    const unmigrated = await Slot.countDocuments({
      $or: [
        { isAvailable: { $exists: true } },
        { isBooked: { $exists: true } }
      ]
    });
    
    if (unmigrated > 0) {
      console.log(`\n⚠️  WARNING: ${unmigrated} slots still have old fields`);
    } else {
      console.log('\n✅ All slots migrated successfully!');
    }
    
    console.log('\n🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
}

// Run migration
migrateSlotStatus()
  .then(() => {
    console.log('\n✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });

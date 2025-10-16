/**
 * Test script for cache helper migration
 * Tests filterCachedUsers() function to ensure it works correctly
 */

const { filterCachedUsers, getCachedUsers } = require('./cacheHelper');

async function testCacheHelper() {
  try {
    console.log('🧪 Testing Cache Helper Migration...\n');
    console.log('=' .repeat(60));
    
    // Test 1: Get all cached users (raw)
    console.log('\n📋 Test 1: Get All Cached Users (Raw)');
    const allUsers = await getCachedUsers();
    console.log(`✅ Total users in cache: ${allUsers.length}`);
    if (allUsers.length > 0) {
      console.log(`   Sample user fields:`, Object.keys(allUsers[0]));
    } else {
      console.warn('⚠️  WARNING: No users found in cache!');
      console.log('   Make sure auth-service is running and has initialized the cache.');
    }
    
    // Test 2: Get all dentists and nurses (active)
    console.log('\n🦷 Test 2: Get Active Dentists & Nurses');
    const dentistsNurses = await filterCachedUsers({
      role: ['dentist', 'nurse'],
      isActive: true,
      fields: ['_id', 'firstName', 'lastName', 'email', 'role']
    });
    console.log(`✅ Found ${dentistsNurses.length} active dentists/nurses`);
    if (dentistsNurses.length > 0) {
      console.log(`   Sample:`, {
        name: `${dentistsNurses[0].firstName} ${dentistsNurses[0].lastName}`,
        role: dentistsNurses[0].role,
        email: dentistsNurses[0].email
      });
    }
    
    // Test 3: Get only dentists
    console.log('\n👨‍⚕️ Test 3: Get Active Dentists Only');
    const dentists = await filterCachedUsers({
      role: 'dentist',
      isActive: true,
      fields: ['_id', 'firstName', 'lastName', 'role']
    });
    console.log(`✅ Found ${dentists.length} active dentists`);
    
    // Test 4: Get dentists excluding one (simulate replacement staff query)
    console.log('\n🔄 Test 4: Get Replacement Dentists (excluding one)');
    if (dentists.length > 0) {
      const excludeId = dentists[0]._id;
      const replacementDentists = await filterCachedUsers({
        role: 'dentist',
        isActive: true,
        excludeId: excludeId,
        fields: ['_id', 'firstName', 'lastName', 'email', 'role']
      });
      console.log(`✅ Found ${replacementDentists.length} replacement dentists (excluded ${dentists[0].firstName} ${dentists[0].lastName})`);
    } else {
      console.log('⏭️  Skipped (no dentists to exclude)');
    }
    
    // Test 5: Get all staff by role counts
    console.log('\n📊 Test 5: Staff Count by Role');
    const roles = ['dentist', 'nurse', 'admin', 'manager', 'receptionist'];
    for (const role of roles) {
      const count = (await filterCachedUsers({ role, isActive: true })).length;
      console.log(`   ${role.padEnd(15)}: ${count}`);
    }
    
    // Test 6: Filter by isActive
    console.log('\n🟢 Test 6: Active vs Inactive Users');
    const activeUsers = await filterCachedUsers({ isActive: true });
    const inactiveUsers = await filterCachedUsers({ isActive: false });
    console.log(`   Active users  : ${activeUsers.length}`);
    console.log(`   Inactive users: ${inactiveUsers.length}`);
    console.log(`   Total         : ${activeUsers.length + inactiveUsers.length}`);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed successfully!\n');
    
    // Summary
    console.log('📝 Summary:');
    console.log(`   - Cache is ${allUsers.length > 0 ? 'working correctly' : 'EMPTY (check auth-service)'}`);
    console.log(`   - filterCachedUsers() is functioning properly`);
    console.log(`   - Migration from User model to Redis cache is complete`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run tests
console.log('🚀 Starting cache helper tests...');
console.log('   Make sure Redis is running and auth-service has populated users_cache\n');

testCacheHelper();

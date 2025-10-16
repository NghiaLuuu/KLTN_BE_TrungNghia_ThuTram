/**
 * 📚 Quick Reference: filterCachedUsers() Usage Examples
 * 
 * This file shows common usage patterns for filterCachedUsers()
 * after migrating from User model to Redis cache.
 */

const { filterCachedUsers } = require('../utils/cacheHelper');

// ============================================================================
// Example 1: Get all active dentists and nurses
// ============================================================================
async function getAllActiveDentistsNurses() {
  const staff = await filterCachedUsers({
    role: ['dentist', 'nurse'],
    isActive: true,
    fields: ['_id', 'firstName', 'lastName', 'email', 'role']
  });
  
  return staff;
}

// ============================================================================
// Example 2: Get all dentists only
// ============================================================================
async function getAllActiveDentists() {
  const dentists = await filterCachedUsers({
    role: 'dentist',
    isActive: true,
    fields: ['_id', 'firstName', 'lastName', 'email', 'role', 'fullName']
  });
  
  return dentists;
}

// ============================================================================
// Example 3: Get replacement staff (excluding original staff)
// ============================================================================
async function getReplacementStaff(originalStaffId, role) {
  const replacements = await filterCachedUsers({
    role: role, // 'dentist' or 'nurse'
    isActive: true,
    excludeId: originalStaffId,
    fields: ['_id', 'firstName', 'lastName', 'email', 'role']
  });
  
  return replacements;
}

// ============================================================================
// Example 4: Get all staff (any role)
// ============================================================================
async function getAllActiveStaff() {
  const allStaff = await filterCachedUsers({
    isActive: true
    // No fields specified = return all fields
  });
  
  return allStaff;
}

// ============================================================================
// Example 5: Get staff by multiple roles
// ============================================================================
async function getAllMedicalStaff() {
  const medicalStaff = await filterCachedUsers({
    role: ['dentist', 'nurse', 'doctor'],
    isActive: true,
    fields: ['_id', 'firstName', 'lastName', 'role', 'specialization']
  });
  
  return medicalStaff;
}

// ============================================================================
// Example 6: Get inactive staff (for admin panel)
// ============================================================================
async function getInactiveStaff() {
  const inactive = await filterCachedUsers({
    isActive: false,
    fields: ['_id', 'fullName', 'role', 'email']
  });
  
  return inactive;
}

// ============================================================================
// Example 7: Get staff for dropdown list (minimal fields)
// ============================================================================
async function getStaffDropdownList(role = null) {
  const criteria = {
    isActive: true,
    fields: ['_id', 'fullName']
  };
  
  if (role) {
    criteria.role = role;
  }
  
  const staff = await filterCachedUsers(criteria);
  
  // Format for dropdown
  return staff.map(s => ({
    value: s._id,
    label: s.fullName
  }));
}

// ============================================================================
// Example 8: Build user ID to name mapping
// ============================================================================
async function buildUserIdToNameMap(roleFilter = null) {
  const criteria = {
    isActive: true,
    fields: ['_id', 'fullName']
  };
  
  if (roleFilter) {
    criteria.role = roleFilter;
  }
  
  const users = await filterCachedUsers(criteria);
  
  // Create map: userId -> fullName
  const userMap = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u.fullName;
  });
  
  return userMap;
}

// ============================================================================
// FIELD MAPPING NOTES
// ============================================================================
/*
Auth-service cache structure (users_cache):
{
  _id: ObjectId,
  email: String,
  fullName: String,      // "Nguyễn Văn A"
  role: String,          // 'dentist', 'nurse', etc.
  isActive: Boolean,
  employeeCode: String,
  // ... other fields
}

filterCachedUsers() auto-generates:
- firstName: First word of fullName   // "Nguyễn"
- lastName: Rest of fullName          // "Văn A"

Available fields to request:
- _id
- email
- fullName
- firstName (auto-generated)
- lastName (auto-generated)
- role
- isActive
- employeeCode
- phone
- dateOfBirth
- gender
- avatar
- description
- certificates (for dentists)
- ... any field from auth-service User model
*/

// ============================================================================
// MIGRATION NOTES
// ============================================================================
/*
BEFORE (using User model):
```javascript
const User = require('../models/user.model');
const staff = await User.find({ 
  role: { $in: ['dentist', 'nurse'] }, 
  isActive: true 
}).select('firstName lastName email role');
```

AFTER (using cache):
```javascript
const { filterCachedUsers } = require('../utils/cacheHelper');
const staff = await filterCachedUsers({ 
  role: ['dentist', 'nurse'], 
  isActive: true,
  fields: ['_id', 'firstName', 'lastName', 'email', 'role']
});
```

Benefits:
✅ Faster (Redis cache vs MongoDB query)
✅ No DB schema dependency
✅ Single source of truth (auth-service)
✅ Better separation of concerns
*/

module.exports = {
  getAllActiveDentistsNurses,
  getAllActiveDentists,
  getReplacementStaff,
  getAllActiveStaff,
  getAllMedicalStaff,
  getInactiveStaff,
  getStaffDropdownList,
  buildUserIdToNameMap
};

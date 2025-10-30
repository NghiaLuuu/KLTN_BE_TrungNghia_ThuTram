# 🔄 Migration: Single Role → Multiple Roles Array

## 📋 Overview

Migrate from single `role` (string) to `roles` (array) to support users with multiple roles.

### Before:
```javascript
{
  role: "manager",  // Single role
  fullName: "Nguyen Van A"
}
```

### After:
```javascript
{
  role: "manager",      // Keep for backward compatibility
  roles: ["manager"],   // New array field
  fullName: "Nguyen Van A"
}
```

### Multiple Roles Example:
```javascript
{
  role: "manager",                      // Primary role
  roles: ["manager", "dentist"],        // Multiple roles
  fullName: "Dr. Nguyen Van A"
}
```

---

## ✅ Changes Made

### 1. Backend - Auth Middleware

**File:** `services/*/src/middlewares/auth.middleware.js`

```javascript
// ❌ OLD - Single role check
if (roles.length > 0 && !roles.includes(req.user.role)) {
  return res.status(403).json({ message: 'Access denied' });
}

// ✅ NEW - Multiple roles check
const userRoles = req.user.roles || [req.user.role]; // Support both
const hasPermission = roles.some(role => userRoles.includes(role));

if (!hasPermission) {
  return res.status(403).json({ message: 'Access denied' });
}
```

**Updated in:**
- ✅ `appointment-service/src/middlewares/auth.middleware.js`
- ✅ `record-service/src/middlewares/auth.middleware.js`
- 🔄 TODO: Other services (payment, invoice, medicine, etc.)

---

### 2. Backend - Controllers

**File:** `appointment-service/src/controllers/appointment.controller.js`

```javascript
// ❌ OLD
const userRole = req.user?.role;
if (userRole === 'dentist') { ... }

// ✅ NEW
const userRoles = req.user?.roles || [req.user?.role];
if (userRoles.includes('dentist') && !userRoles.includes('admin')) { ... }
```

**Updated in:**
- ✅ `appointment-service/src/controllers/appointment.controller.js`
- ✅ `record-service/src/controllers/record.controller.js`

---

### 3. Frontend - Role Checks

**Files:** `AppointmentManagement.jsx`, `RecordList.jsx`, `StaffSchedule.jsx`

```javascript
// ❌ OLD
if (currentUser.role === 'dentist') { ... }

// ✅ NEW
const userRoles = currentUser.roles || [currentUser.role];
if (userRoles.includes('dentist')) { ... }
```

**Updated in:**
- ✅ `src/pages/Admin/AppointmentManagement.jsx`
- ✅ `src/pages/Records/RecordList.jsx`
- ✅ `src/pages/Staff/StaffSchedule.jsx`

---

## 🚀 Deployment Steps

### Step 1: Run Migration Script

```bash
cd services/auth-service
node migrate-role-to-roles.js
```

**Expected Output:**
```
🔄 Connecting to MongoDB...
✅ Connected to MongoDB
📊 Found 25 users to migrate
✅ Updated Dr. Nguyen Van A: role="manager" → roles=["manager"]
✅ Updated Dr. Tran Thi B: role="dentist" → roles=["dentist"]
...

📊 Migration Summary:
   ✅ Updated: 25 users
   ⏭️  Skipped: 0 users
   📋 Total: 25 users

✅ Migration completed successfully!
```

### Step 2: Restart Backend Services

```bash
# Appointment Service
cd services/appointment-service
npm start

# Record Service
cd services/record-service
npm start

# (Restart other services as needed)
```

### Step 3: Test Multiple Roles

1. **Update a user to have multiple roles:**
   ```javascript
   // In MongoDB
   db.users.updateOne(
     { email: "manager@example.com" },
     { $set: { roles: ["manager", "dentist"] } }
   )
   ```

2. **Test access:**
   - Login as manager+dentist
   - Should see ALL appointments (manager permission)
   - Check-in should work (dentist permission)

---

## 🧪 Test Cases

### Test 1: Single Role User (Dentist Only)
```javascript
User: { roles: ["dentist"] }
Expected: 
- ✅ See only their own appointments
- ✅ See only their own records
- ❌ Cannot see all appointments
```

### Test 2: Multiple Roles (Manager + Dentist)
```javascript
User: { roles: ["manager", "dentist"] }
Expected:
- ✅ See ALL appointments (manager permission)
- ✅ See ALL records (manager permission)
- ✅ Can check-in appointments (manager permission)
```

### Test 3: Nurse Only
```javascript
User: { roles: ["nurse"] }
Expected:
- ✅ See appointments where nurseId = userId
- ✅ See records from those appointments
- ❌ Cannot see other nurses' appointments
```

---

## 📝 Database Schema

### User Model

```javascript
{
  _id: ObjectId("..."),
  fullName: "Dr. Nguyen Van A",
  email: "dr.a@example.com",
  phone: "0123456789",
  
  // 🔄 Keep for backward compatibility
  role: "manager",  // Primary role (first in roles array)
  
  // 🆕 NEW: Multiple roles support
  roles: ["manager", "dentist"],
  
  // ... other fields
}
```

---

## 🔍 How It Works

### Authorization Logic

```javascript
// Check if user has ANY of the required roles
const authorize = (requiredRoles = []) => {
  return (req, res, next) => {
    // Get user roles (support both old and new format)
    const userRoles = req.user.roles || [req.user.role];
    
    // Check if user has at least one required role
    const hasPermission = requiredRoles.some(role => 
      userRoles.includes(role)
    );
    
    if (!hasPermission) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    next();
  };
};
```

### Role-Based Filtering

```javascript
// Example: Appointments filtering
const userRoles = req.user.roles || [req.user.role];

if (userRoles.includes('dentist') && 
    !userRoles.includes('admin') && 
    !userRoles.includes('manager')) {
  // Dentist without admin/manager role
  filters.dentistId = userId; // Filter by dentist
} else {
  // Admin/Manager sees all
}
```

---

## ⚠️ Breaking Changes

### None!

The migration is **backward compatible**:
- Old code checking `req.user.role` still works
- Old data with only `role` field is converted to `roles: [role]`
- New code supports both `role` and `roles`

---

## 🐛 Troubleshooting

### Issue: "Access Denied" for manager

**Cause:** Middleware not updated to check `roles` array

**Fix:** 
```javascript
// Update auth.middleware.js
const userRoles = req.user.roles || [req.user.role];
const hasPermission = roles.some(role => userRoles.includes(role));
```

### Issue: Staff schedule not showing

**Cause:** Frontend checking `user.role` instead of `user.roles`

**Fix:**
```javascript
// Update StaffSchedule.jsx
const userRoles = user.roles || [user.role];
if (userRoles.includes('dentist') || userRoles.includes('nurse')) {
  setSelectedStaff(user._id);
}
```

---

## 📊 Affected Services

- ✅ appointment-service
- ✅ record-service
- 🔄 payment-service (TODO)
- 🔄 invoice-service (TODO)
- 🔄 medicine-service (TODO)
- 🔄 schedule-service (TODO)
- 🔄 room-service (TODO)

---

**Migrated by:** GitHub Copilot  
**Date:** 2025-10-30  
**Issue:** Manager with multiple roles cannot check-in appointments

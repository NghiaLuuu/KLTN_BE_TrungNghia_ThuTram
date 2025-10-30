# 🔧 Quick Fix: Manager Check-in Permission Issue

## 🐛 Problem
Manager with multiple roles cannot check-in appointments:
```json
{
  "success": false,
  "message": "Từ chối quyền: bạn không có đủ quyền để thực hiện thao tác này"
}
```

## 🔍 Root Causes

### 1. JWT Token Missing `roles` Array
**File:** `auth-service/src/utils/token.util.js`

```javascript
// ❌ OLD - Token only has single role
{
  userId: "...",
  role: "manager"  // String only
}

// ✅ NEW - Token includes roles array
{
  userId: "...",
  role: "manager",           // Keep for backward compatibility
  roles: ["manager", "dentist"]  // NEW: Support multiple roles
}
```

### 2. Route Missing 'manager' Role
**File:** `appointment-service/src/routes/appointment.route.js`

```javascript
// ❌ OLD
authorize(['dentist', 'admin', 'staff', 'receptionist'])

// ✅ NEW
authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist'])
```

---

## ✅ Changes Made

### 1. Token Generation
**File:** `services/auth-service/src/utils/token.util.js`

```javascript
exports.generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role,                    // Legacy
      roles: user.roles || [user.role],   // ✅ NEW
    },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: '1d' }
  );
};
```

### 2. Route Authorization
**File:** `services/appointment-service/src/routes/appointment.route.js`

```javascript
// Check-in appointment
router.post('/:id/check-in', 
  authenticate, 
  authorize(['dentist', 'admin', 'manager', 'staff', 'receptionist']), // ✅ Added manager
  checkInAppointmentValidation,
  validate,
  appointmentController.checkIn
);

// Complete appointment
router.post('/:id/complete', 
  authenticate, 
  authorize(['dentist', 'admin', 'manager']), // ✅ Added manager
  completeAppointmentValidation,
  validate,
  appointmentController.complete
);

// Create offline appointment
router.post('/create-offline', 
  authenticate, 
  authorize(['staff', 'admin', 'manager', 'dentist', 'receptionist']), // ✅ Added manager & receptionist
  createOfflineAppointmentValidation,
  validate,
  appointmentController.createOffline
);
```

---

## 🚀 Deployment

### Step 1: Restart Auth Service
```bash
cd services/auth-service
npm start
```

### Step 2: Restart Appointment Service
```bash
cd services/appointment-service
npm start
```

### Step 3: Re-login
**Important:** Users must re-login to get new JWT token with `roles` array!

---

## 🧪 Test

1. **Login as manager:**
   ```bash
   POST /api/auth/login
   {
     "phone": "0123456789",
     "password": "password"
   }
   ```

2. **Check token payload:**
   ```javascript
   // Decode JWT at jwt.io
   {
     "userId": "...",
     "role": "manager",
     "roles": ["manager", "dentist"]  // ✅ Should have this
   }
   ```

3. **Test check-in:**
   ```bash
   POST /api/appointment/{id}/check-in
   Authorization: Bearer {token}
   ```

4. **Expected result:**
   ```json
   {
     "success": true,
     "message": "Check-in thành công"
   }
   ```

---

## 📝 Summary

- ✅ JWT token now includes `roles` array
- ✅ All authorization middlewares support `roles` array
- ✅ Routes updated to include 'manager' role
- ⚠️ **Users must re-login** to get new token format

---

**Fixed:** 2025-10-30
**Issue:** Manager check-in permission denied

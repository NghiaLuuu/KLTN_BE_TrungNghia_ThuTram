# FIX: First Login Flow - Password Change & Role Selection

## 🐛 Problem Report
User reported: "đang bị lỗi, khi cấp lại mật khẩu... Khi login thì mở model Đổi mật khẩu... không được trùng với mã nhân viên... sau đổi mật khẩu thì phải mở model Chọn vai trò"

**Issue**: 
- When admin resets staff password, `isFirstLogin` flag is set to `true`
- However, login flow wasn't properly checking this flag
- After password change, role selection modal wasn't shown for multi-role users

## ✅ Solution Implemented

### 1. Enhanced Login Flow (`exports.login`)
**File**: `services/auth-service/src/services/auth.service.js`
**Lines**: 133-165

**Changes**:
```javascript
// BEFORE: Only checked if password equals default password
if (isUsingDefaultPassword) { ... }

// AFTER: Also check isFirstLogin flag
if (isUsingDefaultPassword || user.isFirstLogin === true) { ... }
```

**Why**: Ensures that even if user somehow changes password while `isFirstLogin=true`, they still must go through the forced password change flow.

### 2. Role Selection After Password Change (`exports.completePasswordChange`)
**File**: `services/auth-service/src/services/auth.service.js`
**Lines**: 343-389

**Changes**:
```javascript
// BEFORE: Directly issued tokens after password change
const refreshToken = generateRefreshToken(user);
const accessToken = generateAccessToken(user);
return { accessToken, refreshToken, user, message: '...' };

// AFTER: Check for multiple roles first
if (user.roles && user.roles.length > 1) {
  // Return role selection requirement
  return {
    message: 'Đổi mật khẩu thành công. Vui lòng chọn vai trò đăng nhập.',
    pendingData: {
      requiresRoleSelection: true,
      roles: user.roles,
      tempToken: '...',
      ...
    }
  };
}
// Only issue tokens if single role
```

## 🔄 Complete Flow Now

### Step 1: Admin Resets Password
```
POST /api/user/:id/reset-password
→ user.isFirstLogin = true
→ user.password = bcrypt.hash(employeeCode) // for staff
```

### Step 2: Staff First Login
```
POST /api/auth/login
Body: { login: "email", password: "employeeCode" }

→ Checks: user.isFirstLogin === true || password === employeeCode
→ Returns:
{
  message: "Cần đổi mật khẩu",
  pendingData: {
    requiresPasswordChange: true,
    tempToken: "...",
    userId: "...",
    user: { employeeCode: "..." }
  }
}
```

**Frontend**: Opens "Đổi mật khẩu" modal

### Step 3: Staff Changes Password
```
POST /api/auth/complete-password-change
Body: { tempToken: "...", newPassword: "newPass123" }

→ Validates: newPassword !== employeeCode
→ Sets: user.isFirstLogin = false
→ Checks: user.roles.length > 1?

If multiple roles:
{
  message: "Đổi mật khẩu thành công. Vui lòng chọn vai trò đăng nhập.",
  pendingData: {
    requiresRoleSelection: true,
    roles: ["admin", "dentist"],
    tempToken: "...",
    userId: "..."
  }
}

If single role:
{
  accessToken: "...",
  refreshToken: "...",
  user: {...}
}
```

**Frontend**: 
- If `requiresRoleSelection=true` → Opens "Chọn vai trò" modal
- If tokens returned → Complete login

### Step 4: Staff Selects Role (if multiple roles)
```
POST /api/auth/complete-role-selection
Body: { tempToken: "...", selectedRole: "dentist" }

→ Returns:
{
  accessToken: "...",
  refreshToken: "...",
  user: {...}
}
```

**Frontend**: Complete login with tokens

## 🎯 Key Validations

1. **Password != Employee Code**:
   - Line 341-342: `if (newPassword === user.employeeCode) throw new Error('...')`
   
2. **Force Password Change**:
   - Line 138: Checks both `isUsingDefaultPassword` AND `user.isFirstLogin === true`
   
3. **Force Role Selection**:
   - Line 352-372: After password change, check if `user.roles.length > 1`

## 🔐 Security Flow

- **Temp Tokens**: 
  - `type: 'password-change'` (15 min expiry) for password change
  - `type: 'role-selection'` (10 min expiry) for role selection
  
- **Real Tokens**: Only issued after BOTH password change AND role selection complete

## 📝 API Endpoints

| Endpoint | Purpose | Token Type |
|----------|---------|------------|
| `POST /api/auth/login` | Initial login | Returns temp token if isFirstLogin |
| `POST /api/auth/complete-password-change` | Change password on first login | Requires temp token (password-change) |
| `POST /api/auth/complete-role-selection` | Select role if multiple | Requires temp token (role-selection) |

## ✅ Testing Checklist

- [ ] Admin resets staff password → `isFirstLogin = true`
- [ ] Staff logs in with default password → Shows "Đổi mật khẩu" modal
- [ ] Staff tries to use employeeCode as new password → Error: "Mật khẩu mới không được trùng với mã nhân viên"
- [ ] Staff changes password successfully
- [ ] If staff has multiple roles → Shows "Chọn vai trò" modal
- [ ] If staff has single role → Login complete with tokens
- [ ] Staff selects role → Login complete with tokens

## 📌 Related Files

- `services/auth-service/src/services/auth.service.js` - Login and password change logic
- `services/auth-service/src/services/user.service.js:1210` - resetUserPasswordToDefault sets isFirstLogin
- `services/auth-service/src/routes/auth.route.js:17` - complete-password-change endpoint
- `services/auth-service/src/routes/auth.route.js:18` - complete-role-selection endpoint

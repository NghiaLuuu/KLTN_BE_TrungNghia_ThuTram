/**
 * 📚 Tài liệu tham khảo nhanh: Ví dụ sử dụng filterCachedUsers()
 * 
 * File này hiển thị các mẫu sử dụng phổ biến cho filterCachedUsers()
 * sau khi di chuyển từ User model sang Redis cache.
 */

const { filterCachedUsers } = require('../utils/cacheHelper');

// ============================================================================
// Ví dụ 1: Lấy tất cả nha sĩ và y tá đang hoạt động
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
// Ví dụ 2: Chỉ lấy nha sĩ
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
// Ví dụ 3: Lấy nhân viên thay thế (loại trừ nhân viên ban đầu)
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
// Ví dụ 4: Lấy tất cả nhân viên (mọi vai trò)
// ============================================================================
async function getAllActiveStaff() {
  const allStaff = await filterCachedUsers({
    isActive: true
    // Không chỉ định fields = trả về tất cả các trường
  });
  
  return allStaff;
}

// ============================================================================
// Ví dụ 5: Lấy nhân viên theo nhiều vai trò
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
// Ví dụ 6: Lấy nhân viên không hoạt động (cho trang quản trị)
// ============================================================================
async function getInactiveStaff() {
  const inactive = await filterCachedUsers({
    isActive: false,
    fields: ['_id', 'fullName', 'role', 'email']
  });
  
  return inactive;
}

// ============================================================================
// Ví dụ 7: Lấy danh sách nhân viên cho dropdown (trường tối thiểu)
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
  
  // Định dạng cho dropdown
  return staff.map(s => ({
    value: s._id,
    label: s.fullName
  }));
}

// ============================================================================
// Ví dụ 8: Xây dựng ánh xạ từ user ID sang tên
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
  
  // Tạo map: userId -> fullName
  const userMap = {};
  users.forEach(u => {
    userMap[u._id.toString()] = u.fullName;
  });
  
  return userMap;
}

// ============================================================================
// GHI CHÚ VỀ ÁNH XẠ TRƯỜNG
// ============================================================================
/*
Cấu trúc cache auth-service (users_cache):
{
  _id: ObjectId,
  email: String,
  fullName: String,      // "Nguyễn Văn A"
  role: String,          // 'dentist', 'nurse', etc.
  isActive: Boolean,
  employeeCode: String,
  // ... các trường khác
}

filterCachedUsers() tự động tạo:
- firstName: Từ đầu tiên của fullName   // "Nguyễn"
- lastName: Phần còn lại của fullName    // "Văn A"

Các trường có thể yêu cầu:
- _id
- email
- fullName
- firstName (tự động tạo)
- lastName (tự động tạo)
- role
- isActive
- employeeCode
- phone
- dateOfBirth
- gender
- avatar
- description
- certificates (cho nha sĩ)
- ... bất kỳ trường nào từ User model của auth-service
*/

// ============================================================================
// GHI CHÚ VỀ VIỆC DI CHUYỂN
// ============================================================================
/*
TRƯỚC (đóng sử dụng User model):
```javascript
const User = require('../models/user.model');
const staff = await User.find({ 
  role: { $in: ['dentist', 'nurse'] }, 
  isActive: true 
}).select('firstName lastName email role');
```

SAU (sử dụng cache):
```javascript
const { filterCachedUsers } = require('../utils/cacheHelper');
const staff = await filterCachedUsers({ 
  role: ['dentist', 'nurse'], 
  isActive: true,
  fields: ['_id', 'firstName', 'lastName', 'email', 'role']
});
```

Lợi ích:
✅ Nhanh hơn (Redis cache vs truy vấn MongoDB)
✅ Không phụ thuộc DB schema
✅ Nguồn dữ liệu duy nhất (auth-service)
✅ Tách biệt mối quan tâm tốt hơn
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

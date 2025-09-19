# Service API - Postman Test Guide (Updated)

## Base URL
```
http://localhost:3004
```

## Authentication
```
Authorization: Bearer <your_jwt_token>
```

---

## 📋 SERVICE OPERATIONS

### 1. Create Simple Service (có basePrice)
**POST** `/services`
```json
{
  "name": "Khám tổng quát",
  "basePrice": 200000,
  "durationMinutes": 30,
  "type": "exam",
  "description": "Khám răng miệng tổng quát"
}
```

### 2. Create Service with ServiceAddOns (không có basePrice)
**POST** `/services`
```json
{
  "name": "Cạo vôi răng",
  "durationMinutes": 45,
  "type": "treatment",
  "description": "Vệ sinh răng miệng chuyên sâu",
  "serviceAddOns": [
    {
      "name": "Cấp độ 1 - Cơ bản",
      "price": 500000,
      "description": "Cạo vôi răng cơ bản"
    },
    {
      "name": "Cấp độ 2 - Trung bình",
      "price": 800000,
      "description": "Cạo vôi răng + đánh bóng"
    },
    {
      "name": "Cấp độ 3 - Cao cấp",
      "price": 1200000,
      "description": "Cạo vôi răng + đánh bóng + fluoride"
    }
  ]
}
```

### 3. Create Niềng Răng Service
**POST** `/services`
```json
{
  "name": "Niềng răng",
  "durationMinutes": 120,
  "type": "treatment",
  "description": "Điều trị niềng răng chỉnh nha",
  "serviceAddOns": [
    {
      "name": "Kim loại cấp độ 1",
      "price": 8000000,
      "description": "Niềng răng kim loại cơ bản"
    },
    {
      "name": "Kim loại cấp độ 2",
      "price": 12000000,
      "description": "Niềng răng kim loại cao cấp"
    },
    {
      "name": "Ceramic cấp độ 1",
      "price": 15000000,
      "description": "Niềng răng ceramic"
    }
  ]
}
```

### 4. Update Service
**PUT** `/services/:serviceId`
```json
{
  "name": "Khám tổng quát - Updated",
  "description": "Khám răng miệng tổng quát cập nhật",
  "basePrice": 250000
}
```

### 5. Toggle Service Status
**PATCH** `/services/:serviceId/toggle`
*(No body required)*

### 6. Delete Service (sẽ bị từ chối)
**DELETE** `/services/:serviceId`
*(No body required)*
*Expected: 400 - "Không thể xóa dịch vụ - dịch vụ đang được sử dụng hoặc chưa được phép xóa"*

### 7. Get Service Details
**GET** `/services/:serviceId`
*(No body required)*

### 8. List Services
**GET** `/services?page=1&limit=10`
*(No body required)*

### 9. Search Services
**GET** `/services/search?q=niềng&page=1&limit=5`
*(No body required)*

---

## 🔧 SERVICE ADD-ON OPERATIONS

### 1. Add ServiceAddOn (sẽ tự động bỏ basePrice)
**POST** `/services/:serviceId/addons`
```json
{
  "name": "Invisalign cấp độ 1",
  "price": 25000000,
  "description": "Niềng răng trong suốt Invisalign"
}
```
*Note: Nếu service có basePrice, sẽ tự động bị xóa khi thêm addon*

### 2. Add More AddOns
**POST** `/services/:serviceId/addons`
```json
{
  "name": "Thuốc tê đặc biệt",
  "price": 200000,
  "description": "Thuốc tê không đau cho ca phức tạp"
}
```

### 3. Update ServiceAddOn
**PUT** `/services/:serviceId/addons/:addOnId`
```json
{
  "name": "Invisalign cấp độ 1 - Updated",
  "price": 26000000,
  "description": "Niềng răng trong suốt Invisalign cao cấp"
}
```

### 4. Toggle ServiceAddOn Status
**PATCH** `/services/:serviceId/addons/:addOnId/toggle`
*(No body required)*

### 5. Delete ServiceAddOn (sẽ bị từ chối)
**DELETE** `/services/:serviceId/addons/:addOnId`
*(No body required)*
*Expected: 400 - "Không thể xóa dịch vụ bổ sung - đang được sử dụng hoặc chưa được phép xóa"*

### 6. Get ServiceAddOn Details
**GET** `/services/:serviceId/addons/:addOnId`
*(No body required)*

---

## ❌ ERROR TEST CASES

### 1. ERROR - Tên service trùng lặp
**POST** `/services` (tạo service thứ 2 với tên giống service đã có)
```json
{
  "name": "Khám tổng quát",
  "basePrice": 300000,
  "durationMinutes": 30,
  "type": "exam"
}
```
*Expected: 400 - Duplicate name error*

### 2. ERROR - Service có cả basePrice và serviceAddOns
**POST** `/services`
```json
{
  "name": "Service lỗi",
  "basePrice": 500000,
  "durationMinutes": 30,
  "type": "exam",
  "serviceAddOns": [
    {
      "name": "AddOn test",
      "price": 100000
    }
  ]
}
```
*Expected: 400 - Validation error*

### 3. ERROR - Missing required fields
**POST** `/services`
```json
{
  "name": "Service thiếu fields"
}
```
*Expected: 400 - Missing required fields*

### 4. ERROR - Invalid type enum
**POST** `/services`
```json
{
  "name": "Service type lỗi",
  "basePrice": 200000,
  "durationMinutes": 30,
  "type": "invalid_type"
}
```
*Expected: 400 - Invalid enum value*

### 5. ERROR - Unauthorized access
**POST** `/services` *(Remove Authorization header)*
```json
{
  "name": "Service không có quyền",
  "basePrice": 100000,
  "durationMinutes": 15,
  "type": "exam"
}
```
*Expected: 401 - Unauthorized*

---

## 🧪 TEST WORKFLOW - TỰ ĐỘNG BỎ BASEPRICE

### Test Case: Chuyển từ Service đơn giản sang phức tạp

1. **Tạo service với basePrice**
```json
POST /services
{
  "name": "Test Service Auto Remove",
  "basePrice": 500000,
  "durationMinutes": 30,
  "type": "treatment"
}
```

2. **Kiểm tra service có basePrice**
```json
GET /services/:serviceId
// Response sẽ có "basePrice": 500000
```

3. **Thêm ServiceAddOn (sẽ tự động bỏ basePrice)**
```json
POST /services/:serviceId/addons
{
  "name": "Level 1",
  "price": 800000,
  "description": "Cấp độ 1"
}
```

4. **Kiểm tra lại service (basePrice đã bị xóa)**
```json
GET /services/:serviceId
// Response sẽ KHÔNG còn basePrice, chỉ có serviceAddOns
```

---

## 📝 CHANGES SUMMARY

### ✅ **Đã thay đổi:**
1. **Bỏ trường `code`** - Chỉ còn `name` (unique)
2. **Auto remove basePrice** - Khi thêm addon, basePrice tự động bị xóa
3. **Không cho xóa** - DELETE service và addon luôn trả về error
4. **Search updated** - Chỉ search theo name và description

### ❌ **Error Messages:**
- Delete service: "Không thể xóa dịch vụ - dịch vụ đang được sử dụng hoặc chưa được phép xóa"
- Delete addon: "Không thể xóa dịch vụ bổ sung - đang được sử dụng hoặc chưa được phép xóa"
- Duplicate name: MongoDB duplicate key error

### 🔄 **Logic giống Room-SubRoom:**
- Khi Room có SubRoom → maxDoctors/maxNurses bị xóa
- Khi Service có ServiceAddOn → basePrice bị xóa

**Test ngay để thấy logic tự động bỏ basePrice hoạt động!** 🎯
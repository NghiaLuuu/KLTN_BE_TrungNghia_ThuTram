# 📋 Price Schedule Management API Documentation

## Overview
Hệ thống quản lý giá theo khoảng thời gian cho Service và ServiceAddOn.

### Features
- ✅ **ServiceAddOn**: Hỗ trợ nhiều `priceSchedules` (mảng)
- ✅ **Service**: Hỗ trợ `temporaryPrice` (3 trường đơn giản)
- ✅ **Auto-calculate**: Tự động tính giá hiệu lực dựa trên ngày hiện tại
- ✅ **Date validation**: Validate `endDate` > `startDate`
- ✅ **Optional on CREATE**: Không bắt buộc khi tạo mới
- ✅ **Flexible on UPDATE**: Có thể thêm/sửa/xóa bất kỳ lúc nào

---

## 📊 Data Structure

### Service Model
```javascript
{
  name: String,
  type: 'exam' | 'treatment',
  description: String,
  requireExamFirst: Boolean,
  allowedRoomTypes: [String],
  serviceAddOns: [ServiceAddOn],
  isActive: Boolean,
  hasBeenUsed: Boolean,
  
  // 🆕 Temporary Price Fields
  temporaryPrice: Number,      // Giá tạm thời (null nếu không có)
  startDate: Date,             // Ngày bắt đầu áp dụng
  endDate: Date,               // Ngày kết thúc áp dụng
  
  // 🆕 Virtual Fields (auto-calculated)
  hasActiveTemporaryPrice: Boolean  // Có giá tạm thời đang active không
}
```

### ServiceAddOn Model
```javascript
{
  name: String,
  price: Number,               // Giá gốc
  durationMinutes: Number,
  unit: String,
  imageUrl: String,
  description: String,
  isActive: Boolean,
  hasBeenUsed: Boolean,
  
  // 🆕 Price Schedules Array
  priceSchedules: [
    {
      _id: ObjectId,
      price: Number,           // Giá áp dụng trong khoảng thời gian
      startDate: Date,         // Ngày bắt đầu
      endDate: Date,           // Ngày kết thúc
      isActive: Boolean,       // Có active không
      note: String,            // Ghi chú
      createdAt: Date,
      updatedAt: Date
    }
  ],
  
  // 🆕 Virtual Fields (in response)
  basePrice: Number,           // Giá gốc
  effectivePrice: Number,      // Giá hiệu lực (scheduled hoặc base)
  isPriceModified: Boolean     // Giá có bị thay đổi không
}
```

---

## 🔌 API Endpoints

### 1. ServiceAddOn Price Schedules

#### **POST** `/api/services/:serviceId/addons/:addOnId/price-schedules`
Thêm lịch giá mới cho ServiceAddOn

**Request Body:**
```json
{
  "price": 150000,
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T23:59:59.999Z",
  "isActive": true,
  "note": "Giá khuyến mãi Tết"
}
```

**Response:** Service object với serviceAddOns updated

**Errors:**
- `400`: Validation error (endDate <= startDate)
- `403`: Unauthorized (không phải manager/admin)
- `404`: Service hoặc AddOn không tồn tại

---

#### **PUT** `/api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId`
Cập nhật lịch giá

**Request Body:** (tất cả optional)
```json
{
  "price": 160000,
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-02-28T23:59:59.999Z",
  "isActive": false,
  "note": "Gia hạn thêm 1 tháng"
}
```

**Response:** Service object updated

---

#### **DELETE** `/api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId`
Xóa lịch giá

**Response:**
```json
{
  "message": "Đã xóa lịch giá thành công"
}
```

---

#### **PATCH** `/api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId/toggle`
Bật/tắt trạng thái active của lịch giá

**Response:** Service object với schedule.isActive toggled

---

### 2. Service Temporary Price

#### **PUT** `/api/services/:serviceId/temporary-price`
Cập nhật giá tạm thời cho Service

**Request Body:** (tất cả optional)
```json
{
  "temporaryPrice": 200000,
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-31T23:59:59.999Z"
}
```

**Response:** Service object updated

**Use Cases:**
- Set tất cả 3 fields: Áp dụng giá tạm thời với khoảng thời gian
- Set chỉ `temporaryPrice`: Áp dụng giá tạm thời vô thời hạn
- Update từng field riêng lẻ

---

#### **DELETE** `/api/services/:serviceId/temporary-price`
Xóa giá tạm thời (reset về null)

**Response:**
```json
{
  "message": "Đã xóa giá tạm thời thành công"
}
```

---

### 3. List/Get Services (Enhanced)

#### **GET** `/api/services`
List tất cả services với effective prices

**Response:**
```json
{
  "total": 50,
  "page": 1,
  "limit": 10,
  "totalPages": 5,
  "services": [
    {
      "_id": "...",
      "name": "Nhổ răng khôn",
      "hasActiveTemporaryPrice": false,
      "temporaryPrice": null,
      "startDate": null,
      "endDate": null,
      "serviceAddOns": [
        {
          "_id": "...",
          "name": "Nhổ răng khôn đơn giản",
          "price": 500000,
          "basePrice": 500000,
          "effectivePrice": 450000,
          "isPriceModified": true,
          "priceSchedules": [
            {
              "_id": "...",
              "price": 450000,
              "startDate": "2024-01-01T00:00:00.000Z",
              "endDate": "2024-01-31T23:59:59.999Z",
              "isActive": true,
              "note": "Giá khuyến mãi Tết"
            }
          ]
        }
      ]
    }
  ]
}
```

---

#### **GET** `/api/services/:id`
Get service by ID với effective prices

**Response:** Service object như trên với đầy đủ thông tin

---

## 🧮 Effective Price Calculation Logic

### ServiceAddOn
```javascript
// Priority: Active PriceSchedule > Base Price
1. Tìm priceSchedule active với:
   - isActive === true
   - currentDate >= startDate
   - currentDate <= endDate
2. Nếu có: return schedule.price
3. Nếu không: return addOn.price (giá gốc)
```

### Service Temporary Price
```javascript
// Check if temporary price is active
hasActiveTemporaryPrice() {
  return temporaryPrice !== null &&
         startDate !== null &&
         endDate !== null &&
         currentDate >= startDate &&
         currentDate <= endDate
}
```

---

## 📝 Usage Examples

### Example 1: Thêm giá khuyến mãi Tết
```javascript
// POST /api/services/64a1b2c3.../addons/64b2c3d4.../price-schedules
{
  "price": 450000,
  "startDate": "2024-01-20T00:00:00.000Z",
  "endDate": "2024-02-10T23:59:59.999Z",
  "isActive": true,
  "note": "Khuyến mãi Tết Nguyên Đán 2024"
}
```

### Example 2: Set giá tạm thời cho Service (áp dụng tất cả add-ons)
```javascript
// PUT /api/services/64a1b2c3.../temporary-price
{
  "temporaryPrice": 200000,
  "startDate": "2024-03-01T00:00:00.000Z",
  "endDate": "2024-03-31T23:59:59.999Z"
}
```

### Example 3: Tắt lịch giá tạm thời
```javascript
// PATCH /api/services/64a1b2c3.../addons/64b2c3d4.../price-schedules/64c3d4e5.../toggle
// Response: schedule.isActive toggled
```

### Example 4: Xóa giá tạm thời của Service
```javascript
// DELETE /api/services/64a1b2c3.../temporary-price
// Response: temporaryPrice, startDate, endDate → null
```

---

## 🔐 Authorization

**Tất cả các endpoint thay đổi giá yêu cầu:**
- Role: `manager` hoặc `admin`
- Header: `Authorization: Bearer <token>`

**Endpoint public (GET only):**
- `GET /api/services` - List services with effective prices
- `GET /api/services/:id` - Get service detail with effective prices

---

## ⚠️ Validation Rules

1. **Date Range:**
   - `endDate` phải > `startDate`
   - Tự động validate trong schema

2. **Price:**
   - Phải >= 0
   - Required khi thêm mới priceSchedule

3. **Active Status:**
   - Default: `true`
   - Có thể toggle bất kỳ lúc nào

4. **Note:**
   - Optional
   - Max length: 500 characters

---

## 🎯 Best Practices

### 1. Multiple Price Schedules
```javascript
// ServiceAddOn có thể có nhiều schedules
// Hệ thống tự động chọn schedule active với currentDate
priceSchedules: [
  {
    price: 450000,
    startDate: "2024-01-01",
    endDate: "2024-01-31",
    isActive: true,
    note: "Tháng 1"
  },
  {
    price: 480000,
    startDate: "2024-02-01",
    endDate: "2024-02-28",
    isActive: true,
    note: "Tháng 2"
  }
]
```

### 2. Temporary Price vs Price Schedule
- **Temporary Price**: Áp dụng cho toàn bộ Service (hiếm khi dùng)
- **Price Schedule**: Áp dụng riêng cho từng ServiceAddOn (recommended)

### 3. Deactivate Instead of Delete
```javascript
// Thay vì xóa, nên toggle isActive = false
// PATCH /api/services/:serviceId/addons/:addOnId/price-schedules/:scheduleId/toggle
```

### 4. Future Schedules
```javascript
// Có thể tạo lịch giá tương lai
{
  price: 500000,
  startDate: "2024-06-01",  // Tương lai
  endDate: "2024-06-30",
  isActive: true,
  note: "Giá mùa hè"
}
// Sẽ tự động active khi đến ngày
```

---

## 🔄 Migration Notes

**Existing Services:**
- Không cần migration
- Các field mới là optional
- Giá gốc (`price`) vẫn hoạt động bình thường

**Backward Compatible:**
- ✅ GET APIs trả về thêm `effectivePrice`
- ✅ Không breaking existing clients
- ✅ Frontend có thể check `isPriceModified` để hiển thị badge

---

## 📊 Frontend Display Recommendations

### ServiceList.jsx
```javascript
{service.serviceAddOns.map(addOn => (
  <div>
    <span>{addOn.name}</span>
    {addOn.isPriceModified ? (
      <>
        <span className="original-price">{addOn.basePrice.toLocaleString()}đ</span>
        <span className="effective-price">{addOn.effectivePrice.toLocaleString()}đ</span>
        <Tag color="red">Khuyến mãi</Tag>
      </>
    ) : (
      <span>{addOn.price.toLocaleString()}đ</span>
    )}
  </div>
))}
```

### ServiceDetails.jsx
- Add section "Quản lý lịch giá"
- Table hiển thị `priceSchedules` với actions (Edit/Delete/Toggle)
- Form để thêm/sửa price schedule
- Date range picker
- Active/Inactive badge

---

## 🧪 Testing Checklist

- [ ] Tạo service mới không có price schedule (optional fields)
- [ ] Thêm price schedule cho ServiceAddOn
- [ ] Update price schedule
- [ ] Toggle active/inactive
- [ ] Delete price schedule
- [ ] Set temporary price cho Service
- [ ] Remove temporary price
- [ ] GET services trả về effectivePrice đúng
- [ ] Validate endDate > startDate
- [ ] Authorization check (403 nếu không phải manager/admin)
- [ ] Multiple overlapping schedules (chọn đúng theo date)

---

## 📚 Related Files

**Backend:**
- `models/service.model.js` - Schema definitions & methods
- `services/service.service.js` - Business logic
- `controllers/service.controller.js` - HTTP handlers
- `routes/service.route.js` - Route definitions

**Frontend (TODO):**
- `services/servicesService.js` - API client methods
- `pages/ServiceList.jsx` - Display effective prices
- `pages/ServiceDetails.jsx` - Manage price schedules

---

## 🎉 Summary

Hệ thống Price Schedule Management cung cấp:
✅ Flexible pricing với date ranges
✅ Multiple schedules per ServiceAddOn
✅ Simple temporary price for Service
✅ Auto-calculate effective prices
✅ Backward compatible
✅ Manager/Admin only access
✅ Easy to extend

**Next Steps:**
1. ✅ Backend implementation (DONE)
2. ⏳ Frontend API service methods
3. ⏳ Frontend UI components
4. ⏳ Testing & validation

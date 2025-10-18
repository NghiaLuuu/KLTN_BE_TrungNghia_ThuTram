# 📋 API CẬP NHẬT LỊCH KHÁM (REACTIVE SCHEDULING)

## 🔗 Endpoint
```
PUT http://localhost:3005/api/schedule/:scheduleId
```

## 🎯 Mục đích
API này cho phép **Admin** cập nhật lịch khám đã tạo, bao gồm:
- Bật/tắt trạng thái hoạt động của lịch
- Kích hoạt lại các ca làm việc đã tắt (chỉ áp dụng cho ca chưa generate slots)
- Kích hoạt lại các buồng khám đã tắt

## 🔐 Phân quyền
- **Chỉ Admin** được phép sử dụng API này
- Yêu cầu header: `Authorization: Bearer <token>`

---

## 📥 Request

### URL Parameters
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `scheduleId` | String (ObjectId) | ✅ Có | ID của lịch cần cập nhật |

**Ví dụ:** `68f2675d4303bdd9b258a7d3`

### Body Parameters
| Tham số | Kiểu | Bắt buộc | Mô tả |
|---------|------|----------|-------|
| `isActive` | Boolean | ❌ Không | Bật/tắt trạng thái hoạt động của lịch |
| `reactivateShifts` | Array[String] | ❌ Không | Danh sách key các ca cần kích hoạt lại (ví dụ: `["morning", "afternoon"]`) |
| `reactivateSubRooms` | Array[String] | ❌ Không | Danh sách ID các buồng khám cần kích hoạt lại |

### Headers
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

---

## 📤 Response

### ✅ Success Response (200)
```json
{
  "success": true,
  "message": "Cập nhật lịch thành công",
  "data": {
    "message": "Cập nhật lịch thành công",
    "scheduleId": "68f2675d4303bdd9b258a7d3",
    "changes": [
      "Toggle isActive: Bật lịch",
      "Kích hoạt lại ca: Sáng",
      "Kích hoạt lại buồng: 67890xyz"
    ]
  }
}
```

### ❌ Error Responses

#### 403 Forbidden - Không có quyền
```json
{
  "success": false,
  "message": "Chỉ admin mới được phép chỉnh sửa lịch"
}
```

#### 400 Bad Request - Thiếu schedule ID
```json
{
  "success": false,
  "message": "Schedule ID là bắt buộc"
}
```

#### 400 Bad Request - Dữ liệu không hợp lệ
```json
{
  "success": false,
  "message": "reactivateShifts phải là mảng"
}
```

#### 404 Not Found - Không tìm thấy lịch
```json
{
  "success": false,
  "message": "Không tìm thấy lịch"
}
```

#### 400 Bad Request - Ca đã hoạt động
```json
{
  "success": false,
  "message": "Ca morning đang hoạt động, không thể thay đổi (chỉ cho phép kích hoạt lại ca đã tắt)"
}
```

#### 400 Bad Request - Ca đã generate
```json
{
  "success": false,
  "message": "Ca morning đã được tạo slots, không thể kích hoạt lại"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Không thể cập nhật lịch"
}
```

---

## 📝 Chi tiết chức năng

### 1️⃣ Toggle trạng thái lịch (`isActive`)
- **Mục đích:** Bật/tắt toàn bộ lịch khám
- **Logic:**
  - `true`: Kích hoạt lịch → bệnh nhân có thể đặt khám
  - `false`: Tạm ngưng lịch → bệnh nhân không thể đặt khám
- **Điều kiện:** Không có ràng buộc
- **Áp dụng cho:** Cả lịch của phòng chính và buồng khám

### 2️⃣ Kích hoạt lại ca làm việc (`reactivateShifts`)
- **Mục đích:** Bật lại các ca đã tắt để có thể tạo slots
- **Logic:**
  - Chỉ cho phép chuyển `false → true` (không cho phép `true → false`)
  - Không thể kích hoạt lại nếu ca đã generate slots (`isGenerated = true`)
- **Điều kiện:**
  - ✅ Cho phép: Ca đang tắt (`isActive = false`) và chưa generate (`isGenerated = false`)
  - ❌ Không cho phép: Ca đang hoạt động hoặc đã generate slots
- **Ví dụ:**
  ```json
  {
    "reactivateShifts": ["morning", "evening"]
  }
  ```
- **Lưu ý:** 
  - Sau khi kích hoạt lại, cần gọi API **Add Missing Shifts** để tạo slots cho ca đó
  - Không thể deactivate ca (tắt ca) qua API này để tránh xung đột với lịch hẹn đã có

### 3️⃣ Kích hoạt lại buồng khám (`reactivateSubRooms`)
- **Mục đích:** Bật lại các buồng khám đã tắt
- **Logic:**
  - Tìm schedule của từng buồng khám (theo `roomId`, `subRoomId`, `month`, `year`)
  - Chuyển `isActiveSubRoom` từ `false → true`
  - Clear cache để cập nhật ngay lập tức
- **Điều kiện:**
  - ✅ Cho phép: Buồng đang tắt (`isActiveSubRoom = false`)
  - ℹ️ Bỏ qua: Buồng đang hoạt động hoặc không tìm thấy schedule
- **Ví dụ:**
  ```json
  {
    "reactivateSubRooms": ["67890xyz", "12345abc"]
  }
  ```

---

## 🔧 Use Cases (Tình huống sử dụng)

### Use Case 1: Bật lại lịch đã tạm ngưng
**Tình huống:** Admin tạm dừng lịch phòng do sửa chữa, giờ muốn bật lại.

**Request:**
```http
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "isActive": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cập nhật lịch thành công",
  "data": {
    "message": "Cập nhật lịch thành công",
    "scheduleId": "68f2675d4303bdd9b258a7d3",
    "changes": ["Toggle isActive: Bật lịch"]
  }
}
```

---

### Use Case 2: Kích hoạt lại ca tối đã bị tắt
**Tình huống:** Tháng 10, phòng P01 ban đầu chỉ mở ca sáng và chiều. Giờ muốn thêm ca tối.

**Bước 1: Kích hoạt lại ca tối**
```http
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "reactivateShifts": ["evening"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cập nhật lịch thành công",
  "data": {
    "changes": ["Kích hoạt lại ca: Tối"]
  }
}
```

**Bước 2: Tạo slots cho ca tối (gọi API Add Missing Shifts)**
```http
POST http://localhost:3005/api/schedule/add-missing-shifts
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "roomId": "room123",
  "month": 10,
  "year": 2025,
  "selectedShifts": ["evening"]
}
```

---

### Use Case 3: Kích hoạt lại buồng khám
**Tình huống:** Buồng B02 tạm đóng cửa do thiết bị bảo trì, giờ muốn mở lại.

**Request:**
```http
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "reactivateSubRooms": ["67890xyz"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cập nhật lịch thành công",
  "data": {
    "changes": ["Kích hoạt lại buồng: 67890xyz"]
  }
}
```

---

### Use Case 4: Cập nhật tổng hợp (kết hợp nhiều thay đổi)
**Request:**
```http
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Content-Type: application/json
Authorization: Bearer <admin_token>

{
  "isActive": true,
  "reactivateShifts": ["evening"],
  "reactivateSubRooms": ["67890xyz", "12345abc"]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Cập nhật lịch thành công",
  "data": {
    "changes": [
      "Toggle isActive: Bật lịch",
      "Kích hoạt lại ca: Tối",
      "Kích hoạt lại buồng: 67890xyz",
      "Kích hoạt lại buồng: 12345abc"
    ]
  }
}
```

---

## ⚠️ Lưu ý quan trọng

### 1. Không thể tắt ca đã hoạt động
- API này **KHÔNG CHO PHÉP** tắt ca (`true → false`)
- Lý do: Tránh xung đột với lịch hẹn bệnh nhân đã đặt
- Giải pháp: Nếu cần tắt ca, phải xóa thủ công hoặc dùng API khác

### 2. Không thể kích hoạt ca đã generate
- Nếu ca đã có slots (`isGenerated = true`), không thể kích hoạt lại
- Lý do: Dữ liệu đã tồn tại, không thể thay đổi trạng thái
- Giải pháp: Tạo lịch mới hoặc xóa schedule cũ

### 3. Cascade effect (Hiệu ứng dây chuyền)
- Tắt lịch (`isActive = false`) sẽ ảnh hưởng đến tất cả các slots
- Bật lại lịch chỉ phục hồi trạng thái, không tự động tạo slots mới

### 4. Cache management
- API tự động xóa Redis cache sau khi cập nhật
- Đảm bảo dữ liệu mới được phản ánh ngay lập tức

### 5. Không có rollback tự động
- Nếu update một phần thất bại, phần thành công vẫn được lưu
- Cần xử lý rollback thủ công nếu cần

---

## 🔗 API liên quan

### 1. Xem thông tin lịch
```http
GET http://localhost:3005/api/schedule/room/:roomId/shifts?month=10&year=2025
```

### 2. Thêm ca thiếu vào lịch
```http
POST http://localhost:3005/api/schedule/add-missing-shifts
```

### 3. Tạo lịch mới cho phòng
```http
POST http://localhost:3005/api/schedule/room/generate
```

### 4. Toggle trạng thái lịch (deprecated)
```http
PATCH http://localhost:3005/api/schedule/:id/active
```

---

## 📊 Database Schema

### Schedule Collection
```javascript
{
  _id: ObjectId("68f2675d4303bdd9b258a7d3"),
  roomId: ObjectId("room123"),
  subRoomId: ObjectId("subroom456"), // null nếu là phòng chính
  month: 10,
  year: 2025,
  isActive: true, // 🔧 Có thể thay đổi qua API
  isActiveSubRoom: true, // 🔧 Có thể thay đổi qua API (chỉ áp dụng cho buồng)
  shiftConfig: {
    morning: {
      name: "Sáng",
      isActive: true, // 🔧 Có thể kích hoạt lại nếu false và chưa generate
      isGenerated: false, // Đã tạo slots hay chưa
      startTime: "08:00",
      endTime: "12:00"
    },
    afternoon: { ... },
    evening: { ... }
  },
  createdAt: ISODate("2025-10-18T..."),
  updatedAt: ISODate("2025-10-18T...") // 🔧 Tự động cập nhật
}
```

---

## 🧪 Testing với Postman

### Test 1: Bật lại lịch
```javascript
// Request
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Headers: Authorization: Bearer {{admin_token}}
Body:
{
  "isActive": true
}

// Expected: Success 200
// Expected changes: ["Toggle isActive: Bật lịch"]
```

### Test 2: Kích hoạt nhiều ca
```javascript
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Body:
{
  "reactivateShifts": ["morning", "evening"]
}

// Expected: Success 200 hoặc Error 400 nếu ca đã active/generated
```

### Test 3: Kích hoạt buồng khám
```javascript
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Body:
{
  "reactivateSubRooms": ["67890xyz"]
}

// Expected: Success 200
```

### Test 4: Unauthorized (không phải admin)
```javascript
PUT http://localhost:3005/api/schedule/68f2675d4303bdd9b258a7d3
Headers: Authorization: Bearer {{manager_token}}
Body: {}

// Expected: Error 403 "Chỉ admin mới được phép chỉnh sửa lịch"
```

---

## 📞 Liên hệ & Hỗ trợ
- **Backend Service:** schedule-service (Port 3005)
- **Author:** HoTram, TrungNghia
- **Version:** 1.0
- **Last Updated:** October 2025

---

## 🎓 Tổng kết

API này là phần quan trọng của **Reactive Scheduling** - cho phép admin điều chỉnh lịch linh hoạt mà không cần tạo lại từ đầu. 

**Quy trình thực tế:**
1. Kiểm tra lịch hiện tại (GET)
2. Xác định ca/buồng cần kích hoạt lại
3. Gọi API Update Schedule (PUT)
4. Nếu kích hoạt lại ca: Gọi API Add Missing Shifts để tạo slots
5. Xác nhận thay đổi qua UI hoặc GET API

**Best Practices:**
- Luôn kiểm tra `changes` trong response để biết chính xác điều gì đã thay đổi
- Không kích hoạt lại nhiều ca cùng lúc nếu không cần thiết
- Backup dữ liệu trước khi thực hiện thay đổi quan trọng
- Monitor Redis cache để đảm bảo dữ liệu được cập nhật

# 📋 API Testing Documentation - Schedule Service (Version 2.0)

## 🔧 Base Configuration
- **Base URL**: `http://localhost:3000` (hoặc port của schedule-service)
- **Content-Type**: `application/json`
- **Authorization**: Bearer token (cho các API cần quyền admin/manager)

## 🚀 Workflow Khởi Tạo và Sử Dụng Hệ Thống

### **Bước 1: Khởi tạo hệ thống**
1. `GET /api/schedule-config/exists` - Kiểm tra cấu hình
2. `POST /api/schedule-config/initialize` - Khởi tạo (nếu chưa có)

### **Bước 2: Tạo lịch làm việc**  
1. `GET /api/schedules/quarters/available` - Xem quý có thể tạo
2. `POST /api/schedules/quarter` - Tạo lịch cho cả quý (tất cả phòng)

### **Bước 3: Phân công nhân sự**
1. `POST /api/slots/assign-staff` - Phân công nhân sự theo room/subroom/ca
2. `PATCH /api/slots/{slotId}/staff` - Cập nhật nhân sự cụ thể

### **Bước 4: Sử dụng và quản lý**
1. `GET /api/slots/available` - Xem slot khả dụng để booking
2. `GET /api/schedules/quarter/status` - Kiểm tra trạng thái quý

---

## 🗓️ 1. SCHEDULE CONFIG APIs

### 1.1 Check Configuration Exists
**Kiểm tra xem đã có cấu hình hệ thống chưa**

```http
GET /api/schedule-config/exists
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "exists": false
  }
}
```

### 1.2 Initialize Configuration  
**Khởi tạo cấu hình hệ thống với 3 ca cố định (Admin/Manager only)**

```http
POST /api/schedule-config/initialize
Authorization: Bearer <admin_token>
```

**Response Example:**
```json
{
  "success": true,
  "message": "Khởi tạo cấu hình hệ thống thành công",
  "data": {
    "_id": "66f2a1234567890abcdef123",
    "singletonKey": "SCHEDULE_CONFIG_SINGLETON",
    "morningShift": {
      "name": "Ca Sáng",
      "startTime": "08:00",
      "endTime": "12:00",
      "isActive": true
    },
    "afternoonShift": {
      "name": "Ca Chiều", 
      "startTime": "13:00",
      "endTime": "17:00",
      "isActive": true
    },
    "eveningShift": {
      "name": "Ca Tối",
      "startTime": "18:00",
      "endTime": "21:00", 
      "isActive": true
    },
  "unitDuration": 15,
  "maxBookingDays": 30
  }
}
```

### 1.3 Get Schedule Configuration
**Lấy cấu hình lịch làm việc hiện tại**

```http
GET /api/schedule-config
```

### 1.4 Update Configuration
**Cập nhật thời gian ca làm việc (Admin/Manager only)**

```http
PUT /api/schedule-config
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "morningShift": {
    "startTime": "07:30",
    "endTime": "11:30"
  },
  "afternoonShift": {
    "startTime": "13:30", 
    "endTime": "17:30"
  },
  "eveningShift": {
    "startTime": "18:30",
    "endTime": "21:30"
  },
  "unitDuration": 20
}
```

---

## 🗓️ 2. SCHEDULE APIs

### 2.1 Get Available Quarters
**Lấy danh sách quý có thể tạo lịch**

```http
GET /api/schedules/quarters/available
```

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "quarter": 3,
      "year": 2025,
      "label": "Quý 3/2025",
      "isCurrent": true
    },
    {
      "quarter": 4, 
      "year": 2025,
      "label": "Quý 4/2025",
      "isCurrent": false
    },
    {
      "quarter": 1,
      "year": 2026,
      "label": "Quý 1/2026", 
      "isCurrent": false
    }
  ]
}
```

### 2.2 Generate Quarter Schedule
**Tạo lịch cho cả quý (tất cả phòng) - Auto tính theo thời gian VN (Admin/Manager only)**

```http
POST /api/schedules/quarter
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "quarter": 4,
  "year": 2025
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Tạo lịch quý 4/2025 thành công",
  "data": {
    "quarter": 4,
    "year": 2025,
    "startDate": "2025-10-01T00:00:00.000Z",
    "endDate": "2025-12-31T00:00:00.000Z",
    "totalRooms": 5,
    "successCount": 5,
    "results": [
      {
        "roomId": "room1_id",
        "roomName": "Phòng Khám Tổng Quát 1",
        "success": true,
        "scheduleCount": 65,
        "message": "Tạo thành công 65 lịch"
      },
      {
        "roomId": "room2_id", 
        "roomName": "Phòng Phẫu Thuật 1",
        "success": true,
        "scheduleCount": 65,
        "message": "Tạo thành công 65 lịch"
      }
    ]
  }
}
```

### 2.3 Get Quarter Status
**Kiểm tra trạng thái tạo lịch của một quý**

```http
GET /api/schedules/quarter/status?quarter=4&year=2025
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "quarter": 4,
    "year": 2025,
    "startDate": "2025-10-01T00:00:00.000Z",
    "endDate": "2025-12-31T00:00:00.000Z", 
    "totalRooms": 5,
    "roomsWithSchedule": 3,
    "totalSchedules": 195,
    "rooms": [
      {
        "roomId": "room1_id",
        "roomName": "Phòng Khám Tổng Quát 1",
        "hasSchedule": true,
        "scheduleCount": 65
      },
      {
        "roomId": "room2_id",
        "roomName": "Phòng Chờ",
        "hasSchedule": false, 
        "scheduleCount": 0
      }
    ]
  }
}
```

### 2.4 Get Schedules by Room
**Lấy lịch làm việc theo phòng và khoảng thời gian**

```http
GET /api/schedules/room/{{roomId}}?startDate=2025-10-01&endDate=2025-10-31
```

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "schedule1_id",
      "roomId": "room1_id", 
      "date": "2025-10-01T00:00:00.000Z",
      "workShifts": [
        {
          "name": "Ca Sáng",
          "startTime": "08:00",
          "endTime": "12:00",
          "isActive": true
        },
        {
          "name": "Ca Chiều",
          "startTime": "13:00", 
          "endTime": "17:00",
          "isActive": true
        }
      ],
      "isActive": true
    }
  ]
}
```

### 2.5 Get All Schedules by Date Range
**Lấy tất cả lịch làm việc theo khoảng thời gian**

```http
GET /api/schedules?startDate=2025-10-01&endDate=2025-10-07
```

### 2.6 Delete Schedule
**Xóa lịch làm việc (và tất cả slot liên quan) (Admin/Manager only)**

```http
DELETE /api/schedules/{{scheduleId}}
Authorization: Bearer <admin_token>
```

**Response Example:**
```json
{
  "success": true,
  "message": "Xóa lịch thành công"
}
```

---

## 🎯 3. SLOT APIs

### 3.1 Assign Staff to Slots
**Phân công nhân sự cho slot theo room/subroom và ca (Admin/Manager only)**

```http
POST /api/slots/assign-staff
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body cho phòng CÓ subroom (1-1 constraint):**
```json
{
  "roomId": "66f2a1234567890abcdef123",
  "subRoomId": "66f2a1234567890abcdef456", 
  "date": "2025-10-01",
  "shifts": ["Ca Sáng", "Ca Chiều"],
  "dentistIds": ["dentist1_id"],
  "nurseIds": ["nurse1_id"]
}
```

**Request Body cho phòng KHÔNG có subroom (maxDoctor/maxNurse constraint):**
```json
{
  "roomId": "66f2a1234567890abcdef123",
  "subRoomId": null,
  "date": "2025-10-01", 
  "shifts": ["Ca Sáng", "Ca Tối"],
  "dentistIds": ["dentist1_id", "dentist2_id"],
  "nurseIds": ["nurse1_id", "nurse2_id", "nurse3_id"]
}
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "message": "Phân công nhân sự thành công cho 32 slot",
    "slotsUpdated": 32,
    "shifts": ["Ca Sáng", "Ca Chiều"],
    "dentistAssigned": "dentist1_id",
    "nurseAssigned": "nurse1_id"
  }
}
```

### 3.2 Update Slot Staff
**Cập nhật nhân sự cho slot cụ thể (Admin/Manager only)**

```http
PATCH /api/slots/{{slotId}}/staff
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "dentistId": "new_dentist_id",
  "nurseId": "new_nurse_id"
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Cập nhật nhân sự slot thành công",
  "data": {
    "_id": "slot1_id",
    "roomId": "room1_id",
    "subRoomId": "subroom1_id",
    "date": "2025-10-01T00:00:00.000Z",
    "shiftName": "Ca Sáng",
    "startTime": "2025-10-01T01:00:00.000Z",
    "endTime": "2025-10-01T01:15:00.000Z",
    "dentist": "new_dentist_id",
    "nurse": "new_nurse_id", 
    "isBooked": false,
    "isActive": true
  }
}
```

### 3.3 Get Available Slots
**Lấy slot khả dụng để booking (có đủ nhân sự, chưa được đặt)**

```http
GET /api/slots/available?roomId={{roomId}}&date=2025-10-01&shiftName=Ca Sáng
```

**Query Parameters:**
- `roomId` (required): ID phòng
- `subRoomId` (optional): ID subroom nếu có
- `date` (required): Ngày cần xem (YYYY-MM-DD)
- `shiftName` (optional): Tên ca làm việc
- `serviceId` (optional): ID dịch vụ để filter

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "slot1_id",
      "roomId": "room1_id",
      "subRoomId": "subroom1_id",
      "date": "2025-10-01T00:00:00.000Z",
      "shiftName": "Ca Sáng",
      "startTime": "2025-10-01T01:00:00.000Z",
      "endTime": "2025-10-01T01:15:00.000Z",
      "dentist": "dentist1_id",
      "nurse": "nurse1_id",
      "isBooked": false,
      "isActive": true,
      "dateVN": "2025-10-01",
      "startTimeVN": "08:00",
      "endTimeVN": "08:15"
    }
  ]
}
```

### 3.4 Get Slots by Room
**Lấy slot theo phòng và khoảng thời gian**

```http
GET /api/slots/room/{{roomId}}?startDate=2025-10-01&endDate=2025-10-07
```

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "slot1_id",
      "roomId": "room1_id",
      "subRoomId": "subroom1_id", 
      "date": "2025-10-01T00:00:00.000Z",
      "shiftName": "Ca Sáng",
      "startTime": "2025-10-01T01:00:00.000Z",
      "endTime": "2025-10-01T01:15:00.000Z",
      "dentist": "dentist1_id",
      "nurse": "nurse1_id",
      "isBooked": true,
      "appointmentId": "appointment1_id",
      "isActive": true
    }
  ]
}
```

### 3.5 Get Slots by Staff
**Lấy lịch làm việc của nhân viên theo khoảng thời gian**

```http
GET /api/slots/staff/{{staffId}}/{{staffType}}?startDate=2025-10-01&endDate=2025-10-07
```

**Path Parameters:**
- `staffId`: ID nhân viên
- `staffType`: `dentist` hoặc `nurse`

**Response Example:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "slot1_id",
      "roomId": "room1_id",
      "subRoomId": "subroom1_id",
      "date": "2025-10-01T00:00:00.000Z", 
      "shiftName": "Ca Sáng",
      "startTime": "2025-10-01T01:00:00.000Z",
      "endTime": "2025-10-01T01:15:00.000Z",
      "dentist": "dentist1_id",
      "nurse": "nurse1_id",
      "isBooked": false,
      "isActive": true
    }
  ]
}
```

---

## 🏥 4. HOLIDAY APIs

### 4.1 Get Holidays
**Lấy danh sách kỳ nghỉ**

```http
GET /api/schedule-config/holidays
```

### 4.2 Add Holiday
**Thêm kỳ nghỉ mới (Admin/Manager only)**

```http
POST /api/schedule-config/holidays
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Tết Nguyên Đán 2026",
  "startDate": "2026-01-28",
  "endDate": "2026-02-05", 
  "note": "Nghỉ Tết Nguyên Đán"
}
```

### 4.3 Update Single Holiday
**Cập nhật một kỳ nghỉ cụ thể (Admin/Manager only)**

```http
PATCH /api/schedule-config/holidays/{{holidayId}}
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body (partial update):**
```json
{
  "name": "Tết Nguyên Đán 2027",
  "startDate": "2027-01-28",
  "endDate": "2027-02-05",
  "note": "Nghỉ Tết Nguyên Đán - cập nhật"
}
```

### 4.4 Update Holidays List
**Cập nhật toàn bộ danh sách nghỉ (Admin/Manager only)**

```http
PUT /api/schedule-config/holidays
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### 4.5 Remove Holiday
**Xóa kỳ nghỉ (Admin/Manager only)**

```http
DELETE /api/schedule-config/holidays/{{holidayId}}
Authorization: Bearer <admin_token>
```

---

## 🔍 5. TEST SCENARIOS

### Scenario 1: Khởi tạo hệ thống từ đầu
```
1. GET /api/schedule-config/exists
2. POST /api/schedule-config/initialize (nếu chưa có)
3. GET /api/schedules/quarters/available
4. POST /api/schedules/quarter (tạo quý hiện tại)
```

### Scenario 2: Phân công nhân sự 
```
1. GET /api/schedules/quarter/status (kiểm tra đã tạo lịch chưa)
2. POST /api/slots/assign-staff (phân công theo room/ca)
3. GET /api/slots/available (kiểm tra slot khả dụng)
```

### Slot APIs (chi tiết)

3.1 POST /api/slots/assign-staff
- Mô tả: Phân công dentist/nurse cho các slot theo ngày hoặc theo schedule (quý). Chỉ manager/admin.
- Body (day-level): { roomId, subRoomId?, date, shifts[], dentistIds[], nurseIds[] }
- Body (schedule-level): { scheduleId, subRoomId?, shifts[], dentistIds[], nurseIds[] }
- Response: { success: true, data: { updatedCount, details: [...] } }

3.2 PATCH /api/slots/{slotId}/staff
- Mô tả: Cập nhật dentist/nurse cho 1 slot hoặc nhóm slot cùng appointment.
- Body single: { dentistId?, nurseId? }
- Body group: { groupSlotIds: ["id1","id2"], dentistId?, nurseId? }
- Response: { success: true, message, data: { slot } }

3.3 GET /api/slots/available
- Mô tả: Lấy các slot khả dụng (không booked) cho room/date
- Query: roomId (required), date (YYYY-MM-DD, required), shiftName?, serviceId?, subRoomId?
- Response: { success: true, data: [ slotObjects ] }

3.4 GET /api/slots/room/{roomId}
- Mô tả: Lấy slot theo phòng trong khoảng ngày
- Query: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)

3.5 GET /api/slots/staff/{staffId}/{staffType}
- Mô tả: Lấy slot gán cho dentist/nurse trong khoảng
- Query: startDate, endDate

### Scenario 3: Booking workflow
```
1. GET /api/slots/available (tìm slot trống)
2. PATCH /api/slots/{slotId}/staff (cập nhật nếu cần)
3. [Booking qua appointment service]
```

---

## ⚠️ ERROR RESPONSES

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Quarter và year là bắt buộc"
}
```

**403 Forbidden:**
```json
{
  "success": false,
  "message": "Chỉ quản lý hoặc admin mới được phép"
}
```

**500 Internal Server Error:**
```json
{
  "success": false,
  "message": "Không thể tạo lịch quý: Lỗi kết nối database"
}
```

---

## 🎯 POSTMAN ENVIRONMENT VARIABLES

Tạo environment với các biến:
```
base_url: http://localhost:3000
admin_token: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
manager_token: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
room_id: 66f2a1234567890abcdef123
dentist_id: 66f2a1234567890abcdef456
nurse_id: 66f2a1234567890abcdef789
```

**Happy Testing! 🚀**
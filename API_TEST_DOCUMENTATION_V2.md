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
2. `POST /api/schedules/quarter**Use Cases:**
- **Daily View (day)**: Xem chi tiết lịch từng ngày, có thể xem nhiều ngày liên tiếp
- **Weekly View (week)**: Xem lịch theo tuần (Thứ 2 đến Chủ nhật), có thể xem nhiều tuần
- **Monthly View (month)**: Xem tổng quan lịch theo tháng, có thể xem nhiều tháng

**Example URLs:**
```bash
# Xem 3 tuần từ tuần hiện tại (bắt đầu từ thứ 2)
GET /api/slot/room/68ce653588cb082c71449edd/calendar?viewType=week&limit=3

# Xem 5 ngày từ ngày 2025-09-23
GET /api/slot/room/68ce653588cb082c71449edd/calendar?viewType=day&startDate=2025-09-23&limit=5

# Xem 2 tháng từ tháng 9/2025 (tháng 9 và 10)
GET /api/slot/room/68ce653588cb082c71449edd/calendar?viewType=month&startDate=2025-09-01&limit=2

# Xem trang 2 của tuần (tuần 3-4 từ tuần hiện tại)
GET /api/slot/room/68ce653588cb082c71449edd/calendar?viewType=week&page=2&limit=2

# Xem subroom cụ thể 
GET /api/slot/room/68ce653588cb082c71449edd/calendar?viewType=week&subRoomId=68ce653588cb082c71449edf
```

**Features:**
- Phân trang linh hoạt cho lịch theo ngày/tuần/tháng
- Logic ngày thông minh: tự động tính thứ 2 của tuần, đầu tháng
- Có thể xem quá khứ và tương lai bằng cách thay đổi startDate
- Đếm số lượng bệnh nhân đã đặt lịch (unique appointmentId)
- Hiển thị dạng ô màu xanh lá như trong hình
- Group theo ca làm việc
- **Thông tin nhân sự chi tiết: dentistId, dentistName, nurseId, nurseName**
- **Lấy tên nhân sự từ Redis users_cache**
- **Thông tin tổng quan ca làm việc từ scheduleConfig: tên ca, giờ bắt đầu, giờ kết thúc**
- **Thông tin thống kê nhân sự: nha sỹ và y tá xuất hiện nhiều nhất trong từng ca**
- **Tên phòng và ghế từ Redis rooms_cache**
- Thông tin slot có nhân sự hay chưa (hasStaff)o cả quý (tất cả phòng)

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

### 3.1 Assign Staff to Slots (PHẢI phân công theo quý)
**Phân công nhân sự cho nhiều slot trong 1 phòng (hoặc 1 subroom) theo quý — Admin/Manager only**

```http
POST /api/slots/assign-staff
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Validation:** API này kiểm tra dentistIds và nurseIds từ Redis users_cache để đảm bảo ID hợp lệ và có role phù hợp.

Trường bắt buộc:
- `roomId` (string)
- `quarter` (number) — 1..4
- `year` (number)
- `shifts` (array[string]) — ít nhất 1 ca, ví dụ `["Ca Sáng"]`

Tuỳ chọn:
- `subRoomId` (string) — nếu phòng có subrooms (ràng buộc 1 dentist + 1 nurse)
- `dentistIds` (array[string]) — service sẽ dùng phần tử đầu tiên
- `nurseIds` (array[string]) — service sẽ dùng phần tử đầu tiên

**Request Example:**
```json
{
  "roomId": "66f2a1234567890abcdef123",
  "quarter": 4,
  "year": 2025,
  "shifts": ["Ca Sáng", "Ca Chiều"],
  "dentistIds": ["66d111aaa222bbb333ccc001"],
  "nurseIds": ["66e111aaa222bbb333ccc002"]
}
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "message": "Phân công nhân sự thành công cho 24 slot",
    "slotsUpdated": 24,
    "shifts": ["Ca Sáng","Ca Chiều"],
    "dentistAssigned": "66d111aaa222bbb333ccc001",
    "nurseAssigned": "66e111aaa222bbb333ccc002"
  }
}
```

### 3.2 Update Slot Staff (Single or Multiple)
**Cập nhật nhân sự cho 1 slot hoặc nhiều slot cùng lúc (Admin/Manager only)**

```http
PATCH /api/slots/staff
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**New Features:**
- Hỗ trợ cập nhật 1 slot (single) hoặc nhiều slot (multiple)
- Validation dentistId/nurseId từ Redis users_cache
- Conflict detection: Kiểm tra overlap thời gian với slot khác
- Backward compatibility với single slot update

**Request Body (Single Slot):**
```json
{
  "slotIds": "slot_id_string",
  "dentistId": "66d111aaa222bbb333ccc010",
  "nurseId": "66e111aaa222bbb333ccc020"
}
```

**Request Body (Multiple Slots):**
```json
{
  "slotIds": ["slotId1", "slotId2", "slotId3"],
  "dentistId": "66d111aaa222bbb333ccc010",
  "nurseId": "66e111aaa222bbb333ccc020"
}
```

**Response Example:**
```json
{
  "success": true,
  "message": "Cập nhật nhân sự cho 3 slot thành công",
  "data": [
    {
      "_id": "slot1_id",
      "roomId": "room1_id",
      "subRoomId": "subroom1_id",
      "shiftName": "Ca Sáng",
      "startTime": "2025-10-01T01:00:00.000Z",
      "endTime": "2025-10-01T01:15:00.000Z",
      "dentist": "66d111aaa222bbb333ccc010",
      "nurse": "66e111aaa222bbb333ccc020",
      "isBooked": false,
      "isActive": true
    }
  ]
}
```

### 3.3 Get Slots by Shift and Date (NEW)
**Lấy danh sách slot theo ca và ngày để dễ dàng chọn slot cập nhật**

```http
GET /api/slots/by-shift?roomId={{roomId}}&date=2024-12-01&shiftName=Ca Sáng&subRoomId={{subRoomId}}
```

**Query Parameters:**
- `roomId` (required): ID phòng
- `date` (required): Ngày cần xem (YYYY-MM-DD)
- `shiftName` (required): Tên ca làm việc (Ca Sáng|Ca Chiều|Ca Tối)
- `subRoomId` (optional): ID subroom nếu có

**Response Example:**
```json
{
  "success": true,
  "data": {
    "roomId": "room1_id",
    "subRoomId": "subroom1_id",
    "date": "2024-12-01",
    "shiftName": "Ca Sáng",
    "totalSlots": 8,
    "slots": [
      {
        "slotId": "slot1_id",
        "startTime": "2024-12-01T01:00:00.000Z",
        "endTime": "2024-12-01T01:15:00.000Z",
        "startTimeVN": "08:00",
        "endTimeVN": "08:15",
        "dentist": {
          "id": "dentist1_id",
          "name": "Dr. Nguyễn Văn A",
          "role": "dentist"
        },
        "nurse": {
          "id": "nurse1_id",
          "name": "Y tá Trần B",
          "role": "nurse"
        },
        "isBooked": false,
        "appointmentId": null,
        "status": "available"
      }
    ]
  }
}
```

### 3.4 Get Room Calendar (NEW) - With Pagination
**Lấy lịch phòng theo ngày/tuần/tháng với phân trang**

```http
GET /api/slot/room/{{roomId}}/calendar?viewType=week&startDate=2025-09-23&page=1&limit=4&subRoomId={{subRoomId}}
```

**Query Parameters:**
- `viewType` (required): Loại hiển thị (day|week|month)
- `startDate` (optional): Ngày bắt đầu (YYYY-MM-DD). Mặc định là ngày hiện tại
- `page` (optional): Trang hiện tại (default: 1)
- `limit` (optional): Số lượng periods per page (default: 10, max: 100)
- `subRoomId` (optional): ID subroom nếu có

**Logic ngày theo viewType:**
- **day**: Mỗi period = 1 ngày, bắt đầu từ ngày được chỉ định
- **week**: Mỗi period = 1 tuần (Thứ 2 đến Chủ nhật), bắt đầu từ thứ 2 của tuần chứa ngày được chỉ định
- **month**: Mỗi period = 1 tháng (ngày 1 đến cuối tháng), bắt đầu từ đầu tháng chứa ngày được chỉ định

**Pagination:**
- **page=1, limit=4**: Lấy 4 periods đầu tiên (4 ngày/4 tuần/4 tháng)
- **page=2, limit=4**: Lấy 4 periods tiếp theo
- **Có thể xem quá khứ và tương lai**: startDate có thể là bất kỳ ngày nào

**Response Example (Weekly View with Pagination):**
```json
{
  "success": true,
  "data": {
    "roomInfo": {
      "id": "68ce653588cb082c71449edd",
      "name": "Phòng khám Z",
      "hasSubRooms": true,
      "maxDoctors": 2,
      "maxNurses": 3,
      "isActive": true,
      "subRoom": {
        "id": "68ce653588cb082c71449ede",
        "name": "Buồng 1",
        "isActive": true
      }
    },
    "shiftOverview": {
      "Ca Sáng": {
        "name": "Ca Sáng",
        "startTime": "08:00",
        "endTime": "12:00",
        "isActive": true
      },
      "Ca Chiều": {
        "name": "Ca Chiều", 
        "startTime": "13:00",
        "endTime": "17:00",
        "isActive": true
      },
      "Ca Tối": {
        "name": "Ca Tối",
        "startTime": "18:00", 
        "endTime": "21:00",
        "isActive": true
      }
    },
    "pagination": {
      "currentPage": 1,
      "limit": 4,
      "viewType": "week",
      "currentDate": "2025-09-22",
      "hasNext": true,
      "hasPrev": false,
      "totalPeriods": 4
    },
    "periods": [
      {
        "periodIndex": 1,
        "startDate": "2025-09-22",
        "endDate": "2025-09-28",
        "viewType": "week",
        "days": [
          {
            "date": "2025-09-22",
            "shifts": {
              "Ca Sáng": {
                "slots": [
                  {
                    "slotId": "slot1_id",
                    "startTimeVN": "08:00",
                    "endTimeVN": "08:15",
                    "dentistId": "dentist1_id",
                    "dentistName": "Dr. Nguyễn Văn A",
                    "nurseId": "nurse1_id",
                    "nurseName": "Y tá Trần Thị B",
                    "hasStaff": true,
                    "isBooked": true,
                    "appointmentId": "appointment1_id"
                  }
                ],
                "appointmentCount": 4,
                "totalSlots": 8,
                "staffStats": {
                  "mostFrequentDentist": {
                    "id": "dentist1_id",
                    "name": "Dr. Nguyễn Văn A",
                    "slotCount": 6
                  },
                  "mostFrequentNurse": {
                    "id": "nurse1_id", 
                    "name": "Y tá Trần Thị B",
                    "slotCount": 7
                  }
                }
              },
              "Ca Chiều": {
                "slots": [],
                "appointmentCount": 2,
                "totalSlots": 8,
                "staffStats": {
                  "mostFrequentDentist": null,
                  "mostFrequentNurse": {
                    "id": "nurse2_id",
                    "name": "Y tá Lê Thị C", 
                    "slotCount": 4
                  }
                }
              },
              "Ca Tối": {
                "slots": [],
                "appointmentCount": 1,
                "totalSlots": 8,
                "staffStats": {
                  "mostFrequentDentist": null,
                  "mostFrequentNurse": null
                }
              }
            },
            "totalAppointments": 7,
            "totalSlots": 24
          }
        ]
      },
      {
        "periodIndex": 2,
        "startDate": "2025-09-29",
        "endDate": "2025-10-05",
        "viewType": "week",
        "days": []
      },
      {
        "periodIndex": 3,
        "startDate": "2025-10-06",
        "endDate": "2025-10-12",
        "viewType": "week", 
        "days": []
      },
      {
        "periodIndex": 4,
        "startDate": "2025-10-13",
        "endDate": "2025-10-19",
        "viewType": "week",
        "days": []
      }
    ]
  }
}
```

**Use Cases:**
- **Daily View (day)**: Xem chi tiết lịch 1 ngày
- **Weekly View (week)**: Xem lịch tuần (Thứ 2 đến Chủ Nhật)
- **Monthly View (month)**: Xem tổng quan lịch tháng

**Features:**
- Đếm số lượng bệnh nhân đã đặt lịch (unique appointmentId)
- Hiển thị dạng ô màu xanh lá như trong hình
- Group theo ca làm việc
- **Thông tin nhân sự chi tiết: dentistId, dentistName, nurseId, nurseName**
- **Lấy tên nhân sự từ Redis users_cache**
- **Thông tin tổng quan ca làm việc từ scheduleConfig: tên ca, giờ bắt đầu, giờ kết thúc**
- **Thông tin thống kê nhân sự: nha sỹ và y tá xuất hiện nhiều nhất trong từng ca**
- **Tên phòng và ghế từ Redis rooms_cache**
- Thông tin slot có nhân sự hay chưa (hasStaff)

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
3. GET /api/slots/room/{roomId}/schedule (xem lịch phòng chi tiết)
4. GET /api/slots/staff/{staffId}/schedule (xem lịch cá nhân)
```

### Scenario 3: Booking workflow mới
```
1. GET /api/slots/available-for-booking (tìm slot trống tối ưu)
2. GET /api/slots/room/{roomId}/schedule (xem chi tiết lịch phòng)
3. PATCH /api/slots/staff (cập nhật nhân sự nếu cần)
4. [Booking qua appointment service]
5. GET /api/slots/appointment/{appointmentId} (xem slot đã đặt)
```

### Scenario 4: Dashboard và quản lý
```
1. GET /api/slots/dashboard (tổng quan thống kê theo ngày)
2. GET /api/slots/room/{roomId}/schedule (chi tiết từng phòng)
3. GET /api/slots/staff/{staffId}/schedule (lịch cá nhân nhân viên)
```

### Scenario 5: Test API mới vs Legacy
```
# API mới (khuyến nghị)
1. GET /api/slots/room/{roomId}/schedule?date=2024-12-01
2. GET /api/slots/staff/{staffId}/schedule?date=2024-12-01
3. GET /api/slots/available-for-booking?date=2024-12-01

# API cũ (backward compatibility)
1. GET /api/slots/room/{roomId}?startDate=2024-12-01&endDate=2024-12-01
2. GET /api/slots/staff/{staffId}/dentist?startDate=2024-12-01&endDate=2024-12-01
3. GET /api/slots/available?roomId={roomId}&date=2024-12-01
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

**400 Staff ID Validation Error:**
```json
{
  "success": false,
  "message": "dentistId 66d111aaa222bbb333ccc001 không hợp lệ hoặc không phải nha sỹ"
}
```

**400 Group Update Required:**
```json
{
  "success": false,
  "message": "Phải cung cấp groupSlotIds (mảng ID slot) cho cập nhật nhóm"
}
```

**400 Conflict Detection Error:**
```json
{
  "success": false,
  "message": "Nha sỹ đã được phân công vào slot khác trong cùng khoảng thời gian"
}
```

**400 Redis Cache Error:**
```json
{
  "success": false,
  "message": "Lỗi kiểm tra thông tin nhân sự: users_cache không tồn tại"
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
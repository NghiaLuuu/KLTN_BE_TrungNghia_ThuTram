# Calendar API Refactor - Slot Details Separation

## Tóm tắt thay đổi

Đã refactor calendar APIs để:
1. **Enforce limit=1 cho week/month views** - Chỉ trả về 1 tuần hoặc 1 tháng duy nhất
2. **Xóa slot details khỏi calendar responses** - Calendar chỉ trả về summary (counts, stats)
3. **Tạo API mới để lấy slot details** - Các endpoint riêng biệt để xem chi tiết slot

---

## Calendar APIs (Refactored)

### 1. GET /api/slots/room/:roomId/calendar

**Changes:**
- ⭐ `limit` tự động = 1 khi `viewType` là `week` hoặc `month`
- ⭐ Response không còn `slots` array trong mỗi shift
- Chỉ trả về: `appointmentCount`, `totalSlots`, `staffStats`

**Query Parameters:**
```
roomId: string (required)
subRoomId: string (optional)
viewType: 'day' | 'week' | 'month' (required)
startDate: string (optional, default: today)
page: number (default: 1)
limit: number (for day view only, ignored for week/month)
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "roomInfo": {
      "id": "room123",
      "name": "Phòng 1"
    },
    "shiftOverview": {
      "Ca Sáng": { "name": "Ca Sáng", "startTime": "08:00", "endTime": "12:00" },
      "Ca Chiều": { "name": "Ca Chiều", "startTime": "13:00", "endTime": "17:00" },
      "Ca Tối": { "name": "Ca Tối", "startTime": "18:00", "endTime": "21:00" }
    },
    "pagination": {
      "currentPage": 1,
      "limit": 1,
      "viewType": "week",
      "hasNext": true,
      "hasPrev": true
    },
    "periods": [
      {
        "periodIndex": 1,
        "startDate": "2025-10-06",
        "endDate": "2025-10-12",
        "viewType": "week",
        "totalDays": 7,
        "days": [
          {
            "date": "2025-10-06",
            "shifts": {
              "Ca Sáng": {
                "appointmentCount": 5,
                "totalSlots": 10,
                "staffStats": {
                  "mostFrequentDentist": { "id": "d1", "name": "Dr. A", "slotCount": 8 },
                  "mostFrequentNurse": { "id": "n1", "name": "Nurse B", "slotCount": 8 }
                }
              },
              "Ca Chiều": { ... },
              "Ca Tối": { ... }
            },
            "totalAppointments": 12,
            "totalSlots": 30
          },
          ...
        ]
      }
    ]
  }
}
```

---

### 2. GET /api/slots/dentist/:dentistId/calendar

**Changes:**
- ⭐ `limit` tự động = 1 khi `viewType` là `week` hoặc `month`
- ⭐ Response không còn `slots` array trong mỗi shift
- ⭐ Response có cấu trúc `periods` với `startDate`, `endDate`, `days` (giống room calendar)
- Chỉ trả về: `appointmentCount`, `totalSlots`, `mostFrequentRoom`

**Query Parameters:**
```
dentistId: string (required)
viewType: 'day' | 'week' | 'month' (required)
startDate: string (optional, default: today)
page: number (default: 1)
limit: number (for day view only, ignored for week/month)
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "dentist": { "id": "d1", "name": "Dr. A" },
    "viewType": "week",
    "pagination": {
      "page": 1,
      "limit": 1,
      "hasNext": true,
      "hasPrev": true,
      "totalPeriods": 1
    },
    "periods": [
      {
        "periodIndex": 1,
        "startDate": "2025-09-29",
        "endDate": "2025-10-05",
        "viewType": "week",
        "totalDays": 4,
        "days": [
          {
            "date": "2025-10-02",
            "shifts": {
              "Ca Sáng": {
                "appointmentCount": 3,
                "totalSlots": 5,
                "mostFrequentRoom": { "id": "r1", "name": "Phòng 1", "slotCount": 4 }
              },
              "Ca Chiều": { ... },
              "Ca Tối": { ... }
            },
            "totalAppointments": 8,
            "totalSlots": 15
          },
          ...
        ]
      }
    ]
  }
}
```

---

### 3. GET /api/slots/nurse/:nurseId/calendar

**Changes:**
- ⭐ `limit` tự động = 1 khi `viewType` là `week` hoặc `month`
- ⭐ Response không còn `slots` array trong mỗi shift
- ⭐ Response có cấu trúc `periods` với `startDate`, `endDate`, `days` (giống room calendar)
- Chỉ trả về: `appointmentCount`, `totalSlots`, `mostFrequentRoom`

**Query Parameters:**
```
nurseId: string (required)
viewType: 'day' | 'week' | 'month' (required)
startDate: string (optional, default: today)
page: number (default: 1)
limit: number (for day view only, ignored for week/month)
```

**Response:** Tương tự như dentist calendar, với `nurse` thay vì `dentist`

---

## ⭐ NEW Slot Detail APIs

### 4. GET /api/slots/room/:roomId/details

**Purpose:** Lấy chi tiết tất cả slots của một phòng trong một ngày và ca cụ thể

**Query Parameters:**
```
roomId: string (required, in path)
subRoomId: string (CONDITIONAL - bắt buộc nếu phòng có hasSubRooms = true, không được có nếu hasSubRooms = false)
date: string (required, format: YYYY-MM-DD)
shiftName: string (required, 'Ca Sáng' | 'Ca Chiều' | 'Ca Tối')
```

**⭐ SubRoomId Validation:**
- API sẽ kiểm tra `rooms_cache` để xác định phòng có `hasSubRooms` hay không
- **Nếu `hasSubRooms = true`:** bắt buộc phải có `subRoomId`, nếu không có sẽ báo lỗi: "Phòng có buồng con phải cung cấp subRoomId"
- **Nếu `hasSubRooms = false`:** không được có `subRoomId`, nếu có sẽ báo lỗi: "Phòng không có buồng con không được cung cấp subRoomId"
- API cũng kiểm tra `subRoomId` có tồn tại trong danh sách subRooms của phòng không

**Response Example:**
```json
{
  "success": true,
  "data": {
    "roomInfo": {
      "id": "room123",
      "name": "Phòng 1",
      "hasSubRooms": true,
      "subRoom": {
        "id": "subroom1",
        "name": "Buồng 1"
      }
    },
    "date": "2025-10-06",
    "shiftName": "Ca Sáng",
    "totalSlots": 10,
    "bookedSlots": 5,
    "availableSlots": 3,
    "slots": [
      {
        "slotId": "slot1",
        "startTime": "2025-10-06T01:00:00.000Z",
        "startTimeVN": "08:00",
        "endTime": "2025-10-06T01:30:00.000Z",
        "endTimeVN": "08:30",
        "dentist": { "id": "d1", "name": "Dr. A" },
        "nurse": { "id": "n1", "name": "Nurse B" },
        "hasStaff": true,
        "isBooked": true,
        "appointmentId": "appt1"
      },
      {
        "slotId": "slot2",
        "startTime": "2025-10-06T01:30:00.000Z",
        "startTimeVN": "08:30",
        "endTime": "2025-10-06T02:00:00.000Z",
        "endTimeVN": "09:00",
        "dentist": { "id": "d1", "name": "Dr. A" },
        "nurse": { "id": "n1", "name": "Nurse B" },
        "hasStaff": true,
        "isBooked": false,
        "appointmentId": null
      },
      ...
    ]
  }
}
```

**Error Responses:**
```json
// Missing subRoomId for room with subrooms
{
  "success": false,
  "message": "Phòng có buồng con phải cung cấp subRoomId"
}

// Providing subRoomId for room without subrooms
{
  "success": false,
  "message": "Phòng không có buồng con không được cung cấp subRoomId"
}

// Invalid subRoomId
{
  "success": false,
  "message": "Không tìm thấy buồng con trong phòng này"
}

// Room not found
{
  "success": false,
  "message": "Không tìm thấy phòng"
}
```

---

### 5. GET /api/slots/dentist/:dentistId/details

**Purpose:** Lấy chi tiết tất cả slots của một nha sỹ trong một ngày và ca cụ thể

**Query Parameters:**
```
dentistId: string (required, in path)
date: string (required, format: YYYY-MM-DD)
shiftName: string (required, 'Ca Sáng' | 'Ca Chiều' | 'Ca Tối')
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "dentist": { "id": "d1", "name": "Dr. A" },
    "date": "2025-10-06",
    "shiftName": "Ca Sáng",
    "totalSlots": 10,
    "bookedSlots": 5,
    "availableSlots": 5,
    "slots": [
      {
        "slotId": "slot1",
        "startTime": "2025-10-06T01:00:00.000Z",
        "startTimeVN": "08:00",
        "endTime": "2025-10-06T01:30:00.000Z",
        "endTimeVN": "08:30",
        "room": { "id": "r1", "name": "Phòng 1" },
        "nurse": { "id": "n1", "name": "Nurse B" },
        "isBooked": true,
        "appointmentId": "appt1"
      },
      ...
    ]
  }
}
```

---

### 6. GET /api/slots/nurse/:nurseId/details

**Purpose:** Lấy chi tiết tất cả slots của một y tá trong một ngày và ca cụ thể

**Query Parameters:**
```
nurseId: string (required, in path)
date: string (required, format: YYYY-MM-DD)
shiftName: string (required, 'Ca Sáng' | 'Ca Chiều' | 'Ca Tối')
```

**Response Example:**
```json
{
  "success": true,
  "data": {
    "nurse": { "id": "n1", "name": "Nurse B" },
    "date": "2025-10-06",
    "shiftName": "Ca Sáng",
    "totalSlots": 10,
    "bookedSlots": 5,
    "availableSlots": 5,
    "slots": [
      {
        "slotId": "slot1",
        "startTime": "2025-10-06T01:00:00.000Z",
        "startTimeVN": "08:00",
        "endTime": "2025-10-06T01:30:00.000Z",
        "endTimeVN": "08:30",
        "room": { "id": "r1", "name": "Phòng 1" },
        "dentist": { "id": "d1", "name": "Dr. A" },
        "isBooked": true,
        "appointmentId": "appt1"
      },
      ...
    ]
  }
}
```

---

## Migration Guide

### Frontend Changes Required

**Before (Old way):**
```javascript
// Cũ: Lấy calendar với slot details
const response = await fetch('/api/slots/room/room123/calendar?viewType=week&limit=4');
const data = response.data;
// data.periods[0].days[0].shifts['Ca Sáng'].slots - REMOVED!
```

**After (New way):**
```javascript
// 1. Lấy calendar overview (không có slot details)
const calendarResponse = await fetch('/api/slots/room/room123/calendar?viewType=week');
const calendar = calendarResponse.data;
// calendar.periods[0].days[0].shifts['Ca Sáng'].appointmentCount
// calendar.periods[0].days[0].shifts['Ca Sáng'].totalSlots
// calendar.periods[0].days[0].shifts['Ca Sáng'].staffStats

// 2. Khi cần xem chi tiết slot của ngày và ca cụ thể:
const detailsResponse = await fetch(
  '/api/slots/room/room123/details?date=2025-10-06&shiftName=Ca Sáng'
);
const details = detailsResponse.data;
// details.slots - Array of slot objects with full details
```

---

## Benefits

1. **Performance:** Calendar APIs nhanh hơn vì không load slot details không cần thiết
2. **Scalability:** Giảm payload size, đặc biệt cho month view
3. **Clarity:** Tách biệt rõ ràng giữa calendar overview và slot details
4. **Consistency:** Week/month luôn trả về 1 period duy nhất (limit=1)
5. **Flexibility:** Frontend có thể lazy-load slot details khi cần

---

## Testing

### Test Calendar APIs:
```bash
# Room calendar - week view (limit auto = 1)
GET /api/slots/room/room123/calendar?viewType=week&startDate=2025-10-06

# Dentist calendar - month view (limit auto = 1)
GET /api/slots/dentist/d1/calendar?viewType=month&startDate=2025-10-01

# Nurse calendar - day view (limit có thể > 1)
GET /api/slots/nurse/n1/calendar?viewType=day&limit=7
```

### Test Slot Detail APIs:
```bash
# Room slot details - WITH subRoomId (for room with subrooms)
GET /api/slots/room/room123/details?date=2025-10-06&shiftName=Ca Sáng&subRoomId=subroom1

# Room slot details - WITHOUT subRoomId (for room without subrooms)
GET /api/slots/room/room456/details?date=2025-10-06&shiftName=Ca Sáng

# Room slot details - ERROR: Missing subRoomId for room with subrooms
GET /api/slots/room/room123/details?date=2025-10-06&shiftName=Ca Sáng
# Expected error: "Phòng có buồng con phải cung cấp subRoomId"

# Room slot details - ERROR: Providing subRoomId for room without subrooms
GET /api/slots/room/room456/details?date=2025-10-06&shiftName=Ca Sáng&subRoomId=subroom1
# Expected error: "Phòng không có buồng con không được cung cấp subRoomId"

# Dentist slot details
GET /api/slots/dentist/d1/details?date=2025-10-06&shiftName=Ca Chiều

# Nurse slot details
GET /api/slots/nurse/n1/details?date=2025-10-06&shiftName=Ca Tối
```

---

## Files Changed

### Controllers:
- `services/schedule-service/src/controllers/slot.controller.js`
  - Enforce limit=1 for week/month in all calendar controllers
  - Added: `getRoomSlotDetails`, `getDentistSlotDetails`, `getNurseSlotDetails`

### Services:
- `services/schedule-service/src/services/slot.service.js`
  - Removed `slots` array from calendar response building
  - Added: `getRoomSlotDetails`, `getDentistSlotDetails`, `getNurseSlotDetails` functions

### Routes:
- `services/schedule-service/src/routes/slot.route.js`
  - Added: `GET /room/:roomId/details`
  - Added: `GET /dentist/:dentistId/details`
  - Added: `GET /nurse/:nurseId/details`

---

## Date: 2025-10-04
## Author: Schedule Service Team

# 📅 Calendar APIs - Phân Trang và Xem Lịch Quá Khứ

## 🎯 Tổng Quan

Hệ thống cung cấp 3 API Calendar với khả năng phân trang và xem lịch quá khứ:

1. **Room Calendar** - Lịch làm việc theo phòng
2. **Dentist Calendar** - Lịch làm việc theo nha sỹ 
3. **Nurse Calendar** - Lịch làm việc theo y tá

## 🔧 Cấu Trúc API

### 1. Room Calendar
```
GET /api/slots/room/:roomId/calendar
```

**Parameters:**
- `roomId` (path) - ID của phòng
- `subRoomId` (query, optional) - ID của phòng con
- `viewType` (query) - Loại xem: `day`, `week`, `month`
- `page` (query, default=1) - Trang phân trang (hỗ trợ số âm để xem quá khứ)
- `limit` (query, default=10) - Số chu kỳ trả về (1-100)
- `startDate` (query, optional) - Ngày bắt đầu (YYYY-MM-DD)

### 2. Dentist Calendar  
```
GET /api/slots/dentist/:dentistId/calendar
```

**Parameters:**
- `dentistId` (path) - ID của nha sỹ
- `viewType` (query) - Loại xem: `day`, `week`, `month`
- `page` (query, default=1) - Trang phân trang
- `limit` (query, default=10) - Số chu kỳ trả về
- `startDate` (query, optional) - Ngày bắt đầu

### 3. Nurse Calendar
```
GET /api/slots/nurse/:nurseId/calendar
```

**Parameters:**
- `nurseId` (path) - ID của y tá  
- `viewType` (query) - Loại xem: `day`, `week`, `month`
- `page` (query, default=1) - Trang phân trang
- `limit` (query, default=10) - Số chu kỳ trả về
- `startDate` (query, optional) - Ngày bắt đầu

## 🔄 Phân Trang Logic

### Pagination với Support Lịch Quá Khứ:

- **page = 1**: Hiện tại (chu kỳ 0 → limit-1)
- **page = 2**: Tương lai (chu kỳ limit → 2*limit-1)  
- **page = 3**: Tương lai xa (chu kỳ 2*limit → 3*limit-1)
- **page = -1**: Quá khứ gần (chu kỳ -limit → -1)
- **page = -2**: Quá khứ xa (chu kỳ -2*limit → -limit-1)

**Ví dụ với limit=3:**
- page=1: chu kỳ 0, 1, 2 (hiện tại + 2 chu kỳ tới)
- page=2: chu kỳ 3, 4, 5 (3 chu kỳ tiếp theo)  
- page=-1: chu kỳ -3, -2, -1 (3 chu kỳ trước)

### ViewType Details:

- **day**: Mỗi chu kỳ = 1 ngày
- **week**: Mỗi chu kỳ = 1 tuần (Thứ 2 → Chủ nhật)  
- **month**: Mỗi chu kỳ = 1 tháng

## 📝 Ví Dụ Sử Dụng

### Xem lịch phòng theo tuần - hiện tại:
```bash
GET /api/slots/room/68dd31c43df7b61e7b509e61/calendar?viewType=week&page=1&limit=2
```

### Xem lịch nha sỹ theo ngày - quá khứ:
```bash
GET /api/slots/dentist/68dd337f327b922b6119b902/calendar?viewType=day&page=-1&limit=5
```

### Xem lịch y tá theo tháng - tương lai:
```bash
GET /api/slots/nurse/68dd338d327b922b6119b90d/calendar?viewType=month&page=2&limit=1
```

## 📊 Response Format

### Room Calendar Response:
```json
{
  "success": true,
  "data": {
    "roomInfo": {
      "id": "68dd31c43df7b61e7b509e61",
      "name": "Phòng Khám Tổng Quát 1",
      "hasSubRooms": false,
      "maxDoctors": 1,
      "maxNurses": 1,
      "isActive": true
    },
    "shiftOverview": {
      "morningShift": { "name": "Ca Sáng", "startTime": "08:00", "endTime": "11:30" },
      "afternoonShift": { "name": "Ca Chiều", "startTime": "13:30", "endTime": "17:00" },
      "eveningShift": { "name": "Ca Tối", "startTime": "18:00", "endTime": "21:00" }
    },
    "pagination": {
      "currentPage": 1,
      "limit": 2,
      "viewType": "week",
      "currentDate": "2025-10-02",
      "hasNext": true,
      "hasPrev": true,
      "totalPeriods": 2
    },
    "periods": [
      {
        "periodIndex": 1,
        "startDate": "2025-09-30",
        "endDate": "2025-10-06", 
        "viewType": "week",
        "totalDays": 7,
        "days": [
          {
            "date": "2025-10-01",
            "shifts": {
              "Ca Sáng": {
                "slots": [...],
                "appointmentCount": 5,
                "totalSlots": 12,
                "mostFrequentDentist": { "id": "...", "name": "...", "slotCount": 8 },
                "mostFrequentNurse": { "id": "...", "name": "...", "slotCount": 10 }
              },
              "Ca Chiều": {...},
              "Ca Tối": {...}
            },
            "totalAppointments": 15,
            "totalSlots": 36
          }
        ]
      }
    ]
  }
}
```

### Dentist/Nurse Calendar Response:
```json
{
  "success": true,
  "data": {
    "dentist": { "id": "68dd337f327b922b6119b902", "name": "Bác sỹ Nguyễn A" },
    "viewType": "day",
    "pagination": {
      "page": 1,
      "limit": 5,
      "hasNext": true,
      "hasPrev": true,
      "totalPeriods": 5
    },
    "periods": [
      {
        "date": "2025-10-02",
        "shifts": {
          "Ca Sáng": {
            "slots": [
              {
                "id": "slot_id_1",
                "startTime": "2025-10-02T08:00:00.000Z",
                "endTime": "2025-10-02T08:30:00.000Z",
                "room": {
                  "id": "68dd31c43df7b61e7b509e61",
                  "name": "Phòng Khám 1"
                },
                "nurse": { "id": "68dd338d327b922b6119b90d", "name": "Y tá B" },
                "appointmentId": "appointment_123",
                "patientCount": 1
              }
            ],
            "appointmentCount": 3,
            "totalSlots": 12,
            "mostFrequentRoom": {
              "id": "68dd31c43df7b61e7b509e61", 
              "name": "Phòng Khám 1",
              "slotCount": 8
            }
          },
          "Ca Chiều": {...},
          "Ca Tối": {...}
        },
        "totalAppointments": 8,
        "totalSlots": 36
      }
    ]
  }
}
```

## 🎮 Test Script

Chạy test script để kiểm tra các API:

```bash
cd c:\Users\ADMINS\Downloads\BE_KLTN_TrungNghia_ThuTram
node test-calendar-apis.js
```

## 🔍 Use Cases

### 1. Xem Lịch Hiện Tại và Tương Lai:
```javascript
// Xem 3 tuần tới của phòng
GET /room/123/calendar?viewType=week&page=1&limit=3

// Xem 7 ngày tới của nha sỹ  
GET /dentist/456/calendar?viewType=day&page=1&limit=7
```

### 2. Xem Lịch Quá Khứ:
```javascript
// Xem tháng trước của phòng
GET /room/123/calendar?viewType=month&page=-1&limit=1

// Xem 10 ngày trước của y tá
GET /nurse/789/calendar?viewType=day&page=-1&limit=10
```

### 3. Navigation Pagination:
```javascript
// Current: page=1
// Previous: page=0 (nếu muốn) hoặc page=-1
// Next: page=2
// Far past: page=-3, page=-5, etc.
// Far future: page=5, page=10, etc.
```

## 🛠️ Technical Details

### Timezone Handling:
- Tất cả thời gian được convert về **Vietnam timezone (Asia/Ho_Chi_Minh, UTC+7)**
- Database query sử dụng UTC nhưng hiển thị theo local time

### Performance:
- Sử dụng **Redis cache** cho users và rooms data
- Optimized query với date range filtering
- Pagination giúp giảm tải response size

### Error Handling:
- Validate viewType: `day`, `week`, `month`
- Validate limit: 1-100
- Validate page: hỗ trợ số âm
- Clear error messages cho từng trường hợp

## 🎯 Migration Notes

### Từ API cũ sang API mới:

**Trước đây:**
```bash
# Chỉ xem được hiện tại và tương lai
GET /room/123/calendar?viewType=week
```

**Bây giờ:**
```bash  
# Có thể xem cả quá khứ và có phân trang
GET /room/123/calendar?viewType=week&page=1&limit=5    # Hiện tại
GET /room/123/calendar?viewType=week&page=-2&limit=3   # Quá khứ
GET /room/123/calendar?viewType=week&page=3&limit=2    # Tương lai xa
```

### Tính năng mới:
✅ **Dentist Calendar** - Xem lịch theo nha sỹ  
✅ **Nurse Calendar** - Xem lịch theo y tá  
✅ **Historical Data** - Xem lịch quá khứ với negative pages  
✅ **Enhanced Pagination** - Flexible navigation  
✅ **Room Statistics** - Most frequent rooms trong dentist/nurse calendar  
✅ **Staff Statistics** - Most frequent staff trong room calendar
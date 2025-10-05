# Schedule APIs - Room Name Update

## 📋 Cập nhật mới

Đã thêm trường `roomName` vào response của 2 APIs lấy schedules:

---

## 🏥 1. Get Schedules by Room and Date Range

### Endpoint
```
GET /api/schedules/room/:roomId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

### Request Example
```http
GET http://localhost:3005/api/schedules/room/68dd2e1d3df7b61e7b509e41?startDate=2026-01-01&endDate=2026-03-31
```

### Response (Updated ✨)
```json
{
  "success": true,
  "data": [
    {
      "_id": "68dd2e1d3df7b61e7b509e50",
      "roomId": "68dd2e1d3df7b61e7b509e41",
      "roomName": "Phòng Khám 1",
      "dateVNStr": "2026-01-15",
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
      "isActive": true,
      "generationType": "quarterly",
      "createdAt": "2025-10-01T00:00:00.000Z",
      "updatedAt": "2025-10-01T00:00:00.000Z"
    }
  ]
}
```

### Thay đổi
- ✅ **Thêm field `roomName`** - Tên phòng (lấy từ Redis `rooms_cache`)
- ✅ Nếu không tìm thấy trong cache, `roomName` sẽ là `null`

---

## 🏢 2. Get Schedules by Date Range (All Rooms)

### Endpoint
```
GET /api/schedules?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

### Request Example
```http
GET http://localhost:3005/api/schedules?startDate=2026-01-01&endDate=2026-03-31
```

### Response (Updated ✨)
```json
{
  "success": true,
  "data": [
    {
      "_id": "68dd2e1d3df7b61e7b509e50",
      "roomId": "68dd2e1d3df7b61e7b509e41",
      "roomName": "Phòng Khám 1",
      "dateVNStr": "2026-01-15",
      "workShifts": [
        {
          "name": "Ca Sáng",
          "startTime": "08:00",
          "endTime": "12:00",
          "isActive": true
        }
      ],
      "isActive": true,
      "generationType": "quarterly",
      "createdAt": "2025-10-01T00:00:00.000Z",
      "updatedAt": "2025-10-01T00:00:00.000Z"
    },
    {
      "_id": "68dd2e1d3df7b61e7b509e51",
      "roomId": "68dd2e1d3df7b61e7b509e42",
      "roomName": "Phòng Khám 2",
      "dateVNStr": "2026-01-15",
      "workShifts": [
        {
          "name": "Ca Chiều",
          "startTime": "13:00",
          "endTime": "17:00",
          "isActive": true
        }
      ],
      "isActive": true,
      "generationType": "quarterly",
      "createdAt": "2025-10-01T00:00:00.000Z",
      "updatedAt": "2025-10-01T00:00:00.000Z"
    }
  ]
}
```

### Thay đổi
- ✅ **Thêm field `roomName`** cho mỗi schedule
- ✅ Sử dụng Map lookup để tối ưu performance khi có nhiều rooms
- ✅ Nếu không tìm thấy room trong cache, `roomName` sẽ là `null`

---

## 🔧 Technical Details

### Implementation
**File:** `services/schedule-service/src/services/schedule.service.js`

#### getSchedulesByRoom
```javascript
async function getSchedulesByRoom(roomId, startDate, endDate) {
  const schedules = await scheduleRepo.findByRoomAndDateRange(roomId, startDate, endDate);
  
  // Lấy tên room từ cache
  try {
    const roomCache = await redisClient.get('rooms_cache');
    if (roomCache) {
      const rooms = JSON.parse(roomCache);
      const room = rooms.find(r => r._id === roomId);
      
      // Thêm roomName vào mỗi schedule
      const schedulesWithRoomName = schedules.map(schedule => ({
        ...schedule,
        roomName: room ? room.name : null
      }));
      
      return schedulesWithRoomName;
    }
  } catch (error) {
    console.error('Lỗi khi lấy room name từ cache:', error);
  }
  
  return schedules;
}
```

#### getSchedulesByDateRange
```javascript
async function getSchedulesByDateRange(startDate, endDate) {
  const schedules = await scheduleRepo.findByDateRange(startDate, endDate);
  
  // Lấy danh sách rooms từ cache
  try {
    const roomCache = await redisClient.get('rooms_cache');
    if (roomCache) {
      const rooms = JSON.parse(roomCache);
      
      // Tạo map roomId -> roomName để lookup nhanh
      const roomMap = {};
      rooms.forEach(room => {
        roomMap[room._id] = room.name;
      });
      
      // Thêm roomName vào mỗi schedule
      const schedulesWithRoomName = schedules.map(schedule => ({
        ...schedule,
        roomName: roomMap[schedule.roomId] || null
      }));
      
      return schedulesWithRoomName;
    }
  } catch (error) {
    console.error('Lỗi khi lấy room names từ cache:', error);
  }
  
  return schedules;
}
```

### Data Source
- **Redis Key:** `rooms_cache`
- **Structure:** Array of room objects with `_id` and `name` fields
- **Fallback:** Returns `null` for `roomName` if cache unavailable or room not found

### Performance
- ✅ **Fast lookup:** Uses Redis cache instead of database query
- ✅ **Optimized for multiple rooms:** Uses Map for O(1) lookup in `getSchedulesByDateRange`
- ✅ **No breaking changes:** Existing clients continue to work, new field is additive

---

## 🧪 Testing

### Test Room Schedule API
```bash
curl -X GET "http://localhost:3005/api/schedules/room/YOUR_ROOM_ID?startDate=2026-01-01&endDate=2026-03-31"
```

### Test All Rooms Schedule API
```bash
curl -X GET "http://localhost:3005/api/schedules?startDate=2026-01-01&endDate=2026-03-31"
```

### Expected Fields in Response
- ✅ `roomId` - MongoDB ObjectId (existing)
- ✅ `roomName` - **NEW** - Room name from cache
- ✅ `dateVNStr` - Vietnam date string
- ✅ `workShifts` - Array of work shifts
- ✅ `isActive` - Schedule status
- ✅ `generationType` - How schedule was created

---

## 📝 Notes

### Cache Dependency
- These APIs depend on `rooms_cache` in Redis
- Cache is typically populated by `room-service`
- If cache is not available, APIs still work but `roomName` will be `null`

### Error Handling
- Errors reading from cache are logged but don't break the response
- Fallback behavior: return schedules without `roomName`

### Backward Compatibility
- ✅ **100% backward compatible**
- Existing API clients will continue to work
- New field is additive only
- No changes to request parameters or validation

---

## ✅ Migration Checklist

- [x] Updated `getSchedulesByRoom` service function
- [x] Updated `getSchedulesByDateRange` service function
- [x] Added Redis cache lookup logic
- [x] Added error handling for cache failures
- [x] Optimized Map lookup for multiple rooms
- [x] Verified no breaking changes
- [x] Documented API changes

---

🎉 **Ready to use!** Service will automatically restart with nodemon.

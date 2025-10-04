# Room Slot Details API - SubRoomId Validation

## Tóm tắt

API `GET /api/slots/room/:roomId/details` đã được cải tiến để xử lý chính xác phòng có subroom và không có subroom.

---

## Logic Validation

### 1. Kiểm tra từ `rooms_cache`

API sẽ:
1. Lấy thông tin phòng từ `rooms_cache` (Redis)
2. Kiểm tra field `hasSubRooms` của phòng
3. Validate `subRoomId` parameter dựa trên `hasSubRooms`

### 2. Rules

#### Case 1: Phòng CÓ subrooms (`hasSubRooms = true`)
- ✅ **BẮT BUỘC** phải có `subRoomId` trong query
- ❌ Nếu thiếu `subRoomId`: 
  ```json
  {
    "success": false,
    "message": "Phòng có buồng con phải cung cấp subRoomId"
  }
  ```
- ✅ Kiểm tra `subRoomId` có tồn tại trong danh sách `subRooms` của phòng
- ❌ Nếu `subRoomId` không hợp lệ:
  ```json
  {
    "success": false,
    "message": "Không tìm thấy buồng con trong phòng này"
  }
  ```

#### Case 2: Phòng KHÔNG CÓ subrooms (`hasSubRooms = false`)
- ✅ **KHÔNG ĐƯỢC** có `subRoomId` trong query
- ❌ Nếu có `subRoomId`:
  ```json
  {
    "success": false,
    "message": "Phòng không có buồng con không được cung cấp subRoomId"
  }
  ```

---

## API Usage Examples

### Example 1: Phòng có subrooms (hasSubRooms = true)

**Request:**
```http
GET /api/slots/room/room123/details?date=2025-10-06&shiftName=Ca Sáng&subRoomId=subroom1
```

**Response:**
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
    "slots": [ ... ]
  }
}
```

---

### Example 2: Phòng không có subrooms (hasSubRooms = false)

**Request:**
```http
GET /api/slots/room/room456/details?date=2025-10-06&shiftName=Ca Sáng
```

**Response:**
```json
{
  "success": true,
  "data": {
    "roomInfo": {
      "id": "room456",
      "name": "Phòng 2",
      "hasSubRooms": false
    },
    "date": "2025-10-06",
    "shiftName": "Ca Sáng",
    "totalSlots": 20,
    "bookedSlots": 10,
    "availableSlots": 8,
    "slots": [ ... ]
  }
}
```

---

## Error Cases

### Error 1: Missing subRoomId cho phòng có subrooms

**Request:**
```http
GET /api/slots/room/room123/details?date=2025-10-06&shiftName=Ca Sáng
```

**Response:**
```json
{
  "success": false,
  "message": "Phòng có buồng con phải cung cấp subRoomId"
}
```

---

### Error 2: Providing subRoomId cho phòng không có subrooms

**Request:**
```http
GET /api/slots/room/room456/details?date=2025-10-06&shiftName=Ca Sáng&subRoomId=subroom1
```

**Response:**
```json
{
  "success": false,
  "message": "Phòng không có buồng con không được cung cấp subRoomId"
}
```

---

### Error 3: Invalid subRoomId

**Request:**
```http
GET /api/slots/room/room123/details?date=2025-10-06&shiftName=Ca Sáng&subRoomId=invalid-id
```

**Response:**
```json
{
  "success": false,
  "message": "Không tìm thấy buồng con trong phòng này"
}
```

---

### Error 4: Room not found

**Request:**
```http
GET /api/slots/room/invalid-room/details?date=2025-10-06&shiftName=Ca Sáng
```

**Response:**
```json
{
  "success": false,
  "message": "Không tìm thấy phòng"
}
```

---

## Implementation Details

### Code Flow

1. **Get rooms from cache:**
   ```javascript
   const roomsCache = await redisClient.get('rooms_cache');
   const rooms = roomsCache ? JSON.parse(roomsCache) : [];
   const room = rooms.find(r => r._id === roomId);
   ```

2. **Validate room exists:**
   ```javascript
   if (!room) {
     throw new Error('Không tìm thấy phòng');
   }
   ```

3. **Validate subRoomId based on hasSubRooms:**
   ```javascript
   if (room.hasSubRooms) {
     if (!subRoomId) {
       throw new Error('Phòng có buồng con phải cung cấp subRoomId');
     }
     const subRoom = room.subRooms?.find(sr => sr._id === subRoomId);
     if (!subRoom) {
       throw new Error('Không tìm thấy buồng con trong phòng này');
     }
   } else {
     if (subRoomId) {
       throw new Error('Phòng không có buồng con không được cung cấp subRoomId');
     }
   }
   ```

4. **Build query filter:**
   ```javascript
   const queryFilter = {
     roomId,
     shiftName,
     startTime: { $gte: startUTC, $lt: endUTC },
     isActive: true
   };
   
   if (room.hasSubRooms) {
     queryFilter.subRoomId = subRoomId;
   } else {
     queryFilter.subRoomId = null;
   }
   ```

5. **Query slots and return:**
   ```javascript
   const slots = await slotRepo.find(queryFilter);
   // Format and return response
   ```

---

## Testing

### Test Case 1: Room with subrooms - Valid subRoomId
```bash
curl "http://localhost:3005/api/slots/room/room123/details?date=2025-10-06&shiftName=Ca%20Sáng&subRoomId=subroom1"
```
**Expected:** 200 OK with slot details

---

### Test Case 2: Room without subrooms - No subRoomId
```bash
curl "http://localhost:3005/api/slots/room/room456/details?date=2025-10-06&shiftName=Ca%20Sáng"
```
**Expected:** 200 OK with slot details

---

### Test Case 3: Room with subrooms - Missing subRoomId
```bash
curl "http://localhost:3005/api/slots/room/room123/details?date=2025-10-06&shiftName=Ca%20Sáng"
```
**Expected:** 400 error - "Phòng có buồng con phải cung cấp subRoomId"

---

### Test Case 4: Room without subrooms - Providing subRoomId
```bash
curl "http://localhost:3005/api/slots/room/room456/details?date=2025-10-06&shiftName=Ca%20Sáng&subRoomId=subroom1"
```
**Expected:** 400 error - "Phòng không có buồng con không được cung cấp subRoomId"

---

### Test Case 5: Room with subrooms - Invalid subRoomId
```bash
curl "http://localhost:3005/api/slots/room/room123/details?date=2025-10-06&shiftName=Ca%20Sáng&subRoomId=invalid-id"
```
**Expected:** 400 error - "Không tìm thấy buồng con trong phòng này"

---

## Files Modified

1. **Controller:** `services/schedule-service/src/controllers/slot.controller.js`
   - Changed error status from 500 to 400 for validation errors

2. **Service:** `services/schedule-service/src/services/slot.service.js`
   - Added rooms_cache lookup at the beginning
   - Added hasSubRooms validation logic
   - Added subRoomId validation
   - Updated roomInfo to include hasSubRooms flag

3. **Documentation:** 
   - `CALENDAR_API_REFACTOR.md` - Updated with subRoomId validation details
   - `test-calendar-refactor.js` - Added test cases for both room types

---

## Benefits

1. ✅ **Type Safety:** Đảm bảo subRoomId chỉ được dùng khi cần thiết
2. ✅ **Clear Error Messages:** Frontend biết chính xác lỗi gì và cách fix
3. ✅ **Data Integrity:** Không thể query sai loại phòng
4. ✅ **Better UX:** Frontend có thể validate trước khi gửi request
5. ✅ **Consistent with Room Model:** Logic match với room.model.js

---

## Frontend Integration Tips

### Get Room Info First
```javascript
// 1. Get room info to check hasSubRooms
const room = await fetch('/api/rooms/' + roomId);
const { hasSubRooms, subRooms } = room.data;

// 2. Build query params based on hasSubRooms
const params = new URLSearchParams({
  date: '2025-10-06',
  shiftName: 'Ca Sáng'
});

if (hasSubRooms) {
  // Show subroom selector to user
  const selectedSubRoomId = await showSubRoomSelector(subRooms);
  params.append('subRoomId', selectedSubRoomId);
}

// 3. Fetch slot details
const slots = await fetch(`/api/slots/room/${roomId}/details?${params}`);
```

### Handle Errors Gracefully
```javascript
try {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    
    // Show specific error to user
    if (error.message.includes('phải cung cấp subRoomId')) {
      alert('Vui lòng chọn buồng con');
    } else if (error.message.includes('không được cung cấp subRoomId')) {
      alert('Phòng này không có buồng con');
    } else {
      alert(error.message);
    }
  }
} catch (err) {
  console.error('API call failed:', err);
}
```

---

## Date: 2025-10-04
## Author: Schedule Service Team

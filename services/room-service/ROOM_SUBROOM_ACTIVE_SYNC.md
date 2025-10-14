# 🔄 Room & SubRoom Active Status Logic - Complete Guide

## Tổng quan

Logic tự động đồng bộ trạng thái `isActive` giữa **Room** và **SubRooms**.

## Quy tắc cốt lõi

### ✅ Room.isActive = TRUE khi:
- Room KHÔNG có subrooms, HOẶC
- Room có subrooms VÀ **có ít nhất 1 subroom** có `isActive = true`

### ❌ Room.isActive = FALSE khi:
- Room có subrooms VÀ **tất cả subrooms** đều có `isActive = false`

### 🚫 Không thể BẬT Room khi:
- Room có subrooms VÀ **tất cả subrooms đều tắt**
- **Error:** "Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. Vui lòng bật ít nhất 1 buồng trước."

---

## Implementation Details

### 1. Helper Function (Core Logic)

**File:** `services/room-service/src/services/room.service.js`

```javascript
/**
 * Tự động cập nhật isActive của room dựa trên trạng thái subrooms
 * @param {Object} room - Mongoose room document
 */
async function updateRoomActiveStatusBasedOnSubRooms(room) {
  // Chỉ áp dụng cho room có subrooms
  if (!room.hasSubRooms || !room.subRooms || room.subRooms.length === 0) {
    return;
  }

  // Kiểm tra có ít nhất 1 subroom active không
  const hasActiveSubRoom = room.subRooms.some(
    subRoom => subRoom.isActive === true
  );

  // Cập nhật isActive của room
  const oldStatus = room.isActive;
  room.isActive = hasActiveSubRoom;

  // Chỉ save nếu có thay đổi
  if (oldStatus !== room.isActive) {
    await room.save();
    console.log(`🔄 Room ${room.name}: isActive ${oldStatus} → ${room.isActive}`);
    console.log(`   Reason: ${hasActiveSubRoom ? 'Có ít nhất 1 subroom active' : 'Tất cả subrooms đều inactive'}`);
  }
}
```

**⚠️ QUAN TRỌNG:** Helper function phải được định nghĩa **TRƯỚC** khi sử dụng (đặt ở đầu file sau imports).

---

### 2. Auto-Update When Toggle SubRoom

**API:** `PATCH /rooms/:roomId/subrooms/:subRoomId/toggle`

**Service:**
```javascript
exports.toggleSubRoomStatus = async (roomId, subRoomId) => {
  // 1. Toggle subroom status
  const toggledRoom = await roomRepo.toggleSubRoomStatus(roomId, subRoomId);
  
  // 2. 🆕 Tự động cập nhật room.isActive
  await updateRoomActiveStatusBasedOnSubRooms(toggledRoom);
  
  // 3. Refresh cache
  await refreshRoomCache();
  
  return toggledRoom;
};
```

**Scenarios:**

**Case 1: Tắt subroom cuối cùng đang active**
```
BEFORE:
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true) ← Sẽ tắt
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Toggle Buồng 1 OFF

AFTER:
Room: Phòng A (isActive=false) ← TỰ ĐỘNG TẮT ✅
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Log:
🔄 Room Phòng A: isActive true → false
   Reason: Tất cả subrooms đều inactive
```

**Case 2: Bật lại 1 subroom bất kỳ**
```
BEFORE:
Room: Phòng A (isActive=false)
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=false) ← Sẽ bật
└─ Buồng 3 (isActive=false)

Action: Toggle Buồng 2 ON

AFTER:
Room: Phòng A (isActive=true) ← TỰ ĐỘNG BẬT ✅
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=true)
└─ Buồng 3 (isActive=false)

Log:
🔄 Room Phòng A: isActive false → true
   Reason: Có ít nhất 1 subroom active
```

---

### 3. Auto-Update When Delete SubRoom

**API:** `DELETE /rooms/:roomId/subrooms/:subRoomId`

**Service:**
```javascript
exports.deleteSubRoom = async (roomId, subRoomId) => {
  const room = await roomRepo.findById(roomId);
  // ... validation logic
  
  // 1. Xóa subroom
  room.subRooms.pull(subRoomId);
  
  // 2. Xử lý theo số lượng subrooms còn lại
  if (room.subRooms.length === 0) {
    // Không còn subroom → chuyển về phòng thường
    room.hasSubRooms = false;
    room.maxDoctors = 1;
    room.maxNurses = 1;
  } else {
    // 3. 🆕 Còn subrooms → cập nhật room.isActive
    await updateRoomActiveStatusBasedOnSubRooms(room);
  }
  
  await room.save();
  await refreshRoomCache();
  return room;
};
```

**Scenarios:**

**Case 1: Xóa subroom active cuối cùng**
```
BEFORE:
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true) ← Sẽ xóa
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: DELETE Buồng 1

AFTER:
Room: Phòng A (isActive=false) ← TỰ ĐỘNG TẮT ✅
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Log:
🔄 Room Phòng A: isActive true → false
   Reason: Tất cả subrooms đều inactive
```

**Case 2: Xóa subroom inactive (còn subroom active)**
```
BEFORE:
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true)
├─ Buồng 2 (isActive=false) ← Sẽ xóa
└─ Buồng 3 (isActive=false)

Action: DELETE Buồng 2

AFTER:
Room: Phòng A (isActive=true) ← KHÔNG ĐỔI ✅
├─ Buồng 1 (isActive=true) ← Vẫn còn active
└─ Buồng 3 (isActive=false)
```

**Case 3: Xóa hết subrooms**
```
BEFORE:
Room: Phòng A (isActive=true, hasSubRooms=true)
└─ Buồng 1 (isActive=false) ← Xóa buồng cuối

Action: DELETE Buồng 1

AFTER:
Room: Phòng A (isActive=true, hasSubRooms=false) ← Chuyển về phòng thường
(maxDoctors=1, maxNurses=1)

Note: Không gọi updateRoomActiveStatusBasedOnSubRooms vì đã chuyển về phòng thường
```

---

### 4. Auto-Update When Add SubRoom

**API:** `POST /rooms/:roomId/subrooms`

**Service:**
```javascript
exports.addSubRoom = async (roomId, count = 1) => {
  const room = await roomRepo.findById(roomId);
  // ... validation logic
  
  // 1. Thêm subrooms mới (mặc định isActive=true)
  for (let i = 1; i <= count; i++) {
    room.subRooms.push({
      name: `Buồng ${number}`,
      isActive: true // Mặc định active
    });
  }
  
  // 2. 🆕 Tự động bật lại room nếu đang tắt
  if (!room.isActive) {
    room.isActive = true;
    console.log(`🔄 Room isActive changed to true (thêm subroom mới)`);
  }
  
  await room.save();
  await refreshRoomCache();
  return room;
};
```

**Scenario:**
```
BEFORE:
Room: Phòng A (isActive=false)
├─ Buồng 1 (isActive=false)
└─ Buồng 2 (isActive=false)

Action: POST Add 1 subroom

AFTER:
Room: Phòng A (isActive=true) ← TỰ ĐỘNG BẬT ✅
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=true) ← Buồng mới

Log:
🔄 Room Phòng A: isActive changed to true (thêm subroom mới)
```

---

### 5. Validation When Toggle Room

**API:** `PATCH /rooms/:id/toggle`

**Service:**
```javascript
exports.toggleStatus = async (roomId) => {
  const room = await roomRepo.findById(roomId);
  if (!room) throw new Error("Không tìm thấy phòng");
  
  // 🆕 Validation: Nếu room có subrooms và đang tắt, muốn bật lại phải có ít nhất 1 subroom active
  if (!room.isActive && room.hasSubRooms && room.subRooms && room.subRooms.length > 0) {
    const hasActiveSubRoom = room.subRooms.some(subRoom => subRoom.isActive === true);
    
    if (!hasActiveSubRoom) {
      throw new Error(
        "Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. " +
        "Vui lòng bật ít nhất 1 buồng trước."
      );
    }
  }
  
  const toggled = await roomRepo.toggleStatus(roomId);
  await refreshRoomCache();
  return toggled;
};
```

**Scenarios:**

**Case 1: Bật room khi tất cả subrooms đều tắt ❌**
```
BEFORE:
Room: Phòng A (isActive=false)
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Toggle Room ON

RESULT: ❌ ERROR
"Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. 
Vui lòng bật ít nhất 1 buồng trước."

Frontend Toast: 🔴 Lỗi khi cập nhật trạng thái: Không thể bật...
```

**Case 2: Bật room khi có ít nhất 1 subroom active ✅**
```
BEFORE:
Room: Phòng A (isActive=false)
├─ Buồng 1 (isActive=true) ← Có 1 buồng active
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Toggle Room ON

AFTER:
Room: Phòng A (isActive=true) ✅
├─ Buồng 1 (isActive=true)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Frontend Toast: ✅ Đã kích hoạt phòng khám "Phòng A" thành công!
```

**Case 3: Tắt room (luôn được phép) ✅**
```
BEFORE:
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Toggle Room OFF

AFTER:
Room: Phòng A (isActive=false) ✅
├─ Buồng 1 (isActive=true) ← Subrooms không thay đổi
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Note: Tắt room KHÔNG ảnh hưởng đến subrooms
```

---

## Frontend Integration

**File:** `src/pages/RoomList.jsx`

```javascript
const handleConfirmToggle = async () => {
  if (!selectedRoom) return;
  
  try {
    setToggleLoadingMap(prev => ({ ...prev, [selectedRoom._id]: true }));
    
    const updatedRoom = await roomService.toggleRoomStatus(selectedRoom._id);
    
    const newStatus = updatedRoom.isActive ? 'kích hoạt' : 'vô hiệu hóa';
    toast.success(`Đã ${newStatus} phòng khám "${selectedRoom.name}" thành công!`);
    
    fetchRooms(); // Refresh list
  } catch (error) {
    // ✅ Hiển thị lỗi từ backend
    toast.error(
      'Lỗi khi cập nhật trạng thái: ' + 
      (error.response?.data?.message || error.message)
    );
  } finally {
    setToggleLoadingMap(prev => ({ ...prev, [selectedRoom._id]: false }));
    setShowConfirmModal(false);
    setSelectedRoom(null);
  }
};
```

**Error Messages:**

```javascript
// Backend validation error (400 Bad Request)
{
  "message": "Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. Vui lòng bật ít nhất 1 buồng trước."
}

// Frontend toast hiển thị:
🔴 Lỗi khi cập nhật trạng thái: Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. Vui lòng bật ít nhất 1 buồng trước.
```

---

## Testing Checklist

### Test Case 1: Tắt tất cả subrooms
- [ ] Có room với 3 subrooms, 2 active, 1 inactive
- [ ] Tắt subroom active thứ 1 → Room vẫn active
- [ ] Tắt subroom active thứ 2 → **Room tự động inactive** ✅
- [ ] Log: `🔄 Room ... isActive true → false. Reason: Tất cả subrooms đều inactive`

### Test Case 2: Bật lại subroom
- [ ] Room inactive với tất cả 3 subrooms inactive
- [ ] Bật 1 subroom bất kỳ → **Room tự động active** ✅
- [ ] Log: `🔄 Room ... isActive false → true. Reason: Có ít nhất 1 subroom active`

### Test Case 3: Xóa subroom active cuối
- [ ] Room có 2 subrooms: 1 active, 1 inactive
- [ ] Xóa subroom active → **Room tự động inactive** ✅
- [ ] Log: `🔄 Room ... isActive true → false. Reason: Tất cả subrooms đều inactive`

### Test Case 4: Thêm subroom mới
- [ ] Room inactive với tất cả subrooms inactive
- [ ] Thêm 1 buồng mới → **Room tự động active** ✅
- [ ] Log: `🔄 Room ... isActive changed to true (thêm subroom mới)`

### Test Case 5: Toggle room với validation
- [ ] Room inactive, tất cả subrooms inactive
- [ ] Cố gắng bật room → **Error 400** ❌
- [ ] Frontend toast hiển thị: "Không thể bật hoạt động phòng..."
- [ ] Bật 1 subroom → Room tự động active
- [ ] Cố gắng tắt room → **Thành công** ✅ (tắt room luôn được phép)

### Test Case 6: Xóa hết subrooms
- [ ] Room có 1 subroom cuối
- [ ] Xóa subroom cuối → Room chuyển về `hasSubRooms=false`
- [ ] Room.isActive không đổi (không gọi auto-update logic)

---

## API Reference

### Toggle SubRoom Status
```
PATCH /rooms/:roomId/subrooms/:subRoomId/toggle
Authorization: Bearer <token>

Response 200:
{
  "_id": "...",
  "name": "Phòng A",
  "isActive": false, // ← Tự động cập nhật
  "hasSubRooms": true,
  "subRooms": [
    { "_id": "...", "name": "Buồng 1", "isActive": false },
    { "_id": "...", "name": "Buồng 2", "isActive": false }
  ]
}
```

### Delete SubRoom
```
DELETE /rooms/:roomId/subrooms/:subRoomId
Authorization: Bearer <token>

Response 200:
{
  "_id": "...",
  "name": "Phòng A",
  "isActive": false, // ← Tự động cập nhật
  "hasSubRooms": true,
  "subRooms": [
    { "_id": "...", "name": "Buồng 2", "isActive": false }
  ]
}
```

### Add SubRooms
```
POST /rooms/:roomId/subrooms
Authorization: Bearer <token>
Content-Type: application/json

{
  "count": 2
}

Response 200:
{
  "_id": "...",
  "name": "Phòng A",
  "isActive": true, // ← Tự động bật
  "hasSubRooms": true,
  "subRooms": [
    { "_id": "...", "name": "Buồng 1", "isActive": false },
    { "_id": "...", "name": "Buồng 2", "isActive": true }, // ← Mới
    { "_id": "...", "name": "Buồng 3", "isActive": true }  // ← Mới
  ]
}
```

### Toggle Room Status
```
PATCH /rooms/:id/toggle
Authorization: Bearer <token>

Response 400 (nếu tất cả subrooms tắt):
{
  "message": "Không thể bật hoạt động phòng vì tất cả buồng đều đang tắt. Vui lòng bật ít nhất 1 buồng trước."
}

Response 200 (nếu có ít nhất 1 subroom active):
{
  "_id": "...",
  "name": "Phòng A",
  "isActive": true,
  "hasSubRooms": true,
  "subRooms": [...]
}
```

---

## Troubleshooting

### ❌ Room không tự động tắt khi tắt subroom cuối

**Nguyên nhân:** Helper function được định nghĩa sau khi sử dụng

**Giải pháp:** Di chuyển `updateRoomActiveStatusBasedOnSubRooms` lên đầu file (sau imports, trước exports)

```javascript
// ❌ SAI - Function ở cuối file
exports.toggleSubRoomStatus = async () => {
  await updateRoomActiveStatusBasedOnSubRooms(room); // ReferenceError
};

async function updateRoomActiveStatusBasedOnSubRooms() { ... }

// ✅ ĐÚNG - Function ở đầu file
async function updateRoomActiveStatusBasedOnSubRooms() { ... }

exports.toggleSubRoomStatus = async () => {
  await updateRoomActiveStatusBasedOnSubRooms(room); // OK
};
```

### ❌ Có thể bật room mặc dù tất cả subrooms đều tắt

**Nguyên nhân:** Thiếu validation trong `toggleStatus`

**Giải pháp:** Thêm validation như đã implement ở trên

### ❌ Frontend không hiển thị lỗi

**Nguyên nhân:** Không catch error từ API

**Giải pháp:** 
```javascript
try {
  await roomService.toggleRoomStatus(roomId);
} catch (error) {
  // ✅ Hiển thị error.response.data.message
  toast.error(error.response?.data?.message || error.message);
}
```

---

## Summary

✅ **Auto OFF:** Tắt subroom cuối → Room tự động tắt  
✅ **Auto ON:** Bật bất kỳ subroom nào → Room tự động bật  
✅ **Auto ON:** Thêm subroom mới → Room tự động bật  
✅ **Validation:** Không cho bật room nếu tất cả subrooms tắt  
✅ **User-friendly:** Error message rõ ràng, hướng dẫn user phải làm gì  
✅ **Consistent:** Logic đồng bộ giữa backend và frontend  
✅ **Logged:** Mọi thay đổi đều có log để debug  

**Workflow lý tưởng:**
```
User muốn tắt Room có subrooms
  ↓
Option 1: Tắt từng subroom → Room tự động tắt khi tắt cái cuối ✅
Option 2: Tắt Room trực tiếp → Subrooms không đổi ✅

User muốn bật Room có subrooms
  ↓
Bước 1: Bật ít nhất 1 subroom → Room tự động bật ✅
Bước 2 (optional): Bật Room nếu đang tắt → Validation check → OK ✅
```

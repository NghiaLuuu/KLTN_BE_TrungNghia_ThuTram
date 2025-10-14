# 🔄 Room Auto-Active Logic

## Tổng quan

Logic tự động cập nhật `isActive` của **Room** dựa trên trạng thái của các **SubRooms**.

## Quy tắc

### ✅ Room.isActive = TRUE khi:
- Có **ít nhất 1 subroom** có `isActive = true`

### ❌ Room.isActive = FALSE khi:
- **Tất cả subrooms** đều có `isActive = false`

## Áp dụng tại

### 1. Toggle SubRoom Status (Bật/Tắt buồng)

**Endpoint:** `PATCH /rooms/:roomId/subrooms/:subRoomId/toggle`

**Logic:**
```javascript
async toggleSubRoomStatus(roomId, subRoomId) {
  // 1. Toggle subroom status
  const room = await toggleSubRoomStatus(roomId, subRoomId);
  
  // 2. 🆕 Tự động cập nhật room.isActive
  await updateRoomActiveStatusBasedOnSubRooms(room);
  
  return room;
}
```

**Ví dụ:**

**Case 1: Tắt subroom cuối cùng**
```
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Tắt Buồng 1
↓
Result:
Room: Phòng A (isActive=false) ← Tự động tắt
├─ Buồng 1 (isActive=false) ← Vừa tắt
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)
```

**Case 2: Bật lại 1 subroom**
```
Room: Phòng A (isActive=false)
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Bật Buồng 2
↓
Result:
Room: Phòng A (isActive=true) ← Tự động bật
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=true) ← Vừa bật
└─ Buồng 3 (isActive=false)
```

### 2. Delete SubRoom (Xóa buồng)

**Endpoint:** `DELETE /rooms/:roomId/subrooms/:subRoomId`

**Logic:**
```javascript
async deleteSubRoom(roomId, subRoomId) {
  // 1. Xóa subroom
  room.subRooms.pull(subRoomId);
  
  // 2. Nếu không còn subroom nào
  if (room.subRooms.length === 0) {
    room.hasSubRooms = false;
    room.maxDoctors = 1;
    room.maxNurses = 1;
  } else {
    // 3. 🆕 Nếu còn subrooms, cập nhật room.isActive
    await updateRoomActiveStatusBasedOnSubRooms(room);
  }
  
  return room;
}
```

**Ví dụ:**

**Case 1: Xóa subroom active cuối cùng**
```
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true) ← Sẽ xóa
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)

Action: Xóa Buồng 1
↓
Result:
Room: Phòng A (isActive=false) ← Tự động tắt
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=false)
```

**Case 2: Xóa subroom inactive**
```
Room: Phòng A (isActive=true)
├─ Buồng 1 (isActive=true)
├─ Buồng 2 (isActive=false) ← Sẽ xóa
└─ Buồng 3 (isActive=false)

Action: Xóa Buồng 2
↓
Result:
Room: Phòng A (isActive=true) ← Không đổi
├─ Buồng 1 (isActive=true) ← Vẫn còn active
└─ Buồng 3 (isActive=false)
```

**Case 3: Xóa hết subrooms**
```
Room: Phòng A (isActive=true, hasSubRooms=true)
└─ Buồng 1 (isActive=true) ← Xóa buồng cuối

Action: Xóa Buồng 1
↓
Result:
Room: Phòng A (isActive=true, hasSubRooms=false) ← Chuyển về phòng thường
(maxDoctors=1, maxNurses=1)
```

### 3. Add SubRoom (Thêm buồng mới)

**Endpoint:** `POST /rooms/:roomId/subrooms`

**Logic:**
```javascript
async addSubRoom(roomId, count) {
  // 1. Thêm subrooms mới (mặc định isActive=true)
  for (let i = 1; i <= count; i++) {
    room.subRooms.push({
      name: `Buồng ${number}`,
      isActive: true
    });
  }
  
  // 2. 🆕 Tự động bật lại room nếu đang tắt
  if (!room.isActive) {
    room.isActive = true;
  }
  
  return room;
}
```

**Ví dụ:**
```
Room: Phòng A (isActive=false)
├─ Buồng 1 (isActive=false)
└─ Buồng 2 (isActive=false)

Action: Thêm 1 buồng mới
↓
Result:
Room: Phòng A (isActive=true) ← Tự động bật
├─ Buồng 1 (isActive=false)
├─ Buồng 2 (isActive=false)
└─ Buồng 3 (isActive=true) ← Buồng mới
```

## Helper Function

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
  }
}
```

## Testing

### Test Case 1: Tắt tất cả subrooms
1. Có room với 3 subrooms active
2. Tắt Buồng 1 → Room vẫn active
3. Tắt Buồng 2 → Room vẫn active
4. Tắt Buồng 3 → **Room tự động inactive** ✅

### Test Case 2: Bật lại subroom
1. Room inactive với tất cả subrooms inactive
2. Bật 1 subroom bất kỳ → **Room tự động active** ✅

### Test Case 3: Xóa subroom active cuối
1. Room có 2 subrooms: 1 active, 1 inactive
2. Xóa subroom active → **Room tự động inactive** ✅

### Test Case 4: Thêm subroom mới
1. Room inactive với tất cả subrooms inactive
2. Thêm buồng mới → **Room tự động active** ✅

## Lợi ích

✅ **Tự động hóa:** Không cần manual update room status  
✅ **Đồng bộ:** Room status luôn phản ánh đúng tình trạng subrooms  
✅ **UX tốt hơn:** User không cần lo lắng về việc bật/tắt room  
✅ **Logic rõ ràng:** Dễ hiểu, dễ maintain  

## Lưu ý

⚠️ Logic này chỉ áp dụng cho **room có subrooms** (`hasSubRooms = true`)

⚠️ Nếu room không có subrooms, `isActive` được quản lý độc lập

⚠️ Cache được refresh sau mỗi thay đổi để đảm bảo dữ liệu mới nhất

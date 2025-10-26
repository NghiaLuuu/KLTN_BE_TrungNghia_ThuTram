# Fix: October/November Schedule Creation Bug

## 🐛 Problem

**Triệu chứng:**
Khi tạo lịch cho tháng 10 + 11 cùng lúc, hệ thống skip **Thứ 7 (Saturday)** thay vì **Chủ nhật (Sunday)**.

**Ví dụ thực tế từ database:**

**Tháng 11/2025:**
- ✅ 2025-11-02 (Chủ nhật): Có 3 slots ← SAI! Nên skip
- ❌ 2025-11-01 (Thứ 7): Không có slots ← SAI! Không nên skip
- ❌ 2025-11-08 (Thứ 7): Không có slots ← SAI!
- ❌ 2025-11-15 (Thứ 7): Không có slots ← SAI!
- ❌ 2025-11-22 (Thứ 7): Không có slots ← SAI!
- ❌ 2025-11-29 (Thứ 7): Không có slots ← SAI!

**Slots được lưu với ngày SAI:**
```
First date: 2025-10-31  ← Should be 2025-11-01
```

## 🔍 Root Cause

### Bug 1: Loop sử dụng MIX local và UTC methods

**Code cũ (SAI):**
```javascript
const currentDate = new Date(scheduleStartDate);  // ← LOCAL
while (currentDate <= endDate) {
  const year = currentDate.getFullYear();     // ← LOCAL
  const month = currentDate.getMonth() + 1;   // ← LOCAL
  const day = currentDate.getDate();          // ← LOCAL
  
  // ...
  currentDate.setDate(currentDate.getDate() + 1);  // ← LOCAL increment
}
```

**Vấn đề:** Khi `scheduleStartDate` là `2025-11-01T00:00:00.000Z` (UTC):
- LOCAL (VN = UTC+7): `2025-11-01 07:00` → `getDate()` = 1
- Nhưng khi so sánh và xử lý, có thể bị lệch

### Bug 2: Slot date field lưu SAI timezone

**Code cũ (SAI):**
```javascript
date: new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0))
//                                          ^^^^ BUG!
```

**Giải thích:**
- `Date.UTC(2025, 10, 1, -7, 0, 0, 0)` = `2025-10-31T17:00:00.000Z`
- `-7` giờ nghĩa là **TRƯỚC 7 giờ** = hôm trước lúc 17:00 UTC
- Khi lưu vào database, `date` field = `2025-10-31` thay vì `2025-11-01`
- **Lệch 1 ngày!**

## ✅ Solution

### Fix 1: Thống nhất sử dụng UTC trong loop

```javascript
// ✅ Sử dụng UTC methods
const currentDate = new Date(scheduleStartDate);
currentDate.setUTCHours(0, 0, 0, 0); // Normalize to UTC midnight

const endDate = new Date(scheduleEndDate);
endDate.setUTCHours(23, 59, 59, 999); // End of day in UTC

while (currentDate <= endDate) {
  // ✅ Lấy year, month, day từ UTC
  const year = currentDate.getUTCFullYear();
  const month = currentDate.getUTCMonth() + 1;
  const day = currentDate.getUTCDate();
  
  // ...
  
  // ✅ Tăng ngày trong UTC
  currentDate.setUTCDate(currentDate.getUTCDate() + 1);
}
```

### Fix 2: Lưu date field đúng

```javascript
// ✅ Store date as midnight UTC
const slotDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

slots.push({
  scheduleId,
  roomId,
  subRoomId: subRoomId || null,
  shiftName,
  startTime: new Date(slotStartTime),  // UTC time for shift start
  endTime: new Date(slotEndTime),      // UTC time for shift end
  date: slotDate,                      // ✅ Midnight UTC = calendar date
  duration: slotDuration,
  status: 'available'
});
```

## 📊 Verification

### Before Fix:
```
Tháng 11:
  ❌ 2025-11-01 (Thứ 7): NO SLOTS (bị skip sai)
  ✅ 2025-11-02 (Chủ nhật): 3 slots (không skip - SAI!)
  ...
  ❌ 2025-11-08 (Thứ 7): NO SLOTS (bị skip sai)
  ✅ 2025-11-09 (Chủ nhật): 3 slots (không skip - SAI!)
```

### After Fix:
```
Tháng 11:
  ✅ 2025-11-01 (Thứ 7): 3 slots (không skip - ĐÚNG!)
  ⏭️  2025-11-02 (Chủ nhật): SKIPPED (skip - ĐÚNG!)
  ✅ 2025-11-03 (Thứ 2): 3 slots
  ...
  ✅ 2025-11-08 (Thứ 7): 3 slots (không skip - ĐÚNG!)
  ⏭️  2025-11-09 (Chủ nhật): SKIPPED (skip - ĐÚNG!)
```

## 🧪 Testing

Chạy script kiểm tra:

```bash
# 1. Xóa lịch cũ (bị lỗi)
mongosh "mongodb://admin:password123@localhost:27017/dental_clinic_schedule?authSource=admin" --eval "
  db.schedules.deleteMany({ month: { \$in: [10, 11] }, year: 2025 });
  db.slots.deleteMany({ scheduleId: { \$in: db.schedules.find({ month: { \$in: [10, 11] }, year: 2025 }).map(s => s._id) } });
"

# 2. Tạo lại lịch (sau khi fix)
# Dùng frontend hoặc API

# 3. Kiểm tra kết quả
node check-actual-slots.js
```

**Kết quả mong đợi:**
- Chủ nhật bị skip (không có slots)
- Thứ 7 có slots bình thường
- Slot `date` field khớp với ngày thực tế (không lệch)

## 📝 Files Changed

**Modified:**
- `services/schedule-service/src/services/schedule.service.js`
  - Line ~5880-5950: `generateSlotsForShift()` function
  - Changed loop to use UTC methods (`setUTCHours`, `getUTCDate`, etc.)
  - Fixed `date` field calculation to use midnight UTC

**Created (for verification):**
- `check-actual-slots.js` - Kiểm tra slots thực tế trong database
- `test-timezone-bug.js` - Test timezone conversion logic  
- `test-fallback-bug.js` - Test fallback logic khi computedDaysOff rỗng

## 🎯 Impact

**Before:** 
- Chủ nhật có slots (mặc dù nên nghỉ)
- Thứ 7 không có slots (mặc dù nên làm)
- **Nghiêm trọng:** Lịch sai hoàn toàn!

**After:**
- Chủ nhật skip đúng
- Thứ 7 tạo slots đúng  
- Lịch chính xác theo cấu hình

## ⚠️ Migration Required

**Cần xóa và tạo lại lịch:**

Lịch cũ (đã tạo trước khi fix) có dữ liệu sai và **KHÔNG THỂ SỬA** được. Phải:

1. **Xóa schedules + slots cũ** cho tháng 10/11
2. **Tạo lại** sau khi deploy code mới

```bash
# Delete old schedules/slots
mongosh "mongodb://admin:password123@localhost:27017/dental_clinic_schedule?authSource=admin" --eval "
  db.schedules.deleteMany({ 
    month: { \$in: [10, 11] }, 
    year: 2025 
  });
  
  db.slots.deleteMany({ 
    date: { 
      \$gte: ISODate('2025-10-01'), 
      \$lte: ISODate('2025-11-30') 
    } 
  });
"
```

## 🚀 Deployment Steps

1. **Backup database**
   ```bash
   mongodump --uri="mongodb://admin:password123@localhost:27017/dental_clinic_schedule?authSource=admin" --out=backup_$(date +%Y%m%d)
   ```

2. **Deploy code với fix**
   ```bash
   cd services/schedule-service
   # Restart service
   ```

3. **Xóa lịch cũ** (nếu đã tạo)

4. **Tạo lại lịch** qua frontend

5. **Verify** bằng `check-actual-slots.js`

## 📌 Notes

- Bug này chỉ ảnh hưởng khi tạo lịch **NHIỀU tháng cùng lúc**
- Nếu tạo từng tháng một thì có thể không gặp (tùy timing)
- Root cause là **timezone inconsistency** giữa loop và date calculation
- Fix đảm bảo **toàn bộ sử dụng UTC** để tránh lỗi tương tự

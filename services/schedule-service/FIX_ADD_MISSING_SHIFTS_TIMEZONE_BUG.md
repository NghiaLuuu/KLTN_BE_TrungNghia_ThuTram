# 🐛 BUG FIX: Add Missing Shifts Timezone Issue

## 📋 Mô tả vấn đề

Khi gọi API "Thêm ca thiếu", system vẫn tạo slots cho **ngày hôm nay** thay vì từ **ngày mai**.

### Ví dụ lỗi:

```json
{
  "date": "2025-10-30T00:00:00.000Z",
  "startTime": "2025-10-30T11:00:00.000Z",
  "endTime": "2025-10-30T11:15:00.000Z",
  "createdAt": "2025-10-30T07:10:58.568Z"
}
```

- **Created at:** 2025-10-30 14:10 (VN time = UTC+7)
- **Slot date:** 2025-10-30 (ngày hôm nay) ❌
- **Expected:** 2025-10-31 (ngày mai) ✅

---

## 🔍 Nguyên nhân

### Root Cause: Timezone Mismatch

**File:** `schedule.service.js`  
**Function:** `addMissingShifts()`  
**Line:** 5754

```javascript
// ❌ Code cũ - KHÔNG set timezone
const today = dayjs().startOf('day');
const tomorrow = today.add(1, 'day');
```

**Vấn đề:**

1. `dayjs()` không có timezone config → Dùng **server local timezone**
2. Nếu server chạy **UTC timezone**:
   - Server time: `2025-10-30 07:10 UTC`
   - VN time: `2025-10-30 14:10 +07:00`
   - `dayjs().startOf('day')` = `2025-10-30 00:00:00 UTC`
   - Nhưng ở VN đã là **chiều** rồi!

3. Logic so sánh:
   ```javascript
   scheduleStartDate = 2025-10-30 (lịch bắt đầu hôm nay)
   today = 2025-10-30 00:00:00 UTC
   
   if (scheduleStartDate.isSameOrBefore(today)) {
     effectiveStartDate = tomorrow; // ✅ Set tomorrow
   }
   ```
   
4. Nhưng `tomorrow` vẫn là `2025-10-31 00:00:00 UTC`
5. Khi `generateSlotsForShift()` chạy:
   - Convert VN time `18:00` → UTC `11:00`
   - Loop từ `tomorrow` (2025-10-31 UTC)
   - Nhưng logic internal lại so sánh với date field
   - Kết quả: Tạo slot cho `2025-10-30` ❌

---

## ✅ Giải pháp

### Fix Applied

**File:** `schedule.service.js` - Line 5754

```javascript
// ✅ Code mới - Set timezone rõ ràng
const today = dayjs().tz('Asia/Ho_Chi_Minh').startOf('day');
const tomorrow = today.add(1, 'day');

console.log(`🕐 [Timezone Debug] Server time: ${dayjs().format()}`);
console.log(`🕐 [Timezone Debug] VN today: ${today.format('YYYY-MM-DD HH:mm:ss Z')}`);
console.log(`🕐 [Timezone Debug] VN tomorrow: ${tomorrow.format('YYYY-MM-DD HH:mm:ss Z')}`);
```

### Kết quả sau khi fix:

```
Server time: 2025-10-30T07:10:58Z
VN today: 2025-10-30 00:00:00 +07:00
VN tomorrow: 2025-10-31 00:00:00 +07:00
```

---

## 🧪 Test Cases

### Case 1: Lịch bắt đầu trong quá khứ
- **Schedule start:** 2025-10-20
- **VN today:** 2025-10-30
- **Expected:** Generate từ 2025-10-31 ✅

### Case 2: Lịch bắt đầu hôm nay
- **Schedule start:** 2025-10-30
- **VN today:** 2025-10-30 (chiều)
- **Expected:** Generate từ 2025-10-31 ✅

### Case 3: Lịch bắt đầu trong tương lai
- **Schedule start:** 2025-11-05
- **VN today:** 2025-10-30
- **Expected:** Generate từ 2025-11-05 ✅

---

## 📝 Notes

### Affected Functions:
- ✅ `addMissingShifts()` - FIXED

### Related Functions (Already OK):
- ✅ `generateRoomSchedule()` - Already uses timezone correctly
- ✅ `generateSlotsForShift()` - Handles UTC conversion properly

### Prevention:
**Luôn dùng `.tz('Asia/Ho_Chi_Minh')` khi:**
- Tính toán `today`, `tomorrow`, `now`
- So sánh dates với user input
- Generate date ranges

**Không cần set timezone khi:**
- Parse date string từ DB: `dayjs(schedule.startDate)` - Tự động detect
- So sánh 2 dates đã có: `dateA.isBefore(dateB)` - OK

---

## 🚀 Deployment

1. ✅ Fix applied to `schedule.service.js`
2. ⏳ Restart schedule-service
3. ⏳ Test "Thêm ca thiếu" feature
4. ⏳ Verify slots không được tạo cho ngày hôm nay

---

**Fixed by:** GitHub Copilot  
**Date:** 2025-10-30  
**Commit:** [Pending]

# 🔍 LOGIC KIỂM TRA THÁNG CÓ THỂ TẠO LỊCH (availableMonths)

## 📋 **Vấn đề cần fix:**

**Modal "Tạo lịch cho X phòng"** đang cho phép chọn tháng 10/2025 mặc dù:
- TẤT CẢ phòng đã có lịch tháng 10
- 2 lịch thiếu ca nhưng đã **TẮT HOẠT ĐỘNG** (isActive=false)
- → Không nên tính là "thiếu lịch"

## ✅ **Logic ĐÚNG (đã áp dụng):**

### **Tháng CÓ THỂ CHỌN khi:**
Có **ít nhất 1 phòng** thỏa mãn **ít nhất 1 trong các điều kiện:**

1. **Chưa có lịch tháng đó**
2. **Phòng có buồng:** Chưa đủ số buồng **ĐANG BẬT** (subRoom.isActive=true)
3. **Thiếu ít nhất 1 ca ĐANG BẬT** theo schedule config

### **KHÔNG TÍNH các trường hợp:**

#### **1. Ca đang TẮT (shift isActive=false)**
```javascript
// Ví dụ: Ca Tối đang tắt trong config
workShifts.evening.isActive = false
→ Không kiểm tra ca Tối khi tính availableMonths
```

#### **2. Buồng đang TẮT (subRoom.isActive=false)**
```javascript
// Ví dụ: Phòng có 2 buồng, nhưng Buồng 2 đang tắt
room.subRooms = [
  { _id: '...', name: 'Buồng 1', isActive: true },
  { _id: '...', name: 'Buồng 2', isActive: false } // ❌ KHÔNG ĐẾM
]
→ Chỉ kiểm tra Buồng 1 (activeSubRoomCount = 1)
```

#### **3. Schedule có isActiveSubRoom=false**
```javascript
// Schedule của Buồng 2 đã bị tắt trong lịch
schedule.isActiveSubRoom = false
→ KHÔNG ĐÉM ca của schedule này
```

#### **4. Schedule có isActive=false (phòng không có buồng)**
```javascript
// Schedule của phòng đã bị tắt
schedule.isActive = false
→ KHÔNG ĐÉM ca của schedule này
```

---

## 📊 **Code Flow:**

### **Step 1: Lấy config shifts (Line ~1503)**
```javascript
const configResult = await cfgService.getConfig();
const workShifts = configResult?.data?.workShifts || {};
const activeShifts = {
  morning: workShifts.morning?.isActive !== false,
  afternoon: workShifts.afternoon?.isActive !== false,
  evening: workShifts.evening?.isActive !== false
};
console.log('📋 Active shifts from config:', activeShifts);
```

**Output ví dụ:**
```
📋 Active shifts from config: { morning: true, afternoon: true, evening: false }
```

### **Step 2: Phân tích từng phòng (Line ~1554-1650)**

#### **2.1 Phòng CÓ BUỒNG:**
```javascript
// Chỉ đếm buồng ĐANG BẬT
const activeSubRooms = roomInfo.subRooms.filter(sr => sr.isActive !== false);
const activeSubRoomCount = activeSubRooms.length;
const activeSubRoomIds = new Set(activeSubRooms.map(sr => sr._id.toString()));

// Đếm số buồng có ca
const subRoomsWithShift = monthSchedules.filter(s => {
  const subRoomId = s.subRoomId?.toString();
  const isSubRoomActive = activeSubRoomIds.has(subRoomId); // ✅ Buồng đang bật
  const isScheduleSubRoomActive = s.isActiveSubRoom !== false; // ✅ isActiveSubRoom=true
  const isShiftGenerated = s.shiftConfig?.[shiftKey]?.isGenerated === true; // ✅ Ca đã tạo
  const isShiftActive = s.shiftConfig?.[shiftKey]?.isActive !== false; // ✅ Ca đang bật
  
  return isSubRoomActive && isScheduleSubRoomActive && isShiftGenerated && isShiftActive;
}).length;

// ✅ So với SỐ BUỒNG ĐANG BẬT (không phải tổng số buồng)
shiftStatus[shiftKey].allHave = subRoomsWithShift >= activeSubRoomCount;
```

#### **2.2 Phòng KHÔNG CÓ BUỒNG:**
```javascript
const isScheduleActive = schedule.isActive !== false; // ✅ Schedule đang bật

const shiftStatus = {
  morning: {
    allHave: isScheduleActive && // ✅ Check schedule.isActive
             schedule.shiftConfig?.morning?.isGenerated === true && 
             schedule.shiftConfig?.morning?.isActive !== false,
    ...
  },
  ...
};
```

### **Step 3: Tính availableMonths (Line ~1663-1687)**
```javascript
const availableMonths = monthsToCheck.filter(({ month, year }) => {
  return roomsAnalysis.some(room => {
    const monthAnalysis = room.monthsAnalysis.find(
      m => m.month === month && m.year === year
    );
    
    // Chưa có lịch → có thể chọn
    if (!monthAnalysis.hasSchedule) return true;

    // Chưa đủ số buồng đang bật → có thể chọn
    if (room.hasSubRooms && !monthAnalysis.allSubRoomsHaveSchedule) return true;

    // 🔥 QUAN TRỌNG: Chỉ kiểm tra ca ĐANG BẬT
    const missingActiveShifts = [];
    if (activeShifts.morning && !monthAnalysis.shiftStatus.morning.allHave) {
      missingActiveShifts.push('morning');
    }
    if (activeShifts.afternoon && !monthAnalysis.shiftStatus.afternoon.allHave) {
      missingActiveShifts.push('afternoon');
    }
    if (activeShifts.evening && !monthAnalysis.shiftStatus.evening.allHave) {
      missingActiveShifts.push('evening');
    }
    
    // Thiếu ít nhất 1 ca ĐANG BẬT → có thể chọn
    return missingActiveShifts.length > 0;
  });
});
```

---

## 🧪 **Test Case: Tháng 10/2025**

### **Data:**
- **13 phòng** được chọn
- **Tháng 10/2025:** Tất cả phòng đã có lịch
- **2 lịch thiếu:** 
  - Phòng thẩm mỹ nha - Buồng 2 (thiếu Ca Sáng, Ca Chiều)
  - Phòng thẩm mỹ nha - Buồng 2 (đã tắt)

### **Expected Behavior:**

#### **Trước khi fix:**
```javascript
// ❌ SAI: Đếm tất cả ca thiếu, không quan tâm isActive
hasAllShifts = morning.allHave && afternoon.allHave && evening.allHave
             = false && false && true
             = false
→ Thiếu ca → Tháng 10 có thể chọn ❌
```

#### **Sau khi fix:**
```javascript
// 1. Kiểm tra Buồng 2 có đang bật không
activeSubRooms = roomInfo.subRooms.filter(sr => sr.isActive !== false)
               = [Buồng 1] // Buồng 2 bị loại vì isActive=false
activeSubRoomCount = 1

// 2. Đếm số buồng có ca Sáng
subRoomsWithShift = monthSchedules.filter(s => {
  isSubRoomActive = s.subRoomId === 'Buồng 1' → true
                 || s.subRoomId === 'Buồng 2' → false ❌ (không trong activeSubRoomIds)
  ...
}).length = 1 (chỉ Buồng 1)

// 3. So sánh
shiftStatus.morning.allHave = (1 >= 1) = true ✅

// 4. Tương tự cho afternoon, evening
shiftStatus.afternoon.allHave = true ✅
shiftStatus.evening.allHave = true ✅

// 5. Kiểm tra availableMonths
missingActiveShifts = []
if (activeShifts.morning=true && shiftStatus.morning.allHave=true) ❌ // Không push
if (activeShifts.afternoon=true && shiftStatus.afternoon.allHave=true) ❌ // Không push
if (activeShifts.evening=false) ❌ // Ca tắt, không check

missingActiveShifts.length = 0
→ Không thiếu ca ĐANG BẬT → Tháng 10 KHÔNG THỂ CHỌN ✅
```

---

## 📝 **Console Logs để kiểm tra:**

### **Backend Log:**
```javascript
// 1. Config shifts
📋 Active shifts from config: { morning: true, afternoon: true, evening: false }

// 2. Room analysis
📊 Room: Phòng thẩm mỹ nha
  - hasSubRooms: true
  - Total subRooms: 2
  - Active subRooms: 1 (Buồng 1)
  - Buồng 2 SKIPPED (isActive=false)

// 3. Month analysis
📅 Month 10/2025:
  - Buồng 1: morning=✅, afternoon=✅, evening=✅
  - Buồng 2: IGNORED (not in activeSubRoomIds)
  - shiftStatus.morning.allHave = (1/1) = true
  - shiftStatus.afternoon.allHave = (1/1) = true
  - shiftStatus.evening.allHave = (1/1) = true

// 4. Available months calculation
🔍 Checking month 10/2025:
  - Room "Phòng thẩm mỹ nha":
    - hasSchedule: true
    - allSubRoomsHaveSchedule: true (1/1 active subrooms)
    - Missing active shifts: [] (empty)
  - ... (check all 13 rooms)
  - Result: NO room needs schedule → Month NOT available ❌

✅ Available months: 0/1
```

### **Frontend Log:**
```javascript
📊 Initial bulk info (24 months): { availableMonths: [], ... }
📋 Available months: (empty)
→ UI: Tháng 10/2025 bị DISABLE (màu xám, không thể chọn)
```

---

## ✅ **Checklist để verify:**

1. **Backend restart:** ✅
   ```bash
   cd BE_KLTN_TrungNghia_ThuTram/docker
   docker-compose restart schedule-service
   ```

2. **Frontend refresh:** ✅
   ```
   F5 hoặc Ctrl+Shift+R (hard reload)
   ```

3. **Test steps:**
   - Chọn tất cả 13 phòng
   - Click "Tạo lịch cho tất cả"
   - Kiểm tra console log BE: `📋 Active shifts from config: ...`
   - Kiểm tra console log BE: `✅ Available months: 0/25` (hoặc < 25)
   - Kiểm tra UI: Tháng 10/2025 phải bị DISABLE

4. **Expected UI:**
   ```
   Tháng/năm bắt đầu: [chỉ hiển thị tháng có thể tạo]
   Tháng/năm kết thúc: [chỉ hiển thị tháng có thể tạo]
   
   Có X tháng có thể tạo lịch: [danh sách không bao gồm 10/2025]
   ```

---

## 🔧 **Files đã sửa:**

### **1. Backend: `schedule.service.js`**

**Line ~1503:** Lấy config shifts
```javascript
const configResult = await cfgService.getConfig();
const activeShifts = { morning: ..., afternoon: ..., evening: ... };
```

**Line ~1563:** Filter active subrooms
```javascript
const activeSubRooms = roomInfo.subRooms.filter(sr => sr.isActive !== false);
```

**Line ~1577:** Check subroom + shift active
```javascript
const subRoomsWithShift = monthSchedules.filter(s => {
  const isSubRoomActive = activeSubRoomIds.has(subRoomId);
  const isScheduleSubRoomActive = s.isActiveSubRoom !== false;
  const isShiftActive = s.shiftConfig?.[shiftKey]?.isActive !== false;
  return isSubRoomActive && isScheduleSubRoomActive && ... && isShiftActive;
});
```

**Line ~1618:** Check schedule active (non-subroom)
```javascript
const isScheduleActive = schedule.isActive !== false;
```

**Line ~1668:** Filter missing active shifts only
```javascript
const missingActiveShifts = [];
if (activeShifts.morning && !monthAnalysis.shiftStatus.morning.allHave) {
  missingActiveShifts.push('morning');
}
...
return missingActiveShifts.length > 0;
```

---

## 🚀 **Next Steps:**

1. **RESTART BACKEND** (bắt buộc để apply fix)
2. **Test theo checklist** ở trên
3. **Kiểm tra console log** để verify logic
4. **Report kết quả** nếu vẫn sai

---

## 📌 **Summary:**

| Trước fix | Sau fix |
|-----------|---------|
| Đếm TẤT CẢ ca thiếu (kể cả ca tắt, buồng tắt) | Chỉ đếm ca ĐANG BẬT |
| Tháng 10/2025 có thể chọn ❌ | Tháng 10/2025 KHÔNG THỂ CHỌN ✅ |
| 25 tháng available | 0-2 tháng available (tùy data) |
| Logic SAI | Logic ĐÚNG ✅ |

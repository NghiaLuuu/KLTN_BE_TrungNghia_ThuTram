# 🔍 DEBUGGING GUIDE - Tạo lịch cho X phòng

## ⚠️ **Vấn đề hiện tại:**
Modal "Tạo lịch cho 13 phòng" vẫn cho phép chọn tháng 10/2025 mặc dù tất cả phòng đã có lịch đầy đủ.

## 📋 **Steps để debug:**

### **1. RESTART BACKEND** (BẮT BUỘC)
```powershell
cd BE_KLTN_TrungNghia_ThuTram/docker
docker-compose restart schedule-service

# Hoặc
cd BE_KLTN_TrungNghia_ThuTram/services/schedule-service
npm start
```

**Kiểm tra log backend khởi động thành công:**
```
✅ Schedule Service - MongoDB connected
✅ Schedule RPC server listening on queue: schedule_queue
```

---

### **2. TEST FLOW**

#### **A. Mở Console Browser (F12)**

#### **B. Refresh Frontend**
```
F5 hoặc Ctrl+Shift+R
```

#### **C. Chọn tất cả 13 phòng**
1. Click "Bật chọn nhiều phòng"
2. Click "Chọn tất cả phòng"
3. Verify: "13 phòng đã chọn"

#### **D. Click "Tạo lịch cho tất cả"**

#### **E. Kiểm tra Console Log Frontend:**
```javascript
// Log này xuất hiện khi modal mở
📊 Initial bulk info (24 months): { 
  availableMonths: [...], 
  availableShifts: {...},
  roomsAnalysis: [...]
}

// Kiểm tra availableMonths
📋 Available months: 10/2025, 11/2025, 12/2025, ...  // ❌ SAI nếu có 10/2025
📋 Available months: 11/2025, 12/2025, ...           // ✅ ĐÚNG nếu không có 10/2025
```

#### **F. Kiểm tra Console Log Backend:**
```
📊 Getting bulk schedules info for 13 rooms, 10/2025 - 10/2027
📅 Checking 25 months: 10/2025, 11/2025, ...
📋 Active shifts from config: { morning: true, afternoon: true, evening: false }
✅ Found 13/13 valid rooms
📋 Found XX existing schedules

📊 Room: Phòng thẩm mỹ nha
  - hasSubRooms: true
  - Total subRooms: 2
  - Active subRooms: 1 (Buồng 1 only)
  - Buồng 2 SKIPPED (isActive=false)

📅 Month 10/2025:
  - Buồng 1: morning=✅, afternoon=✅, evening=✅
  - Buồng 2: IGNORED (not in activeSubRoomIds)
  - shiftStatus.morning.allHave = true (1/1)

🔍 Checking month 10/2025:
  - Room "Phòng thẩm mỹ nha": Missing active shifts: []
  - ... (check all 13 rooms)

✅ Available months: 0/25  // ✅ ĐÚNG - Không có tháng 10
✅ Available months: 2/25  // Có thể có 1-2 tháng khác
```

---

### **3. EXPECTED UI BEHAVIOR**

#### **Tháng/năm bắt đầu DatePicker:**
```
10/2025 → DISABLED (màu xám, không click được) ✅
11/2025 → ENABLED (nếu có phòng thiếu lịch)
12/2025 → ENABLED (nếu có phòng thiếu lịch)
```

#### **Alert message:**
```
Có 0 tháng có thể tạo lịch trong khoảng đã chọn  // Nếu tất cả phòng đầy đủ
Có 2 tháng có thể tạo lịch trong khoảng đã chọn: 11/2025, 12/2025
```

---

### **4. VERIFY LOGIC CODE**

#### **File: `schedule.service.js` - Line ~1503**
```javascript
// 🔧 Phải có đoạn code này
const configResult = await cfgService.getConfig();
const workShifts = configResult?.data?.workShifts || {};
const activeShifts = {
  morning: workShifts.morning?.isActive !== false,
  afternoon: workShifts.afternoon?.isActive !== false,
  evening: workShifts.evening?.isActive !== false
};
console.log('📋 Active shifts from config:', activeShifts);
```

**Kiểm tra:** Mở file `schedule.service.js`, search "Active shifts from config"
- ✅ Có dòng này → Code đã update
- ❌ Không có → Code chưa update, cần pull lại code

#### **File: `schedule.service.js` - Line ~1563**
```javascript
// 🔧 Phải filter activeSubRooms
const activeSubRooms = roomInfo.subRooms.filter(sr => sr.isActive !== false);
const activeSubRoomCount = activeSubRooms.length;
const activeSubRoomIds = new Set(activeSubRooms.map(sr => sr._id.toString()));
```

**Kiểm tra:** Search "activeSubRooms"
- ✅ Có → Code đã update
- ❌ Không có → Code chưa update

#### **File: `schedule.service.js` - Line ~1668**
```javascript
// 🔧 Phải check activeShifts
const missingActiveShifts = [];
if (activeShifts.morning && !monthAnalysis.shiftStatus.morning.allHave) {
  missingActiveShifts.push('morning');
}
// ...
return missingActiveShifts.length > 0;
```

**Kiểm tra:** Search "missingActiveShifts"
- ✅ Có → Code đã update
- ❌ Không có → Code chưa update

---

### **5. TROUBLESHOOTING**

#### **Problem: Tháng 10/2025 vẫn chọn được**

**Possible causes:**

**A. Backend chưa restart**
```powershell
# Check backend log có dòng "Active shifts from config" không
# Nếu không → Backend chưa chạy code mới
→ Solution: Restart backend
```

**B. Code chưa được pull**
```bash
git status  # Check có uncommitted changes không
git pull    # Pull latest code
→ Solution: Restart backend sau khi pull
```

**C. Frontend cache**
```
Ctrl+Shift+R (hard reload)
→ Clear browser cache
→ Refresh lại page
```

**D. Database có lịch sai**
```javascript
// Check trong MongoDB
db.schedules.find({
  roomId: ObjectId('68ee84ddbc3c52f197ff3022'),
  month: 10,
  year: 2025
})

// Kiểm tra:
// - isActive: true/false?
// - isActiveSubRoom: true/false?
// - shiftConfig.*.isActive: true/false?
```

---

### **6. MANUAL VERIFICATION**

#### **Step 1: Check Backend Code**
```bash
cd BE_KLTN_TrungNghia_ThuTram/services/schedule-service/src/services
grep -n "Active shifts from config" schedule.service.js
grep -n "activeSubRooms" schedule.service.js
grep -n "missingActiveShifts" schedule.service.js
```

**Expected output:**
```
1503: console.log('📋 Active shifts from config:', activeShifts);
1563: const activeSubRooms = roomInfo.subRooms.filter(sr => sr.isActive !== false);
1668: const missingActiveShifts = [];
```

#### **Step 2: Test API Directly**
```bash
# Call API getBulkRoomSchedulesInfo
curl -X GET "http://localhost:3005/api/schedules/rooms/bulk-shifts?roomIds=68ee84ddbc3c52f197ff3022,..." \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Check response:**
```json
{
  "success": true,
  "data": {
    "availableMonths": [],  // ✅ ĐÚNG - Empty hoặc không có 10/2025
    "availableShifts": { "morning": true, "afternoon": true, "evening": false }
  }
}
```

---

### **7. FINAL CHECKLIST**

- [ ] Backend code có 3 dòng check trên (activeShifts, activeSubRooms, missingActiveShifts)
- [ ] Backend đã restart thành công
- [ ] Backend log hiển thị "📋 Active shifts from config: ..."
- [ ] Backend log hiển thị "✅ Available months: 0/25" hoặc < 25
- [ ] Frontend đã refresh (Ctrl+Shift+R)
- [ ] Frontend console log hiển thị availableMonths không chứa 10/2025
- [ ] UI: Tháng 10/2025 bị DISABLE (màu xám)
- [ ] UI: Alert message không hiển thị 10/2025 trong danh sách

---

## 📞 **Nếu vẫn sai, gửi cho tôi:**

1. **Backend console log** (full log khi gọi API getBulkRoomSchedulesInfo)
2. **Frontend console log** (log "📊 Initial bulk info")
3. **Screenshot** UI modal "Tạo lịch cho X phòng"
4. **Database query result:**
   ```javascript
   db.schedules.find({ 
     roomId: ObjectId('68ee84ddbc3c52f197ff3022'), 
     month: 10, 
     year: 2025 
   }).pretty()
   ```

Tôi sẽ phân tích và tìm lỗi chính xác! 🔍

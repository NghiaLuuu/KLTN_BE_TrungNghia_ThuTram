# Logic Tạo Lịch Cho Nhiều Phòng (Bulk Create Schedule)

## Tổng quan

Tính năng "Tạo lịch cho nhiều phòng" cho phép tạo lịch cho nhiều phòng khám cùng lúc, với logic phức tạp để xử lý:
- Phòng có/không có lịch hiện tại
- Ca đã tạo/chưa tạo
- Ca bật/tắt trong cấu hình global hoặc schedule-specific

## Luồng Xử Lý

### 1. API `getBulkRoomSchedulesInfo` (Line 1560-1870)

**Mục đích:** Phân tích nhiều phòng/tháng để xác định ca nào có thể chọn

**Input:**
- `roomIds`: Mảng ID phòng
- `fromMonth`, `toMonth`, `fromYear`, `toYear`: Khoảng thời gian

**Logic:**

#### Bước 1: Lấy Cấu Hình Global (Line 1607-1620)
```javascript
const config = await cfgService.getConfig();
const currentConfigShifts = {
  morning: config.morningShift.isActive,
  afternoon: config.afternoonShift.isActive,
  evening: config.eveningShift.isActive
};
```
- Lấy trạng thái `isActive` của 3 ca từ cấu hình hệ thống
- Đây là giá trị mặc định cho **schedules MỚI**

#### Bước 2: Lấy Tất Cả Schedules Hiện Tại (Line 1625-1640)
```javascript
const allSchedules = await Schedule.find({
  roomId: { $in: validRooms.map(r => r._id) },
  $or: [{ ... }] // Overlap date range
}).lean();
```

#### Bước 3: Phân Tích Từng Phòng/Tháng (Line 1655-1765)

**Cho phòng có subrooms:**
- Đếm số lượng subrooms **ĐANG BẬT** (`isActive=true`)
- Với mỗi ca, đếm số subrooms có:
  - Schedule với `isActiveSubRoom=true`
  - Ca đã tạo (`isGenerated=true`)
  - Ca đang bật (`isActive=true`)
- `allHave = true` nếu tất cả active subrooms đều có ca

**Cho phòng không có subrooms:**
- Tìm schedule của tháng đó
- `allHave = true` nếu schedule có ca đã tạo VÀ đang bật

#### Bước 4: Tính Toán `availableShifts` (Line 1810-1855)

**CA CÓ THỂ CHỌN KHI:**

##### Case 1: Tháng Chưa Có Schedule + Config Global Active
```javascript
if (!monthAnalysis.hasSchedule) {
  if (currentConfigShifts[shiftKey]) {
    canSelectShift = true;
  }
}
```
- Nghĩa là: Nếu tháng này chưa có schedule, check xem ca đó có đang bật trong config global không
- Khi tạo schedule mới, sẽ dùng `config.morningShift.isActive` (từ config global)

##### Case 2: Tháng Đã Có Schedule Nhưng Thiếu Ca
```javascript
else {
  if (!monthAnalysis.shiftStatus[shiftKey].allHave) {
    canSelectShift = true;
  }
}
```
- Nghĩa là: Nếu không phải tất cả phòng/subrooms đều có ca này
- `!allHave` đã bao gồm cả check `isActive` trong schedule's shiftConfig
- Khi thêm ca vào schedule hiện tại, sẽ dùng `existingSchedule.shiftConfig[shiftKey].isActive`

**Output:**
```json
{
  "roomsAnalysis": [...],
  "availableMonths": [...],
  "availableShifts": {
    "morning": true/false,
    "afternoon": true/false,
    "evening": true/false
  },
  "currentConfigShifts": {
    "morning": true/false,
    "afternoon": true/false,
    "evening": true/false
  }
}
```

---

### 2. API `generateBulkRoomSchedules` (Line 1880-2000)

**Mục đích:** Tạo lịch cho nhiều phòng

**Logic:**
- Gọi `generateRoomSchedule` cho từng phòng
- Tổng hợp kết quả theo subroom và shift

---

### 3. API `generateRoomSchedule` (Line 4577-5200)

**Mục đích:** Tạo lịch cho 1 phòng (có thể có nhiều subrooms)

#### Case A: Schedule CHƯA TỒN TẠI - Tạo Schedule Mới (Line 4944-4966)

```javascript
const shiftConfig = {
  morning: {
    ...
    isActive: config.morningShift.isActive, // ✅ Dùng CONFIG GLOBAL
    isGenerated: isSubRoomSelected && shifts.includes('morning')
  },
  afternoon: {
    ...
    isActive: config.afternoonShift.isActive, // ✅ Dùng CONFIG GLOBAL
    isGenerated: isSubRoomSelected && shifts.includes('afternoon')
  },
  evening: {
    ...
    isActive: config.eveningShift.isActive, // ✅ Dùng CONFIG GLOBAL
    isGenerated: isSubRoomSelected && shifts.includes('evening')
  }
};
```

**Validate khi tạo slots (Line 5019-5024):**
```javascript
if (shiftInfo.isActive === false) {
  console.warn(`⚠️ Shift ${shiftName} is not active (isActive=false), skipping slot generation`);
  slotsByShift[shiftKey] = 0;
  continue;
}
```

#### Case B: Schedule ĐÃ TỒN TẠI - Thêm Ca Thiếu (Line 4794-4850)

```javascript
const shiftInfo = existingSchedule.shiftConfig[shiftKey]; // ✅ Dùng SCHEDULE CONFIG

// ✅ VALIDATE: Không tạo ca đã tắt
if (shiftInfo.isActive === false) {
  console.warn(`⚠️ Shift ${shiftName} is not active (isActive=false), skipping`);
  slotsByShift[shiftKey] = 0;
  continue;
}
```

---

## Ví Dụ Cụ Thể

### Ví Dụ 1: Tháng 11/2025 - Schedule Có Sẵn

**Trạng thái:**
- Phòng A: Có schedule tháng 11, ca tối `isActive=false`
- Phòng B: Có schedule tháng 11, ca tối `isActive=false`

**Kết quả `getBulkRoomSchedulesInfo`:**
```json
{
  "availableShifts": {
    "morning": true,   // Cả 2 phòng có thể thêm ca sáng
    "afternoon": true, // Cả 2 phòng có thể thêm ca chiều
    "evening": false   // ❌ Tất cả schedules đều tắt ca tối
  }
}
```

**Nếu user chọn tạo ca tối:**
- Frontend: Checkbox ca tối bị disable
- Backend: Nếu somehow request vẫn được gửi, `generateRoomSchedule` sẽ skip ca tối vì `shiftInfo.isActive=false`

---

### Ví Dụ 2: Tháng 12/2025 - Chưa Có Schedule

**Trạng thái:**
- Phòng A: Chưa có schedule tháng 12
- Phòng B: Chưa có schedule tháng 12
- Config global: Ca tối `isActive=false`

**Kết quả `getBulkRoomSchedulesInfo`:**
```json
{
  "availableShifts": {
    "morning": true,   // Config global có ca sáng bật
    "afternoon": true, // Config global có ca chiều bật
    "evening": false   // ❌ Config global tắt ca tối
  },
  "currentConfigShifts": {
    "morning": true,
    "afternoon": true,
    "evening": false
  }
}
```

**Nếu user chọn tạo lịch:**
- Tạo schedule mới với `shiftConfig.evening.isActive=false` (copy từ config global)
- Không tạo slots cho ca tối vì `shiftInfo.isActive=false`

---

### Ví Dụ 3: Tháng 1/2026 - Mixed

**Trạng thái:**
- Phòng A: Chưa có schedule tháng 1
- Phòng B: Có schedule tháng 1, ca tối `isActive=false`
- Config global: Ca tối `isActive=true`

**Kết quả `getBulkRoomSchedulesInfo`:**
```json
{
  "availableShifts": {
    "morning": true,
    "afternoon": true,
    "evening": true  // ✅ Phòng A có thể tạo ca tối (config global bật)
  }
}
```

**Nếu user chọn tạo ca tối:**
- Phòng A: Tạo schedule mới với `shiftConfig.evening.isActive=true` (từ config global), tạo slots thành công ✅
- Phòng B: Thêm vào schedule hiện tại, nhưng skip vì `existingSchedule.shiftConfig.evening.isActive=false` ⏭️

---

## Điểm Quan Trọng

### 1. Dual Config Source
- **Schedule mới:** Dùng `config.morningShift.isActive` (global)
- **Schedule cũ:** Dùng `existingSchedule.shiftConfig[shift].isActive` (schedule-specific)

### 2. Why This Design?
- Schedule có thể có cấu hình khác với config global
- Ví dụ: Config global bật ca tối, nhưng schedule tháng 11 tắt ca tối (do admin quyết định)
- Khi thêm ca vào schedule tháng 11, phải tôn trọng quyết định đã lưu trong schedule

### 3. Validation Layers
1. **Frontend:** Disable checkbox nếu `availableShifts[shift]=false`
2. **Backend `getBulkRoomSchedulesInfo`:** Tính toán `availableShifts` dựa trên config + schedules
3. **Backend `generateRoomSchedule`:** Validate `isActive` khi tạo slots (final safeguard)

### 4. Performance
- `getBulkRoomSchedulesInfo` chỉ gọi 1 lần query lấy tất cả schedules
- Không cần N queries cho N phòng
- Frontend cache kết quả trong `bulkInfo` state

---

## Troubleshooting

### Ca không thể chọn mặc dù phòng chưa có lịch?
- Check `currentConfigShifts` trong response
- Có thể config global đã tắt ca đó

### Ca không thể chọn mặc dù schedule chưa có ca?
- Check `schedule.shiftConfig[shift].isActive`
- Có thể schedule đã tắt ca đó (khác config global)

### Tạo lịch thành công nhưng không có slots?
- Check logs: `⚠️ Shift ... is not active (isActive=false), skipping slot generation`
- Nghĩa là validation layer cuối đã bắt được ca tắt

---

## Code Locations

- **Frontend:** `src/components/Schedule/BulkCreateScheduleModal.jsx`
  - Line 322-337: `availableShifts` calculation
  - Line 730-760: Shift checkboxes rendering
  
- **Backend:** `services/schedule-service/src/services/schedule.service.js`
  - Line 1560-1870: `getBulkRoomSchedulesInfo`
  - Line 1880-2000: `generateBulkRoomSchedules`
  - Line 4577-5200: `generateRoomSchedule`

# 📅 API TẠO LỊCH LÀM VIỆC CHO PHÒNG KHÁM

## 🎯 Tổng quan

API `POST /api/schedules/room/generate` được sử dụng để **tạo lịch làm việc** cho các phòng khám trong hệ thống SmileCare Dental Clinic. API này hỗ trợ tạo lịch theo tháng với nhiều tính năng linh hoạt.

---

## 📍 Endpoint

```
POST /api/schedules/room/generate
```

**Authorization:** Yêu cầu token của `manager` hoặc `admin`

---

## 📥 Request Body

### Các tham số bắt buộc:

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `roomId` | String | ID của phòng khám cần tạo lịch |
| `fromMonth` | Number (1-12) | Tháng bắt đầu |
| `toMonth` | Number (1-12) | Tháng kết thúc |
| `fromYear` | Number | Năm bắt đầu |
| `toYear` | Number | Năm kết thúc |
| `startDate` | ISO Date String | Ngày bắt đầu tạo lịch (cho tháng đầu tiên) |
| `shifts` | Array[String] | Các ca được chọn để tạo: `['morning', 'afternoon', 'evening']` |

### Các tham số tùy chọn:

| Tham số | Kiểu | Mô tả |
|---------|------|-------|
| `subRoomId` | String | ID của buồng (dùng cho phòng có nhiều buồng) - **Legacy** |
| `selectedSubRoomIds` | Array[String] | Danh sách ID các buồng được chọn để sinh slots |
| `partialStartDate` | ISO Date String | Ngày bắt đầu tạo lịch (dùng khi thêm ca thiếu) |
| `year` | Number | Năm (deprecated - dùng `fromYear`/`toYear`) |

---

## 📤 Response

### Success Response (201 Created):

```json
{
  "success": true,
  "message": "Tạo lịch thành công",
  "data": {
    "results": [
      {
        "month": 1,
        "year": 2025,
        "status": "created",
        "scheduleId": "schedule_id_123",
        "totalSlots": 240,
        "slotsByShift": {
          "morning": 80,
          "afternoon": 80,
          "evening": 80
        }
      },
      {
        "month": 2,
        "year": 2025,
        "status": "created",
        "scheduleId": "schedule_id_456",
        "totalSlots": 240,
        "slotsByShift": {
          "morning": 80,
          "afternoon": 80,
          "evening": 80
        }
      }
    ],
    "totalMonths": 2,
    "totalSlots": 480,
    "message": "Đã tạo lịch thành công cho 2 tháng với tổng cộng 480 slots"
  }
}
```

### Error Response (400/403/500):

```json
{
  "success": false,
  "message": "Lỗi cụ thể ở đây"
}
```

---

## 🔧 Cách hoạt động

### 1. **Validation đầu vào**

API sẽ kiểm tra:
- ✅ `roomId`, `fromMonth`, `toMonth`, `fromYear`, `toYear`, `startDate`, `shifts` phải có đầy đủ
- ✅ Tháng phải từ 1-12
- ✅ Năm kết thúc >= Năm bắt đầu
- ✅ Nếu cùng năm: Tháng kết thúc >= Tháng bắt đầu
- ✅ Phải chọn ít nhất 1 ca (`shifts.length > 0`)
- ✅ Ca chỉ được là: `'morning'`, `'afternoon'`, `'evening'`
- ✅ `selectedSubRoomIds` phải là mảng (nếu có)
- ✅ `partialStartDate` phải sau ngày hiện tại ít nhất 1 ngày (nếu có)

### 2. **Xác định các tháng cần tạo**

API sẽ tính toán tất cả các tháng từ `fromMonth/fromYear` đến `toMonth/toYear`:

**Ví dụ 1:** Cùng năm
```
fromMonth: 1, toMonth: 3, fromYear: 2025, toYear: 2025
→ Tạo: 1/2025, 2/2025, 3/2025 (3 tháng)
```

**Ví dụ 2:** Khác năm
```
fromMonth: 11, toMonth: 2, fromYear: 2024, toYear: 2025
→ Tạo: 11/2024, 12/2024, 1/2025, 2/2025 (4 tháng)
```

**Ví dụ 3:** Nhiều năm
```
fromMonth: 10, toMonth: 3, fromYear: 2024, toYear: 2026
→ Tạo: 
  - 2024: 10, 11, 12 (3 tháng)
  - 2025: 1-12 (12 tháng)
  - 2026: 1, 2, 3 (3 tháng)
  Tổng: 18 tháng
```

### 3. **Xử lý phòng có/không có buồng**

#### Phòng KHÔNG có buồng (hasSubRooms = false):
- Tạo 1 schedule cho phòng chính
- Sinh slots theo ca được chọn
- Mỗi slot = thời gian cả ca

#### Phòng CÓ buồng (hasSubRooms = true):
- Tạo schedule cho **TẤT CẢ** các buồng (kể cả inactive)
- Sinh slots CHỈ cho các buồng được chọn trong `selectedSubRoomIds`
- Nếu không có `selectedSubRoomIds` → Sinh slots cho tất cả buồng active
- Mỗi slot = `config.unitDuration` (mặc định 15 phút)

**Quan trọng:**
```javascript
// Tạo schedule: ALL subrooms (để track trạng thái)
allSubRoomIds = [subRoom1, subRoom2, subRoom3, ...]

// Sinh slots: CHỈ subrooms được chọn
selectedSubRoomIds = [subRoom1, subRoom2]
→ Chỉ sinh slots cho subRoom1 và subRoom2
```

### 4. **Xử lý trường hợp đã có lịch**

#### Trường hợp 1: Lịch ĐÃ TỒN TẠI + Tất cả ca đã được tạo
```
Status: "skipped"
Message: "Đã có lịch từ 01/01/2025 đến 31/01/2025 (Ca Sáng, Ca Chiều, Ca Tối)"
→ Bỏ qua, không làm gì
```

#### Trường hợp 2: Lịch ĐÃ TỒN TẠI + Thiếu một số ca
```
Ví dụ: Lịch đã có Ca Sáng, user muốn thêm Ca Chiều và Ca Tối

Status: "updated"
Message: "Đã thêm afternoon, evening vào lịch hiện có"
→ Thêm slots cho các ca còn thiếu
→ Cập nhật shiftConfig.isGenerated = true cho các ca mới
```

#### Trường hợp 3: Chưa có lịch
```
Status: "created"
→ Tạo mới schedule
→ Sinh slots cho các ca được chọn
→ Set shiftConfig.isGenerated = true cho các ca được tạo
```

### 5. **Snapshot Holiday**

Khi tạo lịch, hệ thống sẽ:
- Lấy danh sách ngày nghỉ lễ trong khoảng thời gian
- Lưu vào `holidaySnapshot` của schedule
- **KHÔNG sinh slots** cho các ngày nghỉ lễ
- Snapshot này giúp tracking ngày nghỉ dù sau này config holiday có thay đổi

### 6. **Shift Config Snapshot**

Mỗi schedule lưu snapshot của 3 ca:

```javascript
shiftConfig: {
  morning: {
    name: "Ca Sáng",
    startTime: "08:00",
    endTime: "12:00",
    slotDuration: 15,
    isActive: true,        // Trạng thái ca tại thời điểm tạo
    isGenerated: true      // Đã sinh slots cho ca này chưa
  },
  afternoon: { ... },
  evening: { ... }
}
```

**isGenerated vs isActive:**
- `isActive`: Trạng thái từ config (ca có đang hoạt động không)
- `isGenerated`: Ca này đã được tạo slots chưa
- Có thể có: `isActive=false` + `isGenerated=true` (ca đã tạo nhưng sau đó bị tắt)

---

## 📊 Use Cases

### Use Case 1: Tạo lịch mới cho phòng đơn giản

**Request:**
```json
{
  "roomId": "room_123",
  "fromMonth": 1,
  "toMonth": 3,
  "fromYear": 2025,
  "toYear": 2025,
  "startDate": "2025-01-01T00:00:00.000Z",
  "shifts": ["morning", "afternoon", "evening"]
}
```

**Kết quả:**
- Tạo 3 schedules (tháng 1, 2, 3 năm 2025)
- Mỗi schedule có slots cho 3 ca
- Tổng slots: ~720 slots (3 tháng × 3 ca × ~80 slots/ca)

---

### Use Case 2: Tạo lịch cho phòng có nhiều buồng

**Request:**
```json
{
  "roomId": "room_with_subrooms",
  "selectedSubRoomIds": ["subRoom1", "subRoom2"],
  "fromMonth": 1,
  "toMonth": 1,
  "fromYear": 2025,
  "toYear": 2025,
  "startDate": "2025-01-01T00:00:00.000Z",
  "shifts": ["morning", "afternoon"]
}
```

**Kết quả:**
- Tạo schedules cho TẤT CẢ buồng của phòng (ví dụ: 5 buồng)
- Sinh slots CHỈ cho 2 buồng được chọn (subRoom1, subRoom2)
- Mỗi buồng được chọn có slots cho 2 ca (sáng, chiều)
- Các buồng còn lại có schedule nhưng không có slots (isGenerated=false)

**Lý do:** Để tracking trạng thái của tất cả buồng, dù chưa tạo slots

---

### Use Case 3: Thêm ca thiếu vào lịch đã có

**Tình huống:**
- Tháng 1/2025 đã có lịch Ca Sáng
- Muốn thêm Ca Chiều và Ca Tối từ ngày 15/01/2025

**Request:**
```json
{
  "roomId": "room_123",
  "fromMonth": 1,
  "toMonth": 1,
  "fromYear": 2025,
  "toYear": 2025,
  "startDate": "2025-01-01T00:00:00.000Z",
  "partialStartDate": "2025-01-15T00:00:00.000Z",
  "shifts": ["afternoon", "evening"]
}
```

**Kết quả:**
- Phát hiện lịch tháng 1 đã tồn tại
- Chỉ sinh slots cho Ca Chiều và Ca Tối
- CHỈ tạo slots từ 15/01 đến 31/01 (không tạo từ đầu tháng)
- Cập nhật `shiftConfig.afternoon.isGenerated = true`
- Cập nhật `shiftConfig.evening.isGenerated = true`

---

### Use Case 4: Tạo lịch nhiều tháng (cross-year)

**Request:**
```json
{
  "roomId": "room_123",
  "fromMonth": 11,
  "toMonth": 2,
  "fromYear": 2024,
  "toYear": 2025,
  "startDate": "2024-11-01T00:00:00.000Z",
  "shifts": ["morning", "afternoon", "evening"]
}
```

**Kết quả:**
- Tạo 4 schedules:
  - 11/2024 (từ 01/11 đến 30/11)
  - 12/2024 (từ 01/12 đến 31/12)
  - 01/2025 (từ 01/01 đến 31/01)
  - 02/2025 (từ 01/02 đến 28/02)
- Mỗi schedule có slots cho 3 ca
- Xử lý ngày nghỉ Tết (30/12-05/01) tự động

---

## ⚠️ Validation & Error Handling

### Error 400 - Bad Request:

```json
// Thiếu thông tin
{
  "success": false,
  "message": "Thiếu thông tin: roomId, fromMonth, toMonth, fromYear/toYear (hoặc year), startDate, và shifts là bắt buộc"
}

// Tháng không hợp lệ
{
  "success": false,
  "message": "Tháng phải từ 1-12"
}

// Năm không hợp lệ
{
  "success": false,
  "message": "Năm kết thúc phải >= Năm bắt đầu"
}

// Không chọn ca
{
  "success": false,
  "message": "Phải chọn ít nhất 1 ca để tạo lịch"
}

// Ca không hợp lệ
{
  "success": false,
  "message": "Ca không hợp lệ: night. Chỉ chấp nhận: morning, afternoon, evening"
}

// selectedSubRoomIds không hợp lệ
{
  "success": false,
  "message": "selectedSubRoomIds phải là mảng"
}

// Không chọn buồng
{
  "success": false,
  "message": "Phải chọn ít nhất 1 buồng để tạo lịch"
}

// partialStartDate không hợp lệ
{
  "success": false,
  "message": "Ngày bắt đầu tạo lịch phải sau ngày hiện tại ít nhất 1 ngày"
}
```

### Error 403 - Forbidden:

```json
{
  "success": false,
  "message": "Chỉ quản lý hoặc admin mới được phép tạo lịch"
}
```

### Error 500 - Internal Server Error:

```json
{
  "success": false,
  "message": "Không tìm thấy cấu hình lịch làm việc. Vui lòng tạo cấu hình trước."
}

{
  "success": false,
  "message": "Không tìm thấy thông tin phòng room_123 trong cache"
}

{
  "success": false,
  "message": "Thời gian cấu hình cho Ca Sáng không hợp lệ"
}
```

---

## 🎯 Business Rules

### 1. **Quy tắc tạo schedule cho phòng có buồng:**

```
✅ LUÔN tạo schedule cho TẤT CẢ buồng
❌ KHÔNG sinh slots cho buồng không được chọn
→ Mục đích: Tracking trạng thái của tất cả buồng
```

**Ví dụ:**
```
Room có 5 buồng: A, B, C, D, E
User chọn: B, C
→ Tạo 5 schedules (A, B, C, D, E)
→ Sinh slots CHỈ cho B, C
→ A, D, E: schedule.shiftConfig.*.isGenerated = false
```

### 2. **Quy tắc isActive vs isGenerated:**

```javascript
// CA ĐÃ TẠO nhưng sau đó BỊ TẮT trong config
schedule.shiftConfig.morning = {
  isActive: false,      // Config hiện tại: ca bị tắt
  isGenerated: true     // Lịch sử: ca đã từng được tạo
}
→ Slots vẫn tồn tại, có thể booking

// CA CHƯA TẠO
schedule.shiftConfig.morning = {
  isActive: true,       // Config hiện tại: ca đang bật
  isGenerated: false    // Lịch sử: chưa tạo slots cho ca này
}
→ Không có slots, không thể booking
```

### 3. **Quy tắc xử lý holiday:**

```
Ngày nghỉ lễ:
→ KHÔNG sinh slots
→ Lưu vào holidaySnapshot để tracking
→ Dù sau này holiday config thay đổi, schedule vẫn giữ snapshot

Ví dụ:
holidaySnapshot: [
  {
    date: "2025-01-01",
    name: "Tết Dương lịch",
    type: "official"
  }
]
```

### 4. **Quy tắc partialStartDate:**

```
Dùng khi: Thêm ca thiếu vào lịch đã có
Validate:
  ✅ partialStartDate > today + 1 day
  ✅ partialStartDate <= schedule.endDate

Ví dụ:
Schedule: 01/01 - 31/01
partialStartDate: 15/01
→ Sinh slots CHỈ từ 15/01 đến 31/01
→ Không tạo lại slots từ 01/01 - 14/01
```

---

## 📈 Performance & Optimization

### 1. **Redis Cache:**
```javascript
// Lấy thông tin room từ cache (fast)
const roomInfo = await getRoomByIdFromCache(roomId);

// Không cần query DB mỗi lần
→ Giảm DB load
→ Tăng tốc độ response
```

### 2. **Batch Processing:**
```javascript
// Tạo nhiều tháng trong 1 request
fromMonth: 1, toMonth: 12
→ Tạo 12 schedules trong 1 lần
→ Giảm số lượng API calls
```

### 3. **Skip Logic:**
```javascript
// Phát hiện lịch đã tồn tại → Skip
if (existingSchedule && allShiftsGenerated) {
  return { status: 'skipped' };
}
→ Không tạo duplicate
→ Tiết kiệm DB operations
```

### 4. **Conflict Detection:**
```javascript
// Check overlap schedules
const overlappingSchedules = await Schedule.find({
  roomId,
  subRoomId,
  $or: [{ startDate: { $lte: end }, endDate: { $gte: start } }]
});
→ Tránh tạo slots trùng lặp
```

---

## 🔄 Workflow

```
1. User chọn:
   - Phòng
   - Buồng (nếu có)
   - Khoảng thời gian (tháng/năm)
   - Ca làm việc
   - Ngày bắt đầu (cho tháng đầu)
   
2. Frontend gửi request →

3. Backend validate:
   ✅ Authorization (manager/admin)
   ✅ Input data
   ✅ Date ranges
   ✅ Shifts valid
   
4. Backend tính toán:
   → Danh sách tháng cần tạo
   → Danh sách buồng cần process
   → Holiday snapshot
   
5. Duyệt từng tháng:
   → Check lịch đã tồn tại?
     → Có + đầy đủ ca: Skip
     → Có + thiếu ca: Update (thêm ca)
     → Chưa có: Create new
   
6. Tạo schedule:
   → Lưu shiftConfig snapshot
   → Lưu holiday snapshot
   → Set isGenerated cho ca được tạo
   
7. Sinh slots:
   → Duyệt từng ngày (trừ ngày nghỉ)
   → Tạo slots theo unitDuration
   → Lưu vào DB
   
8. Return response:
   → Tổng số tháng tạo
   → Tổng số slots
   → Chi tiết từng tháng
```

---

## 📝 Notes

### Backward Compatibility:
```javascript
// Hỗ trợ cả 2 cách:
// Cách cũ (deprecated)
{ year: 2025, fromMonth: 1, toMonth: 3 }

// Cách mới (recommended)
{ fromYear: 2025, toYear: 2025, fromMonth: 1, toMonth: 3 }
```

### SubRoom Selection:
```javascript
// Legacy: single subRoomId
{ subRoomId: "subRoom1" }

// New: multiple subRoomIds
{ selectedSubRoomIds: ["subRoom1", "subRoom2"] }

// No selection: all active subrooms
{ selectedSubRoomIds: null }
```

### Slot Duration:
```javascript
// Room WITHOUT subrooms:
slotDuration = shift duration
// Ví dụ: Ca Sáng 08:00-12:00 → 1 slot = 240 phút

// Room WITH subrooms:
slotDuration = config.unitDuration
// Ví dụ: config.unitDuration = 15 → 1 slot = 15 phút
```

---

## 🎓 Best Practices

### 1. **Tạo lịch theo batch:**
```javascript
// ✅ GOOD: Tạo nhiều tháng cùng lúc
{
  fromMonth: 1,
  toMonth: 6,
  fromYear: 2025,
  toYear: 2025
}
→ 1 API call = 6 tháng

// ❌ BAD: Tạo từng tháng
for (month = 1; month <= 6; month++) {
  await createSchedule({ month });
}
→ 6 API calls
```

### 2. **Chọn buồng cụ thể:**
```javascript
// ✅ GOOD: Chỉ tạo cho buồng cần dùng
{
  selectedSubRoomIds: ["subRoom1", "subRoom2"]
}
→ Tiết kiệm slots, nhanh hơn

// ❌ BAD: Tạo cho tất cả
{
  selectedSubRoomIds: null
}
→ Tạo nhiều slots không cần thiết
```

### 3. **Sử dụng partialStartDate:**
```javascript
// ✅ GOOD: Chỉ thêm ca từ ngày cụ thể
{
  partialStartDate: "2025-01-15",
  shifts: ["evening"]
}
→ Chỉ tạo từ 15/01, không override slots cũ

// ❌ BAD: Không dùng partialStartDate
→ Có thể tạo duplicate hoặc bị skip
```

---

## 🐛 Troubleshooting

### Problem 1: "Schedule already exists with all requested shifts"

**Nguyên nhân:**
- Lịch tháng này đã có đầy đủ các ca được yêu cầu

**Giải pháp:**
- Kiểm tra lại lịch hiện tại
- Nếu muốn tạo lại: Xóa lịch cũ trước
- Nếu muốn thêm ca khác: Chọn ca khác trong `shifts`

---

### Problem 2: "Không tìm thấy cấu hình lịch làm việc"

**Nguyên nhân:**
- Chưa tạo Schedule Config

**Giải pháp:**
1. Vào Settings → Schedule Configuration
2. Tạo config với:
   - Morning shift time
   - Afternoon shift time
   - Evening shift time
   - Unit duration (for subrooms)
3. Lưu config
4. Thử lại API

---

### Problem 3: Slots không được tạo cho buồng

**Nguyên nhân:**
- Buồng không nằm trong `selectedSubRoomIds`
- Hoặc buồng inactive + không được chọn

**Giải pháp:**
```javascript
// Kiểm tra response:
{
  "status": "created",
  "scheduleId": "...",
  "totalSlots": 0  // ← No slots generated
}

// Thêm buồng vào selectedSubRoomIds:
{
  "selectedSubRoomIds": ["subRoom1", "subRoom2", "subRoom3"]
}
```

---

### Problem 4: "Ngày bắt đầu tạo lịch phải sau ngày hiện tại"

**Nguyên nhân:**
- `partialStartDate` <= today

**Giải pháp:**
```javascript
// ❌ Wrong
{
  "partialStartDate": "2025-01-10"  // today = 2025-01-10
}

// ✅ Correct
{
  "partialStartDate": "2025-01-11"  // tomorrow
}
```

---

## 📚 Related APIs

### Liên quan đến Schedule:
```
GET  /api/schedules                    - List schedules
GET  /api/schedules/room/:roomId       - Get schedules by room
GET  /api/schedules/:scheduleId        - Get schedule detail
PUT  /api/schedules/:scheduleId        - Update schedule
POST /api/schedules/add-missing-shifts - Add missing shifts
```

### Liên quan đến Configuration:
```
GET  /api/config                       - Get schedule config
POST /api/config                       - Create config
PUT  /api/config                       - Update config
```

### Liên quan đến Holiday:
```
GET  /api/schedules/holiday-preview    - Preview holidays
GET  /api/holidays                     - List holidays
```

---

## 🎉 Summary

API `generateRoomSchedule` là một API mạnh mẽ và linh hoạt cho việc:

✅ **Tạo lịch nhiều tháng** (cross-year support)
✅ **Hỗ trợ phòng có/không có buồng**
✅ **Chọn ca linh hoạt** (morning, afternoon, evening)
✅ **Thêm ca thiếu** vào lịch đã có (partial scheduling)
✅ **Tự động xử lý ngày nghỉ** (holiday snapshot)
✅ **Tracking trạng thái** (isActive, isGenerated)
✅ **Skip duplicate** (intelligent conflict detection)
✅ **Performance optimized** (Redis cache, batch processing)

**Use this API when:**
- 📅 Tạo lịch làm việc mới
- 📝 Thêm ca thiếu vào lịch đã có
- 🔄 Tạo lịch cho nhiều tháng cùng lúc
- 🏥 Quản lý lịch phòng có nhiều buồng

---

**Tài liệu được tạo:** October 18, 2025  
**API Version:** 1.0.0  
**Status:** ✅ Production Ready

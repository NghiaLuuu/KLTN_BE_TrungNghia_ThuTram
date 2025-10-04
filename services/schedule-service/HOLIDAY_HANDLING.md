# Holiday Handling in Schedule Service

## 📋 Tổng quan

Document này mô tả cách hệ thống xử lý holidays (ngày nghỉ) trong việc tạo lịch và slots.

## 🎯 Business Rules

### 1. Holiday Model
```javascript
{
  name: String,           // Tên kỳ nghỉ
  startDate: Date,        // Ngày bắt đầu (ISO8601)
  endDate: Date,          // Ngày kết thúc (ISO8601)
  note: String,           // Ghi chú (optional)
  isActive: Boolean,      // Trạng thái hoạt động
  hasBeenUsed: Boolean    // Đã được sử dụng trong hệ thống chưa
}
```

### 2. Holiday Lifecycle

```
[Created] → [Used in Schedule] → [Locked]
   ↓              ↓                  ↓
hasBeenUsed    hasBeenUsed       hasBeenUsed
= false        = true            = true
   ↓              ↓                  ↓
Can Update/    Cannot Update/    Cannot Update/
Delete         Delete            Delete
```

## 🔒 Validation Rules

### Create Holiday
- ✅ `startDate` >= today
- ✅ `endDate` >= today
- ✅ `endDate` >= `startDate`
- ✅ No overlap with existing holidays
- ✅ Unique name

### Update Holiday
- ✅ Same date validations as create
- ✅ **hasBeenUsed must be false**
- ✅ No overlap with other holidays
- ✅ Unique name

### Delete Holiday
- ✅ **hasBeenUsed must be false**

## 🔄 Schedule Generation Flow

### Manual Schedule Creation (`POST /schedules`)

```javascript
// Flow:
1. User creates schedule with startDate/endDate
2. generateSlotsCore() loops through each day
3. FOR EACH DAY:
   - Check if isHoliday(date) → Skip if true
   - Create slots for that day
4. After slots created:
   - Find overlapping holidays in date range
   - Mark each holiday.hasBeenUsed = true
```

**Code Location:** `schedule.service.js`
- Line 991: `isHoliday()` check in `generateSlotsCore`
- Line 1148-1157: Mark holidays as used in `createSchedule`

### Auto Schedule Generation (Quarter)

```javascript
// Flow:
1. System triggers auto-generation for quarter
2. generateQuarterSchedule(quarter, year)
3. FOR EACH ROOM:
   - generateScheduleForRoom()
   - FOR EACH DAY in quarter:
     - Check if isHoliday(date) → Skip if true
     - Create schedule + slots
4. After ALL rooms processed:
   - Find overlapping holidays in quarter date range
   - Mark each holiday.hasBeenUsed = true
```

**Code Location:** `schedule.service.js`
- Line 554: `isHoliday()` check in `generateScheduleForRoom`
- Line 366-377: Mark holidays as used in `generateQuarterSchedule`

### Auto Schedule for Single Room

```javascript
// Flow:
1. System triggers auto-generation for specific room
2. generateQuarterScheduleForSingleRoom(roomId, quarter, year)
3. generateScheduleForRoom() for that room only
4. After room processed:
   - Find overlapping holidays in quarter date range
   - Mark each holiday.hasBeenUsed = true
```

**Code Location:** `schedule.service.js`
- Line 554: `isHoliday()` check (reuses same function)
- Line 500-511: Mark holidays as used

## 📊 Holiday Check Logic

### isHoliday(date)
```javascript
async function isHoliday(date) {
  // 1. Fetch all holidays from config
  const holidayConfig = await cfgService.getHolidays();
  const holidays = holidayConfig?.holidays || [];
  
  // 2. Convert date to VN date string (YYYY-MM-DD)
  const checkVN = toVNDateOnlyString(date);
  
  // 3. Check if date falls within any holiday range
  return holidays.some(holiday => {
    const startVN = toVNDateOnlyString(new Date(holiday.startDate));
    const endVN = toVNDateOnlyString(new Date(holiday.endDate));
    return checkVN >= startVN && checkVN <= endVN;
  });
}
```

**Features:**
- ✅ Works with date ranges (multi-day holidays)
- ✅ Uses Vietnam timezone
- ✅ Inclusive comparison (includes both start and end dates)

## 🎯 Holiday Marking Logic

### checkHolidaysUsedInDateRange(startDate, endDate)
```javascript
// Returns array of holidays that overlap with given date range
// Overlap condition: !(holiday.end < range.start || holiday.start > range.end)
```

### markHolidayAsUsed(holidayId)
```javascript
// Sets hasBeenUsed = true for specific holiday
// This is irreversible in normal workflow
// Only admin can manually reset via database
```

**Code Location:** `scheduleConfig.service.js`
- Line 245: `checkHolidaysUsedInDateRange`
- Line 231: `markHolidayAsUsed`

## 🚫 What Happens to Holiday Slots

**Holiday dates are completely EXCLUDED from schedule:**

1. **No schedules created** for holiday dates
2. **No slots created** for holiday dates
3. **Appointments cannot be booked** on holidays
4. **Calendar APIs skip** holiday dates

**Example:**
```javascript
// Holiday: 2025-01-28 to 2025-02-05 (Tết)
// Schedule range: 2025-01-01 to 2025-03-31

// Result:
// ✅ Slots created: Jan 1-27
// ❌ Slots skipped: Jan 28 - Feb 5 (holiday range)
// ✅ Slots created: Feb 6 - Mar 31
```

## 🔐 Protection Mechanisms

### 1. Validation Layer
- `holiday.validation.js`: Validates date formats and future dates
- Prevents creation of holidays in the past

### 2. Business Logic Layer
- `scheduleConfig.service.js`: Checks `hasBeenUsed` before update/delete
- Returns clear error messages

### 3. Schedule Generation Layer
- `schedule.service.js`: Skips holiday dates during slot creation
- Marks holidays as used after successful schedule creation

## 📝 Error Messages

### Update/Delete Locked Holiday
```json
{
  "success": false,
  "message": "Không thể cập nhật/xóa ngày nghỉ \"Tết Nguyên Đán\" vì đã được sử dụng trong hệ thống",
  "type": "HOLIDAY_IN_USE"
}
```

### Create Holiday in Past
```json
{
  "success": false,
  "errors": [
    {
      "field": "startDate",
      "message": "Start date must be today or in the future"
    }
  ]
}
```

### Date Range Overlap
```json
{
  "success": false,
  "message": "Updated holiday range overlaps with existing holiday 'Tết Nguyên Đán'"
}
```

## 🧪 Testing Scenarios

### Scenario 1: Create Schedule Spanning Holiday
```javascript
// Given: Holiday exists for 2025-12-25 (Christmas)
// When: Create schedule from 2025-12-20 to 2025-12-30
// Then:
// ✅ Slots created for Dec 20-24
// ❌ No slots for Dec 25
// ✅ Slots created for Dec 26-30
// ✅ Christmas holiday marked hasBeenUsed=true
```

### Scenario 2: Try to Update Used Holiday
```javascript
// Given: Holiday hasBeenUsed=true
// When: PATCH /holidays/123 { "name": "Updated Name" }
// Then: Error 400 "Không thể cập nhật ngày nghỉ vì đã được sử dụng"
```

### Scenario 3: Create Holiday After Schedule Exists
```javascript
// Given: Schedule exists for entire January
// When: Create holiday for Jan 15-17
// Then: 
// ✅ Holiday created successfully
// ⚠️ BUT slots already exist for Jan 15-17 (need manual cleanup or slot hiding)
// Note: This is an edge case - ideally create holidays BEFORE schedules
```

## 🎓 Best Practices

1. **Create holidays BEFORE generating schedules**
   - Holidays should be configured at the start of each quarter
   - Use POST /holidays API

2. **Plan ahead**
   - Add all known holidays for the year
   - Update holiday list during quarterly planning

3. **Avoid retroactive changes**
   - Don't try to add holidays after schedules are generated
   - If needed, use slot hiding APIs instead

4. **Monitor hasBeenUsed flag**
   - Check this before attempting updates
   - Understand that locked holidays cannot be changed

## 📚 Related APIs

### Holiday Management
- `POST /api/config/holidays` - Create holiday
- `GET /api/config/holidays` - List all holidays
- `PATCH /api/config/holidays/:id` - Update holiday (if hasBeenUsed=false)
- `DELETE /api/config/holidays/:id` - Delete holiday (if hasBeenUsed=false)

### Schedule Generation
- `POST /api/schedules/quarter/:quarter/:year` - Generate quarter (auto marks holidays)
- `POST /api/schedules` - Create manual schedule (auto marks holidays)

### Slot Management
- `POST /api/slots/hide-range` - Hide existing slots (workaround for retroactive holidays)
- `POST /api/slots/show-range` - Show hidden slots

## 🐛 Troubleshooting

**Q: I created a holiday but slots still exist for that date**
- A: This happens if schedule was created BEFORE holiday was added. Use slot hiding API to hide those slots.

**Q: Can't update holiday that was never used in any schedule**
- A: Check if `hasBeenUsed` was incorrectly set to true. This might be a data issue. Admin can manually reset in database if needed.

**Q: Holiday overlaps with another holiday**
- A: System prevents this. You must delete or adjust one of the conflicting holidays first.

---

## 📅 Change Log

- **2025-01-XX**: Initial implementation of holiday handling
- **2025-01-XX**: Added `hasBeenUsed` protection mechanism
- **2025-01-XX**: Added holiday skip logic to `generateSlotsCore`
- **2025-01-XX**: Added holiday marking to `generateQuarterSchedule` and `generateQuarterScheduleForSingleRoom`

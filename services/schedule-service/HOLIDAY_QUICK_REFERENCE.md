# Holiday Handling - Quick Reference

## ✅ Đã hoàn thiện

### 1. Validation Layer
**File:** `holiday.validation.js`

✅ **CREATE validation:**
- startDate >= today
- endDate >= today  
- endDate >= startDate

✅ **UPDATE validation:**
- Same as CREATE (if dates provided)
- Additional check in service: `hasBeenUsed` must be false

✅ **DELETE validation:**
- Service check: `hasBeenUsed` must be false

---

### 2. Business Logic Layer
**File:** `scheduleConfig.service.js`

✅ **updateHolidayById (line 373):**
```javascript
if (current.hasBeenUsed) {
  throw new Error('Không thể cập nhật ngày nghỉ vì đã được sử dụng');
}
```

✅ **removeHoliday (line 338):**
```javascript
if (holidayToRemove.hasBeenUsed) {
  throw new Error('Không thể xóa ngày nghỉ vì đã được sử dụng');
}
```

✅ **Helper functions:**
- `checkHolidaysUsedInDateRange()` - Find overlapping holidays
- `markHolidayAsUsed()` - Set hasBeenUsed = true

---

### 3. Schedule Generation Layer
**File:** `schedule.service.js`

✅ **generateSlotsCore (line 991):**
```javascript
// Skip holidays - don't create slots
const isHolidayDay = await isHoliday(new Date(dayString));
if (isHolidayDay) {
  console.log(`📅 Skipping holiday: ${dayString}`);
  continue;
}
```

✅ **createSchedule (line 1148-1157):**
```javascript
// Mark holidays as used after creating schedule
const overlappingHolidays = await cfgService.checkHolidaysUsedInDateRange(...);
for (const holiday of overlappingHolidays) {
  await cfgService.markHolidayAsUsed(holiday._id);
}
```

✅ **generateQuarterSchedule (line 366-377):**
```javascript
// Mark holidays as used after generating quarter
if (successCount > 0) {
  const overlappingHolidays = await cfgService.checkHolidaysUsedInDateRange(...);
  for (const holiday of overlappingHolidays) {
    await cfgService.markHolidayAsUsed(holiday._id);
  }
}
```

✅ **generateQuarterScheduleForSingleRoom (line 500-511):**
```javascript
// Mark holidays as used after generating for single room (auto-schedule)
const overlappingHolidays = await cfgService.checkHolidaysUsedInDateRange(...);
for (const holiday of overlappingHolidays) {
  await cfgService.markHolidayAsUsed(holiday._id);
}
```

✅ **generateScheduleForRoom (line 554):**
```javascript
// Skip holiday dates when creating daily schedules
const isHolidayDay = await isHoliday(currentDate);
if (!isHolidayDay) {
  // Create schedule...
}
```

---

## 🎯 Flow Summary

### Manual Schedule Creation
```
User → POST /schedules
  ↓
generateSlotsCore
  ↓
FOR EACH DAY: check isHoliday() → skip if true
  ↓
Create slots (holidays excluded)
  ↓
Mark overlapping holidays as used ✅
```

### Auto Schedule (Quarter - All Rooms)
```
Cron Job → generateQuarterSchedule
  ↓
FOR EACH ROOM:
  generateScheduleForRoom
    ↓
    FOR EACH DAY: check isHoliday() → skip if true
    ↓
    Create schedules + slots (holidays excluded)
  ↓
Mark overlapping holidays as used ✅
```

### Auto Schedule (Single Room)
```
Cron Job → generateQuarterScheduleForSingleRoom
  ↓
generateScheduleForRoom
  ↓
FOR EACH DAY: check isHoliday() → skip if true
  ↓
Create schedules + slots (holidays excluded)
  ↓
Mark overlapping holidays as used ✅
```

---

## 🔒 Protection Matrix

| Operation | Validation Check | Business Logic Check | Result |
|-----------|------------------|---------------------|--------|
| **CREATE holiday** | ✅ Dates in future<br>✅ Valid range | ✅ No overlap<br>✅ Unique name | New holiday with hasBeenUsed=false |
| **UPDATE holiday (not used)** | ✅ Dates in future<br>✅ Valid range | ✅ hasBeenUsed=false<br>✅ No overlap | Updated successfully |
| **UPDATE holiday (used)** | ✅ Pass | ❌ **hasBeenUsed=true** | **Error: Cannot update** |
| **DELETE holiday (not used)** | ✅ Valid ID | ✅ hasBeenUsed=false | Deleted + slots shown |
| **DELETE holiday (used)** | ✅ Pass | ❌ **hasBeenUsed=true** | **Error: Cannot delete** |
| **Generate schedule** | N/A | ✅ Skip holiday dates<br>✅ Mark used | Slots created (holidays excluded) |

---

## 📍 Key Functions

### isHoliday(date)
- **Location:** `schedule.service.js` line 172
- **Purpose:** Check if a date falls within any holiday range
- **Returns:** Boolean
- **Used by:** All slot generation functions

### markHolidayAsUsed(holidayId)
- **Location:** `scheduleConfig.service.js` line 231
- **Purpose:** Set hasBeenUsed = true (irreversible)
- **Called by:** All schedule generation functions

### checkHolidaysUsedInDateRange(start, end)
- **Location:** `scheduleConfig.service.js` line 245
- **Purpose:** Find all holidays overlapping with date range
- **Returns:** Array of holiday objects
- **Called by:** All schedule generation functions

---

## 🧪 Test Cases

### ✅ Test 1: Create holiday for future dates
```json
POST /api/config/holidays
{
  "name": "Tết 2026",
  "startDate": "2026-01-28",
  "endDate": "2026-02-05"
}
// Expected: 201 Created, hasBeenUsed=false
```

### ❌ Test 2: Create holiday in past
```json
POST /api/config/holidays
{
  "startDate": "2024-12-01",
  "endDate": "2024-12-05"
}
// Expected: 400 "Start date must be today or in the future"
```

### ✅ Test 3: Generate schedule skips holidays
```javascript
// Given: Holiday 2025-12-25
// When: Generate schedule for December 2025
// Then: No slots created for Dec 25
// And: Holiday.hasBeenUsed = true
```

### ❌ Test 4: Try to update used holiday
```json
PATCH /api/config/holidays/123
{
  "name": "Updated Name"
}
// Given: Holiday has hasBeenUsed=true
// Expected: 400 "Không thể cập nhật vì đã được sử dụng"
```

### ❌ Test 5: Try to delete used holiday
```json
DELETE /api/config/holidays/123
// Given: Holiday has hasBeenUsed=true
// Expected: 400 "Không thể xóa vì đã được sử dụng"
```

---

## 🎯 Todo / Future Enhancements

- [ ] Admin API to force unlock holiday (reset hasBeenUsed)
- [ ] Bulk holiday creation (import from CSV/Excel)
- [ ] Holiday templates (recurring patterns)
- [ ] Holiday preview (show affected slots before marking as used)
- [ ] Holiday usage report (which schedules use which holidays)

---

## 📚 Related Documentation

- Full details: `HOLIDAY_HANDLING.md`
- API docs: Swagger UI at `/api-docs`
- Model schema: `scheduleConfig.model.js`
- Validation rules: `holiday.validation.js`

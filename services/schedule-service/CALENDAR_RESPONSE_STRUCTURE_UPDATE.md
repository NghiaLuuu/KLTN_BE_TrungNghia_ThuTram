# Calendar API Response Structure Update

## Tóm tắt

Đã cập nhật response structure của `getDentistCalendar` và `getNurseCalendar` để có cấu trúc `periods` giống với `getRoomCalendar`, bao gồm `startDate`, `endDate`, và `days`.

---

## Vấn đề trước đây

### Room Calendar (Đã có từ trước)
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-09-29",
      "endDate": "2025-10-05",
      "viewType": "week",
      "totalDays": 4,
      "days": [ ... ]
    }
  ]
}
```
✅ Có `startDate`, `endDate` rất trực quan

### Dentist/Nurse Calendar (Trước khi sửa)
```json
{
  "periods": [
    {
      "date": "2025-10-02",
      "shifts": { ... },
      "totalAppointments": 0,
      "totalSlots": 32
    },
    {
      "date": "2025-10-03",
      "shifts": { ... }
    },
    ...
  ]
}
```
❌ Mỗi period chỉ là 1 ngày
❌ Không có `startDate`, `endDate` để biết range của week/month
❌ Khó biết một period bao gồm những ngày nào

---

## Solution

Đã cập nhật `getDentistCalendar` và `getNurseCalendar` để có cấu trúc giống `getRoomCalendar`:

### Dentist/Nurse Calendar (Sau khi sửa)
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-09-29",
      "endDate": "2025-10-05",
      "viewType": "week",
      "totalDays": 4,
      "days": [
        {
          "date": "2025-10-02",
          "shifts": { ... },
          "totalAppointments": 0,
          "totalSlots": 32
        },
        {
          "date": "2025-10-03",
          "shifts": { ... }
        },
        ...
      ]
    }
  ]
}
```
✅ Có `startDate`, `endDate` cho mỗi period
✅ `days` array chứa tất cả ngày trong period đó
✅ `periodIndex` để tracking
✅ `totalDays` để biết số ngày có data
✅ Cấu trúc nhất quán giữa 3 API (room, dentist, nurse)

---

## Chi tiết thay đổi

### 1. Từ flat array → Grouped periods

**Trước:**
```javascript
// Mỗi day là một item riêng trong periods array
const calendarPeriods = calendarArray.map(day => {
  // Process day...
  return day;
});
```

**Sau:**
```javascript
// Group days vào periods dựa trên date range
const calendarPeriods = periods.map((period, index) => {
  const periodCalendar = {};
  
  // Format dates
  const periodStartStr = period.start.getFullYear() + '-' + 
    String(period.start.getMonth() + 1).padStart(2, '0') + '-' + 
    String(period.start.getDate()).padStart(2, '0');
  const periodEndStr = period.end.getFullYear() + '-' + 
    String(period.end.getMonth() + 1).padStart(2, '0') + '-' + 
    String(period.end.getDate()).padStart(2, '0');
  
  // Filter days within this period
  calendarArray.forEach(day => {
    if (day.date >= periodStartStr && day.date <= periodEndStr) {
      periodCalendar[day.date] = day;
    }
  });
  
  // Build period structure
  return {
    periodIndex: (page - 1) * limit + index + 1,
    startDate: periodStartStr,
    endDate: periodEndStr,
    viewType,
    totalDays: daysInPeriod.length,
    days: daysInPeriod
  };
});
```

### 2. Preserved room statistics logic

Vẫn giữ logic tính toán `mostFrequentRoom` cho từng shift như cũ, chỉ thay đổi cách organize data.

---

## Response Structure Comparison

### Day View (limit có thể > 1)

#### Before:
```json
{
  "periods": [
    { "date": "2025-10-01", "shifts": {...} },
    { "date": "2025-10-02", "shifts": {...} },
    { "date": "2025-10-03", "shifts": {...} }
  ]
}
```

#### After:
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-10-01",
      "endDate": "2025-10-01",
      "viewType": "day",
      "totalDays": 1,
      "days": [{ "date": "2025-10-01", "shifts": {...} }]
    },
    {
      "periodIndex": 2,
      "startDate": "2025-10-02",
      "endDate": "2025-10-02",
      "viewType": "day",
      "totalDays": 1,
      "days": [{ "date": "2025-10-02", "shifts": {...} }]
    },
    {
      "periodIndex": 3,
      "startDate": "2025-10-03",
      "endDate": "2025-10-03",
      "viewType": "day",
      "totalDays": 1,
      "days": [{ "date": "2025-10-03", "shifts": {...} }]
    }
  ]
}
```

### Week View (limit = 1)

#### Before:
```json
{
  "periods": [
    { "date": "2025-09-29", "shifts": {...} },
    { "date": "2025-09-30", "shifts": {...} },
    { "date": "2025-10-01", "shifts": {...} },
    { "date": "2025-10-02", "shifts": {...} },
    { "date": "2025-10-03", "shifts": {...} },
    { "date": "2025-10-04", "shifts": {...} },
    { "date": "2025-10-05", "shifts": {...} }
  ]
}
```
❌ Không rõ 7 ngày này thuộc tuần nào

#### After:
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-09-29",
      "endDate": "2025-10-05",
      "viewType": "week",
      "totalDays": 7,
      "days": [
        { "date": "2025-09-29", "shifts": {...} },
        { "date": "2025-09-30", "shifts": {...} },
        { "date": "2025-10-01", "shifts": {...} },
        { "date": "2025-10-02", "shifts": {...} },
        { "date": "2025-10-03", "shifts": {...} },
        { "date": "2025-10-04", "shifts": {...} },
        { "date": "2025-10-05", "shifts": {...} }
      ]
    }
  ]
}
```
✅ Rõ ràng đây là 1 tuần từ 29/9 → 5/10

### Month View (limit = 1)

#### Before:
```json
{
  "periods": [
    { "date": "2025-10-01", "shifts": {...} },
    { "date": "2025-10-02", "shifts": {...} },
    ...
    { "date": "2025-10-31", "shifts": {...} }
  ]
}
```
❌ Không rõ tháng nào

#### After:
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-10-01",
      "endDate": "2025-10-31",
      "viewType": "month",
      "totalDays": 31,
      "days": [
        { "date": "2025-10-01", "shifts": {...} },
        { "date": "2025-10-02", "shifts": {...} },
        ...
        { "date": "2025-10-31", "shifts": {...} }
      ]
    }
  ]
}
```
✅ Rõ ràng đây là tháng 10/2025

---

## Benefits

### 1. Consistency
✅ Tất cả 3 calendar APIs (room, dentist, nurse) có cùng structure
✅ Frontend code có thể reuse logic xử lý response

### 2. Clarity
✅ Dễ dàng hiển thị header "Tuần từ 29/9 → 5/10"
✅ Biết chính xác range của period để highlight dates

### 3. Navigation
✅ Frontend có thể hiển thị navigation: "← Tuần trước | Tuần 1 (29/9-5/10) | Tuần sau →"
✅ `periodIndex` giúp tracking position

### 4. Data Integrity
✅ `totalDays` cho biết số ngày có data (có thể < 7 cho week view nếu không có slots)
✅ Frontend có thể validate data completeness

---

## Frontend Integration Example

### Before (Old response)
```javascript
// Khó biết period range
const response = await fetch('/api/slots/dentist/d1/calendar?viewType=week');
const { periods } = response.data;

// Phải tự tính start/end date
const firstDate = periods[0].date;
const lastDate = periods[periods.length - 1].date;
console.log(`Week from ${firstDate} to ${lastDate}`);
```

### After (New response)
```javascript
// Rõ ràng ngay
const response = await fetch('/api/slots/dentist/d1/calendar?viewType=week');
const { periods } = response.data;

// Có sẵn start/end date
const period = periods[0];
console.log(`Week ${period.periodIndex}: ${period.startDate} to ${period.endDate}`);
console.log(`Total days with data: ${period.totalDays}`);

// Render header
<h2>Tuần từ {formatDate(period.startDate)} - {formatDate(period.endDate)}</h2>

// Render days
{period.days.map(day => (
  <DayCard key={day.date} date={day.date} shifts={day.shifts} />
))}
```

---

## Testing

### Test Case 1: Week View
```bash
curl "http://localhost:3005/api/slots/dentist/d1/calendar?viewType=week"
```

**Expected Response:**
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-09-29",
      "endDate": "2025-10-05",
      "viewType": "week",
      "totalDays": 7,
      "days": [ ... ]
    }
  ]
}
```

### Test Case 2: Month View
```bash
curl "http://localhost:3005/api/slots/nurse/n1/calendar?viewType=month"
```

**Expected Response:**
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-10-01",
      "endDate": "2025-10-31",
      "viewType": "month",
      "totalDays": 31,
      "days": [ ... ]
    }
  ]
}
```

### Test Case 3: Day View with limit=3
```bash
curl "http://localhost:3005/api/slots/dentist/d1/calendar?viewType=day&limit=3"
```

**Expected Response:**
```json
{
  "periods": [
    {
      "periodIndex": 1,
      "startDate": "2025-10-04",
      "endDate": "2025-10-04",
      "viewType": "day",
      "totalDays": 1,
      "days": [ ... ]
    },
    {
      "periodIndex": 2,
      "startDate": "2025-10-05",
      "endDate": "2025-10-05",
      "viewType": "day",
      "totalDays": 1,
      "days": [ ... ]
    },
    {
      "periodIndex": 3,
      "startDate": "2025-10-06",
      "endDate": "2025-10-06",
      "viewType": "day",
      "totalDays": 1,
      "days": [ ... ]
    }
  ]
}
```

---

## Files Modified

1. **Service:** `services/schedule-service/src/services/slot.service.js`
   - `getDentistCalendar`: Updated to use periods grouping logic
   - `getNurseCalendar`: Updated to use periods grouping logic

2. **Documentation:** `CALENDAR_API_REFACTOR.md`
   - Updated response examples for dentist and nurse calendars

---

## Migration Guide for Frontend

### Breaking Changes
⚠️ Response structure changed for dentist and nurse calendars

**Old code:**
```javascript
const { periods } = response.data;
periods.forEach(day => {
  console.log(day.date, day.shifts);
});
```

**New code:**
```javascript
const { periods } = response.data;
periods.forEach(period => {
  console.log(`Period: ${period.startDate} to ${period.endDate}`);
  period.days.forEach(day => {
    console.log(day.date, day.shifts);
  });
});
```

### Backward Compatible Access
```javascript
// If you need flat list of all days (like before)
const allDays = periods.flatMap(period => period.days);
allDays.forEach(day => {
  console.log(day.date, day.shifts);
});
```

---

## Date: 2025-10-04
## Author: Schedule Service Team

# Fix: October/November Holiday Detection Bug

## 🐛 Problem Description

**Symptom:** When creating schedules, holiday detection skips the wrong days:
- **October/November 2024**: Skips **Monday (Thứ 2)** instead of Sunday (Chủ nhật)
- **December 2024**: Correctly skips **Sunday (Chủ nhật)**

This is a **critical production bug** affecting schedule accuracy.

## 🔍 Root Cause Analysis

### Timeline of Events

1. **Initial Bug (Before Fix)**
   - `recurringHolidays` collection had **wrong `dayOfWeek` values**
   - Example: Sunday might have been stored as `dayOfWeek: 7` or `dayOfWeek: 2` instead of `dayOfWeek: 1`
   - Caused by mixing local time and UTC methods

2. **October/November Schedule Creation**
   - Schedules created when bug existed
   - `computeDaysOff()` function used **wrong holiday data** from database
   - Generated `computedDaysOff` array with **incorrect dates**
   - This snapshot saved to schedule document

3. **Bug Fix Applied**
   - Fixed timezone handling (all UTC methods)
   - Fixed dayOfWeek conversion: `getUTCDay() + 1` (0→1, 1→2, etc.)
   - Corrected `recurringHolidays` data in database

4. **December Schedule Creation**
   - Schedule created **after** bug fix
   - `computeDaysOff()` used **corrected holiday data**
   - Generated correct `computedDaysOff`
   - Works perfectly

### How `isHolidayFromSnapshot()` Works

```javascript
function isHolidayFromSnapshot(date, holidaySnapshot) {
  // PRIORITY 1: Check pre-computed days off (if exists)
  if (holidaySnapshot.computedDaysOff && holidaySnapshot.computedDaysOff.length > 0) {
    return holidaySnapshot.computedDaysOff.some(day => day.date === dateStr);
  }
  
  // FALLBACK: Manual check using recurringHolidays + nonRecurringHolidays
  const dayOfWeek = checkDate.getUTCDay() + 1;
  const isRecurringHoliday = recurringHolidays.some(h => h.dayOfWeek === dayOfWeek);
  return isRecurringHoliday || isNonRecurringHoliday;
}
```

**The Problem:**
- October/November schedules have `computedDaysOff` with **pre-computed wrong data**
- Priority path is used → Returns wrong results
- December schedules have correct `computedDaysOff` → Works fine

## ✅ Solution

### Migration Strategy

**Goal:** Regenerate `computedDaysOff` for all existing schedules using current (corrected) holiday data.

**Key Requirements:**
1. Re-fetch current `recurringHolidays` from database (corrected values)
2. Re-run `computeDaysOff()` function for each schedule's date range
3. **Preserve existing shift override status** (important!)
4. Update `holidaySnapshot.computedDaysOff` in schedule documents

### Files Created

#### 1. `verify-holiday-issue.js` - Verification Script
**Purpose:** Diagnose the issue before fixing

**Usage:**
```bash
cd services/schedule-service
node verify-holiday-issue.js
```

**What it does:**
- Shows current `recurringHolidays` in database
- Checks Oct/Nov/Dec 2024 schedules
- Analyzes `computedDaysOff` for each schedule
- Counts Sundays vs Mondays detected
- Identifies schedules with wrong data

**Example Output:**
```
📋 Current Recurring Holidays in DB:
   Nghỉ Chủ nhật: dayOfWeek=1 (Chủ nhật)

📅 Checking October 2024...
   Found 2 schedule(s)
   
   📄 Schedule ID: 673abc123...
      computedDaysOff count: 5
      First 5 computed days off:
         2024-10-07 (Thứ 2, dayOfWeek=2): Nghỉ Chủ nhật  ← WRONG!
         2024-10-14 (Thứ 2, dayOfWeek=2): Nghỉ Chủ nhật  ← WRONG!
      
      🔍 Analysis:
         Sundays detected: 0
         Mondays detected: 5
         ⚠️  ISSUE FOUND: No Sundays but has Mondays!
```

#### 2. `fix-computed-daysoff-migration.js` - Migration Script
**Purpose:** Fix the issue by regenerating `computedDaysOff`

**Usage:**
```bash
cd services/schedule-service
node fix-computed-daysoff-migration.js
```

**What it does:**
1. Finds all schedules in database
2. For each schedule:
   - Re-fetches current holiday data
   - Re-generates `computedDaysOff` using corrected data
   - **Preserves shift override status** from old data
   - Updates schedule document
3. Shows summary of changes

**Example Output:**
```
📅 Processing Schedule: 10/2024 (ID: 673abc123...)
   Old computedDaysOff count: 5
   New computedDaysOff count: 4
   ⚠️  Day count changed: 5 → 4
   Sample days (first 3):
      2024-10-06 (Sunday): Nghỉ Chủ nhật  ← CORRECT!
      2024-10-13 (Sunday): Nghỉ Chủ nhật  ← CORRECT!
   ✅ Updated successfully

📊 Migration Summary:
   ✅ Updated: 25
   ⏭️  Skipped: 0
   ❌ Errors: 0
   📝 Total: 25
   
🎉 Migration completed successfully!
```

### Important: Preserving Shift Overrides

The migration script **preserves** any existing shift overrides:

```javascript
// If a date exists in both old and new computedDaysOff
const oldDay = oldComputedDaysOff.find(d => d.date === newDay.date);

if (oldDay && oldDay.shifts) {
  // Preserve override status from old data
  return {
    ...newDay,
    shifts: {
      morning: oldDay.shifts.morning || newDay.shifts.morning,
      afternoon: oldDay.shifts.afternoon || newDay.shifts.afternoon,
      evening: oldDay.shifts.evening || newDay.shifts.evening
    }
  };
}
```

This ensures that any holidays that were already overridden (slots created) maintain their override status after migration.

## 🚀 Execution Steps

### Step 1: Verify the Issue
```bash
cd c:\Users\ADMINS\Downloads\KLTN\BE_KLTN_TrungNghia_ThuTram\services\schedule-service
node verify-holiday-issue.js
```

**Expected Result:**
- October/November: Shows Mondays detected instead of Sundays
- December: Shows Sundays detected correctly

### Step 2: Backup Database (IMPORTANT!)
```bash
# MongoDB backup
mongodump --db kltn_db --out backup_before_migration_$(date +%Y%m%d)
```

### Step 3: Run Migration
```bash
node fix-computed-daysoff-migration.js
```

**Expected Result:**
- All schedules updated with correct `computedDaysOff`
- Shift overrides preserved
- Summary shows number of updated schedules

### Step 4: Verify Fix
```bash
node verify-holiday-issue.js
```

**Expected Result:**
- All months now show Sundays detected correctly
- No more Mondays being detected as holidays

### Step 5: Test Schedule Creation
1. Open frontend application
2. Navigate to "Tạo lịch làm việc"
3. Create a test schedule for October 2024
4. Verify that Sundays (not Mondays) are skipped
5. Check generated slots to ensure no Sunday slots exist

## 📊 Technical Details

### DayOfWeek Convention

**Our System (Database):**
- `1` = Sunday (Chủ nhật)
- `2` = Monday (Thứ 2)
- `3` = Tuesday (Thứ 3)
- `4` = Wednesday (Thứ 4)
- `5` = Thursday (Thứ 5)
- `6` = Friday (Thứ 6)
- `7` = Saturday (Thứ 7)

**JavaScript `Date.getUTCDay()`:**
- `0` = Sunday
- `1` = Monday
- `2` = Tuesday
- `3` = Wednesday
- `4` = Thursday
- `5` = Friday
- `6` = Saturday

**dayjs `.day()`:**
- Same as JavaScript: `0` = Sunday, `1` = Monday, etc.

**Conversion Formula:**
```javascript
// Convert JavaScript day (0-6) to our convention (1-7)
const dayOfWeek = jsDay + 1;

// For Sunday specifically:
// jsDay = 0 → dayOfWeek = 1 ✅

// For Monday specifically:
// jsDay = 1 → dayOfWeek = 2 ✅
```

### Files Modified

**New Files:**
- `services/schedule-service/verify-holiday-issue.js` - Verification script
- `services/schedule-service/fix-computed-daysoff-migration.js` - Migration script
- `services/schedule-service/FIX_OCTOBER_NOVEMBER_HOLIDAY_BUG.md` - This documentation

**Existing Files (Already Fixed):**
- `services/schedule-service/src/services/schedule.service.js`
  - Line 27-95: `computeDaysOff()` - Uses correct conversion
  - Line 620-660: `isHolidayFromSnapshot()` - Uses correct conversion
  - Line 2022-2293: `createScheduleOverrideHoliday()` - Uses correct conversion

## 🧪 Testing Checklist

After migration, verify:

- [ ] October 2024 schedules skip Sundays (not Mondays)
- [ ] November 2024 schedules skip Sundays (not Mondays)
- [ ] December 2024 schedules still skip Sundays correctly
- [ ] New schedules for any month skip correct days
- [ ] Existing shift overrides still work
- [ ] "Tạo lịch làm việc trong ngày nghỉ" modal still works
- [ ] Holiday override slots still show correct information

## 🔄 Rollback Plan

If something goes wrong:

1. **Restore from backup:**
   ```bash
   mongorestore --db kltn_db backup_before_migration_YYYYMMDD/kltn_db
   ```

2. **Or revert individual schedules:**
   ```javascript
   // In MongoDB shell or Compass
   db.schedules.updateMany(
     { month: 10, year: 2024 },
     { $set: { 'holidaySnapshot.computedDaysOff': [] } }
   )
   ```
   This will force schedules to use fallback logic (which is also fixed now)

## 📝 Related Issues Fixed

This migration also fixes:
- ✅ Timezone bugs in holiday detection
- ✅ DayOfWeek conversion errors
- ✅ Inconsistent behavior between different months
- ✅ Shift-level tracking in computedDaysOff (already has shifts structure)

## 🎯 Success Criteria

Migration is successful when:
1. All schedules have correct `computedDaysOff` with Sundays (dayOfWeek=1)
2. No schedules have Mondays incorrectly marked as holidays
3. Existing shift overrides are preserved
4. New schedule creation works correctly for all months
5. Holiday override feature continues to work

## ⚠️ Important Notes

1. **Run during low traffic period** - Migration updates all schedules
2. **Backup database first** - Always have a rollback plan
3. **Test on staging environment** - If available
4. **Monitor after deployment** - Check for any unexpected behavior
5. **Shift overrides are preserved** - Existing holiday override slots remain valid

## 📞 Support

If issues occur after migration:
1. Check migration script output for errors
2. Run verification script to confirm data
3. Review schedule documents in MongoDB Compass
4. Check application logs for holiday detection errors
5. Contact development team with schedule IDs showing issues

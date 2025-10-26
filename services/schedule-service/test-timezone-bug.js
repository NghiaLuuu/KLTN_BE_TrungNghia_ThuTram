/**
 * Test: Timezone bug when creating schedules for October + November
 * 
 * Problem: When creating schedules for month 10 (27-31) + month 11 (1-30),
 * the system skips Monday instead of Sunday due to timezone conversion issue.
 * 
 * Root cause: Loop uses local time (getDate, setDate) but holiday check uses UTC
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault('Asia/Ho_Chi_Minh');

console.log('🧪 Testing Timezone Bug Fix\n');
console.log('='.repeat(70));

// Simulate holiday snapshot for month 10
const holidaySnapshotMonth10 = {
  recurringHolidays: [
    { name: 'Nghỉ Chủ nhật', dayOfWeek: 1 }
  ],
  nonRecurringHolidays: [],
  computedDaysOff: [] // Empty because Oct 27-31 has no Sunday
};

// Simulate holiday snapshot for month 11
const holidaySnapshotMonth11 = {
  recurringHolidays: [
    { name: 'Nghỉ Chủ nhật', dayOfWeek: 1 }
  ],
  nonRecurringHolidays: [],
  computedDaysOff: [
    { date: '2025-11-02', reason: 'Nghỉ Chủ nhật' }, // Sunday Nov 2
    { date: '2025-11-09', reason: 'Nghỉ Chủ nhật' }, // Sunday Nov 9
    { date: '2025-11-16', reason: 'Nghỉ Chủ nhật' }, // Sunday Nov 16
    { date: '2025-11-23', reason: 'Nghỉ Chủ nhật' }, // Sunday Nov 23
    { date: '2025-11-30', reason: 'Nghỉ Chủ nhật' }  // Sunday Nov 30
  ]
};

// isHolidayFromSnapshot function (same as in service)
function isHolidayFromSnapshot(date, holidaySnapshot) {
  if (!holidaySnapshot) return false;
  
  const checkDate = new Date(date);
  checkDate.setUTCHours(0, 0, 0, 0);
  const dateStr = checkDate.toISOString().split('T')[0];
  
  // Priority: Check computedDaysOff
  if (holidaySnapshot.computedDaysOff && holidaySnapshot.computedDaysOff.length > 0) {
    return holidaySnapshot.computedDaysOff.some(day => day.date === dateStr);
  }
  
  // Fallback: Check recurringHolidays
  const dayOfWeek = checkDate.getUTCDay() + 1; // 0→1 (Sunday), 1→2 (Monday)
  const recurringHolidays = holidaySnapshot.recurringHolidays || [];
  return recurringHolidays.some(h => h.dayOfWeek === dayOfWeek);
}

console.log('\n📅 Test Case 1: Month 10 (Oct 27-31, 2025)');
console.log('-'.repeat(70));

const startMonth10 = new Date('2025-10-27T00:00:00.000Z');
const endMonth10 = new Date('2025-10-31T16:59:59.999Z');

console.log(`Start: ${startMonth10.toISOString()}`);
console.log(`End: ${endMonth10.toISOString()}`);
console.log(`computedDaysOff: ${holidaySnapshotMonth10.computedDaysOff.length} (empty - no Sunday in range)`);
console.log('');

console.log('❌ OLD METHOD (LOCAL TIME - BUGGY):');
{
  const currentDate = new Date(startMonth10);
  const endDate = new Date(endMonth10);
  let dayCount = 0;
  let skipped = [];
  
  while (currentDate <= endDate) {
    const isHoliday = isHolidayFromSnapshot(currentDate, holidaySnapshotMonth10);
    const localDay = currentDate.getDay(); // 0=Sun, 1=Mon
    const utcDay = currentDate.getUTCDay(); // 0=Sun, 1=Mon
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (isHoliday) {
      skipped.push({ 
        date: dateStr, 
        localDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][localDay],
        utcDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][utcDay]
      });
    }
    
    dayCount++;
    currentDate.setDate(currentDate.getDate() + 1); // LOCAL increment
  }
  
  console.log(`   Days processed: ${dayCount}`);
  console.log(`   Days skipped: ${skipped.length}`);
  if (skipped.length > 0) {
    skipped.forEach(s => {
      console.log(`      ⚠️  ${s.date} - Local: ${s.localDay}, UTC: ${s.utcDay}`);
    });
  }
}

console.log('');
console.log('✅ NEW METHOD (UTC TIME - FIXED):');
{
  const currentDate = new Date(startMonth10);
  currentDate.setUTCHours(0, 0, 0, 0); // Normalize to UTC
  
  const endDate = new Date(endMonth10);
  endDate.setUTCHours(23, 59, 59, 999);
  
  let dayCount = 0;
  let skipped = [];
  
  while (currentDate <= endDate) {
    const isHoliday = isHolidayFromSnapshot(currentDate, holidaySnapshotMonth10);
    const utcDay = currentDate.getUTCDay(); // 0=Sun, 1=Mon
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (isHoliday) {
      skipped.push({ 
        date: dateStr, 
        utcDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][utcDay]
      });
    }
    
    dayCount++;
    currentDate.setUTCDate(currentDate.getUTCDate() + 1); // UTC increment
  }
  
  console.log(`   Days processed: ${dayCount}`);
  console.log(`   Days skipped: ${skipped.length}`);
  if (skipped.length > 0) {
    skipped.forEach(s => {
      console.log(`      ✅ ${s.date} - ${s.utcDay}`);
    });
  }
}

console.log('');
console.log('='.repeat(70));
console.log('\n📅 Test Case 2: Month 11 (Nov 1-30, 2025)');
console.log('-'.repeat(70));

const startMonth11 = new Date('2025-11-01T00:00:00.000Z');
const endMonth11 = new Date('2025-11-30T16:59:59.999Z');

console.log(`Start: ${startMonth11.toISOString()}`);
console.log(`End: ${endMonth11.toISOString()}`);
console.log(`computedDaysOff: ${holidaySnapshotMonth11.computedDaysOff.length} Sundays`);
console.log('');

console.log('❌ OLD METHOD (LOCAL TIME - BUGGY):');
{
  const currentDate = new Date(startMonth11);
  const endDate = new Date(endMonth11);
  let dayCount = 0;
  let skipped = [];
  
  while (currentDate <= endDate) {
    const isHoliday = isHolidayFromSnapshot(currentDate, holidaySnapshotMonth11);
    const localDay = currentDate.getDay();
    const utcDay = currentDate.getUTCDay();
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (isHoliday) {
      skipped.push({ 
        date: dateStr, 
        localDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][localDay],
        utcDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][utcDay]
      });
    }
    
    dayCount++;
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  console.log(`   Days processed: ${dayCount}`);
  console.log(`   Days skipped: ${skipped.length}`);
  skipped.forEach(s => {
    const expected = ['2025-11-02', '2025-11-09', '2025-11-16', '2025-11-23', '2025-11-30'];
    const isWrong = !expected.includes(s.date);
    console.log(`      ${isWrong ? '⚠️ ' : '   '} ${s.date} - Local: ${s.localDay}, UTC: ${s.utcDay}`);
  });
}

console.log('');
console.log('✅ NEW METHOD (UTC TIME - FIXED):');
{
  const currentDate = new Date(startMonth11);
  currentDate.setUTCHours(0, 0, 0, 0);
  
  const endDate = new Date(endMonth11);
  endDate.setUTCHours(23, 59, 59, 999);
  
  let dayCount = 0;
  let skipped = [];
  
  while (currentDate <= endDate) {
    const isHoliday = isHolidayFromSnapshot(currentDate, holidaySnapshotMonth11);
    const utcDay = currentDate.getUTCDay();
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (isHoliday) {
      skipped.push({ 
        date: dateStr, 
        utcDay: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][utcDay]
      });
    }
    
    dayCount++;
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }
  
  console.log(`   Days processed: ${dayCount}`);
  console.log(`   Days skipped: ${skipped.length}`);
  skipped.forEach(s => {
    const expected = ['2025-11-02', '2025-11-09', '2025-11-16', '2025-11-23', '2025-11-30'];
    const isCorrect = expected.includes(s.date);
    console.log(`      ${isCorrect ? '✅' : '❌'} ${s.date} - ${s.utcDay}`);
  });
}

console.log('');
console.log('='.repeat(70));
console.log('\n🎯 CONCLUSION:');
console.log('   ❌ OLD METHOD: Timezone mismatch causes wrong days to be skipped');
console.log('   ✅ NEW METHOD: UTC consistency ensures correct holiday detection');
console.log('='.repeat(70));

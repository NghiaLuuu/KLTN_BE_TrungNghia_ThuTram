/**
 * Test: Fallback logic when computedDaysOff is empty
 * 
 * This happens for month 10 (Oct 27-31) which has NO Sunday
 * but when checking Nov 1-2, it might use month 10's holidaySnapshot
 */

console.log('🧪 Testing Fallback Logic Bug\n');
console.log('='.repeat(70));

// Holiday snapshot with EMPTY computedDaysOff (like month 10)
const holidaySnapshot = {
  recurringHolidays: [
    { name: 'Nghỉ Chủ nhật', dayOfWeek: 1 }  // 1 = Sunday
  ],
  nonRecurringHolidays: [],
  computedDaysOff: []  // EMPTY - triggers fallback
};

function isHolidayFromSnapshot(date, holidaySnapshot) {
  if (!holidaySnapshot) return false;
  
  const checkDate = new Date(date);
  checkDate.setUTCHours(0, 0, 0, 0);
  const dateStr = checkDate.toISOString().split('T')[0];
  
  console.log(`  Checking ${dateStr}:`);
  
  // Priority: Check computedDaysOff
  if (holidaySnapshot.computedDaysOff && holidaySnapshot.computedDaysOff.length > 0) {
    console.log(`    → Using computedDaysOff (${holidaySnapshot.computedDaysOff.length} items)`);
    return holidaySnapshot.computedDaysOff.some(day => day.date === dateStr);
  }
  
  // Fallback
  console.log(`    → Using FALLBACK (computedDaysOff is empty)`);
  const dayOfWeek = checkDate.getUTCDay() + 1;
  console.log(`    → UTC day: ${checkDate.getUTCDay()} → dayOfWeek: ${dayOfWeek}`);
  
  const recurringHolidays = holidaySnapshot.recurringHolidays || [];
  const isRecurring = recurringHolidays.some(h => {
    const match = h.dayOfWeek === dayOfWeek;
    console.log(`    → Holiday "${h.name}" (dayOfWeek=${h.dayOfWeek}): ${match ? 'MATCH' : 'no match'}`);
    return match;
  });
  
  return isRecurring;
}

console.log('\n📅 Test: Week starting Monday Oct 27, 2025');
console.log('-'.repeat(70));

const dates = [
  '2025-10-27T00:00:00.000Z', // Monday
  '2025-10-28T00:00:00.000Z', // Tuesday
  '2025-10-29T00:00:00.000Z', // Wednesday
  '2025-10-30T00:00:00.000Z', // Thursday
  '2025-10-31T00:00:00.000Z', // Friday
  '2025-11-01T00:00:00.000Z', // Saturday
  '2025-11-02T00:00:00.000Z'  // Sunday
];

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

console.log('\n❌ Using LOCAL time (getDate, setDate):');
dates.forEach(dateStr => {
  const date = new Date(dateStr);
  const localDay = date.getDay();
  const utcDay = date.getUTCDay();
  
  console.log(`\n${dateStr.split('T')[0]} (${dayNames[utcDay]}):`);
  console.log(`  Local getDay(): ${localDay} (${dayNames[localDay]})`);
  console.log(`  UTC getUTCDay(): ${utcDay} (${dayNames[utcDay]})`);
  
  const isHoliday = isHolidayFromSnapshot(date, holidaySnapshot);
  console.log(`  → Result: ${isHoliday ? '❌ SKIP (Holiday)' : '✅ Create slots'}`);
});

console.log('\n\n' + '='.repeat(70));
console.log('\n✅ Using UTC time (setUTCHours, getUTCDate):');
dates.forEach(dateStr => {
  const date = new Date(dateStr);
  date.setUTCHours(0, 0, 0, 0); // Normalize
  
  const utcDay = date.getUTCDay();
  
  console.log(`\n${dateStr.split('T')[0]} (${dayNames[utcDay]}):`);
  console.log(`  UTC getUTCDay(): ${utcDay} (${dayNames[utcDay]})`);
  
  const isHoliday = isHolidayFromSnapshot(date, holidaySnapshot);
  console.log(`  → Result: ${isHoliday ? '❌ SKIP (Holiday)' : '✅ Create slots'}`);
});

console.log('\n\n' + '='.repeat(70));
console.log('\n🔍 ANALYSIS:');
console.log('   When computedDaysOff is EMPTY (month 10: Oct 27-31),');
console.log('   the fallback logic checks recurringHolidays directly.');
console.log('   If using LOCAL time methods, timezone conversion can cause');
console.log('   wrong day detection when checking dates across month boundaries.');
console.log('='.repeat(70));

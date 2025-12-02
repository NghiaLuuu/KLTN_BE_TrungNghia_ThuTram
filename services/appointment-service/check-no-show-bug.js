/**
 * Test script to debug no-show cron logic for appointment AP000001-03122025
 * Using mock data - no MongoDB connection needed
 */

console.log('\n🔍 Testing No-Show Cron Logic');
console.log('='.repeat(80));

// Mock appointment data
const appointment = {
  appointmentCode: 'AP000001-03122025',
  appointmentDate: new Date('2025-12-02T17:00:00.000Z'), // 00:00 ngày 03/12 Vietnam
  startTime: '08:00',
  endTime: '09:00',
  status: 'confirmed',
  patientInfo: { name: 'Nguyễn Thu Trâm' }
};

console.log('\n📋 Appointment Data:');
console.log('  Code:', appointment.appointmentCode);
console.log('  Date (DB):', appointment.appointmentDate.toISOString());
console.log('  Date (Vietnam):', appointment.appointmentDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  Start Time:', appointment.startTime, '(Vietnam)');
console.log('  End Time:', appointment.endTime, '(Vietnam)');
console.log('  Status:', appointment.status);
console.log('  Patient:', appointment.patientInfo.name);

// Simulate current time
const now = new Date();
console.log('\n⏰ Current Time:');
console.log('  UTC:', now.toISOString());
console.log('  Vietnam:', now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  Timestamp:', now.getTime());

// ====================================================================
// ❌ OLD WRONG LOGIC (using setHours)
// ====================================================================
console.log('\n❌ OLD WRONG LOGIC (setHours with local timezone):');
console.log('='.repeat(80));

const [oldStartHours, oldStartMinutes] = appointment.startTime.split(':').map(Number);
const [oldEndHours, oldEndMinutes] = appointment.endTime.split(':').map(Number);

const oldStartTime = new Date(appointment.appointmentDate);
oldStartTime.setHours(oldStartHours, oldStartMinutes, 0, 0);

const oldEndTime = new Date(appointment.appointmentDate);
oldEndTime.setHours(oldEndHours, oldEndMinutes, 0, 0);

const oldMidPoint = new Date((oldStartTime.getTime() + oldEndTime.getTime()) / 2);

console.log('\n📊 Calculated Times (OLD):');
console.log('  Appointment Start:');
console.log('    - UTC:', oldStartTime.toISOString());
console.log('    - Vietnam:', oldStartTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

console.log('  Appointment End:');
console.log('    - UTC:', oldEndTime.toISOString());
console.log('    - Vietnam:', oldEndTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

console.log('  Mid-Point (50% of duration):');
console.log('    - UTC:', oldMidPoint.toISOString());
console.log('    - Vietnam:', oldMidPoint.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

const oldIsPastMidPoint = now > oldMidPoint;
console.log('\n⚠️ Condition Check:');
console.log(`  Current time > Mid-point?`);
console.log(`  Result: ${oldIsPastMidPoint ? '✅ YES - WOULD MARK AS NO-SHOW (WRONG!)' : '❌ NO - KEEP AS CONFIRMED'}`);

const oldDiffMs = now.getTime() - oldMidPoint.getTime();
const oldDiffHours = Math.floor(Math.abs(oldDiffMs) / (1000 * 60 * 60));
const oldDiffMinutes = Math.floor((Math.abs(oldDiffMs) % (1000 * 60 * 60)) / (1000 * 60));
console.log(`  Time difference: ${oldDiffHours}h ${oldDiffMinutes}m ${oldDiffMs > 0 ? 'past' : 'before'} mid-point`);

// ====================================================================
// ✅ NEW CORRECT LOGIC (setUTCHours + offset)
// ====================================================================
console.log('\n✅ NEW CORRECT LOGIC (setUTCHours with offset):');
console.log('='.repeat(80));

const [startHours, startMinutes] = appointment.startTime.split(':').map(Number);
const [endHours, endMinutes] = appointment.endTime.split(':').map(Number);

// appointmentDate is stored as UTC (e.g., 2025-12-02T17:00:00Z = midnight Vietnam Dec 3)
// startTime/endTime are Vietnam times (e.g., "08:00", "09:00" Vietnam)
// To get correct UTC time: add the hours to the base appointmentDate UTC hours
const correctStartTime = new Date(appointment.appointmentDate);
correctStartTime.setUTCHours(correctStartTime.getUTCHours() + startHours, startMinutes, 0, 0);

const correctEndTime = new Date(appointment.appointmentDate);
correctEndTime.setUTCHours(correctEndTime.getUTCHours() + endHours, endMinutes, 0, 0);

const correctMidPoint = new Date((correctStartTime.getTime() + correctEndTime.getTime()) / 2);

console.log('\n📊 Calculated Times (NEW):');
console.log('  Base appointmentDate.getUTCHours():', appointment.appointmentDate.getUTCHours());
console.log('  Start Time (17 + 8 = 25 → next day 01:00):');
console.log('    - UTC:', correctStartTime.toISOString());
console.log('    - Vietnam:', correctStartTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

console.log('  End Time (17 + 9 = 26 → next day 02:00):');
console.log('    - UTC:', correctEndTime.toISOString());
console.log('    - Vietnam:', correctEndTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

console.log('  Mid-Point (50% = 08:30 Vietnam):');
console.log('    - UTC:', correctMidPoint.toISOString());
console.log('    - Vietnam:', correctMidPoint.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

const correctIsPastMidPoint = now > correctMidPoint;
console.log('\n✅ Correct Condition Check:');
console.log(`  Current time > Correct Mid-point?`);
console.log(`  Result: ${correctIsPastMidPoint ? '✅ YES - MARK AS NO-SHOW' : '❌ NO - KEEP AS CONFIRMED'}`);

const correctDiffMs = now.getTime() - correctMidPoint.getTime();
const correctDiffHours = Math.floor(Math.abs(correctDiffMs) / (1000 * 60 * 60));
const correctDiffMinutes = Math.floor((Math.abs(correctDiffMs) % (1000 * 60 * 60)) / (1000 * 60));
console.log(`  Time difference: ${correctDiffHours}h ${correctDiffMinutes}m ${correctDiffMs > 0 ? 'past' : 'before'} mid-point`);

// ====================================================================
// 🎯 SUMMARY
// ====================================================================
console.log('\n🎯 SUMMARY:');
console.log('='.repeat(80));
console.log('BUG: setHours() uses local server timezone, not Vietnam timezone');
console.log('FIX: setUTCHours(getUTCHours() + hours) correctly adds Vietnam hours to UTC base');
console.log('');
console.log('Example:');
console.log('  appointmentDate: 2025-12-02T17:00:00.000Z (midnight Dec 3 Vietnam)');
console.log('  startTime: "08:00" Vietnam');
console.log('  17:00 UTC + 8 hours = 01:00 UTC next day = 08:00 Vietnam ✅');
console.log('\n' + '='.repeat(80));
console.log('✅ Test completed\n');

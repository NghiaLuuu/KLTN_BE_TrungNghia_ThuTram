/**
 * Test timezone logic for no-show cron (no MongoDB needed)
 */

console.log('🔍 Testing No-Show Timezone Logic');
console.log('='.repeat(80));

// Mock appointment data
const appointment = {
  appointmentCode: 'AP000001-03122025',
  appointmentDate: new Date('2025-12-02T17:00:00.000Z'), // 00:00 Dec 3 Vietnam
  startTime: '08:00',
  endTime: '09:00',
  status: 'confirmed',
  patientInfo: { name: 'Nguyễn Thu Trâm' }
};

console.log('\n📋 Appointment Data:');
console.log('  Code:', appointment.appointmentCode);
console.log('  Date (DB):', appointment.appointmentDate.toISOString());
console.log('  Date (Vietnam):', appointment.appointmentDate.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  Start Time:', appointment.startTime);
console.log('  End Time:', appointment.endTime);

// Current time
const now = new Date();
console.log('\n⏰ Current Time:');
console.log('  UTC:', now.toISOString());
console.log('  Vietnam:', now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

// ❌ OLD WRONG LOGIC (using setHours with local timezone)
console.log('\n❌ OLD WRONG LOGIC (setHours):');
console.log('-'.repeat(80));
const [startHours1, startMinutes1] = appointment.startTime.split(':').map(Number);
const [endHours1, endMinutes1] = appointment.endTime.split(':').map(Number);

const wrongStartTime = new Date(appointment.appointmentDate);
wrongStartTime.setHours(startHours1, startMinutes1, 0, 0);

const wrongEndTime = new Date(appointment.appointmentDate);
wrongEndTime.setHours(endHours1, endMinutes1, 0, 0);

const wrongMidPoint = new Date((wrongStartTime.getTime() + wrongEndTime.getTime()) / 2);

console.log('  Start Time:');
console.log('    UTC:', wrongStartTime.toISOString());
console.log('    Vietnam:', wrongStartTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  Mid-Point:');
console.log('    UTC:', wrongMidPoint.toISOString());
console.log('    Vietnam:', wrongMidPoint.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

const wrongCheck = now > wrongMidPoint;
console.log(`  Current > MidPoint? ${wrongCheck ? '✅ YES (WRONG - would mark no-show!)' : '❌ NO'}`);

// ✅ NEW CORRECT LOGIC (adding hours to UTC)
console.log('\n✅ NEW CORRECT LOGIC (setUTCHours with offset):');
console.log('-'.repeat(80));
const [startHours2, startMinutes2] = appointment.startTime.split(':').map(Number);
const [endHours2, endMinutes2] = appointment.endTime.split(':').map(Number);

const correctStartTime = new Date(appointment.appointmentDate);
correctStartTime.setUTCHours(correctStartTime.getUTCHours() + startHours2, startMinutes2, 0, 0);

const correctEndTime = new Date(appointment.appointmentDate);
correctEndTime.setUTCHours(correctEndTime.getUTCHours() + endHours2, endMinutes2, 0, 0);

const correctMidPoint = new Date((correctStartTime.getTime() + correctEndTime.getTime()) / 2);

console.log('  appointmentDate.getUTCHours():', appointment.appointmentDate.getUTCHours());
console.log('  Start Time (17 + 8 = 25 → next day 01:00):');
console.log('    UTC:', correctStartTime.toISOString());
console.log('    Vietnam:', correctStartTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  End Time (17 + 9 = 26 → next day 02:00):');
console.log('    UTC:', correctEndTime.toISOString());
console.log('    Vietnam:', correctEndTime.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('  Mid-Point (08:30 Vietnam):');
console.log('    UTC:', correctMidPoint.toISOString());
console.log('    Vietnam:', correctMidPoint.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));

const correctCheck = now > correctMidPoint;
console.log(`  Current > MidPoint? ${correctCheck ? '✅ YES (mark no-show)' : '❌ NO (keep confirmed)'}`);

// Time difference
const diffMs = now.getTime() - correctMidPoint.getTime();
const diffHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
const diffMinutes = Math.floor((Math.abs(diffMs) % (1000 * 60 * 60)) / (1000 * 60));
console.log(`  Time difference: ${diffHours}h ${diffMinutes}m ${diffMs > 0 ? 'past' : 'before'} mid-point`);

console.log('\n' + '='.repeat(80));
console.log('✅ Test completed');

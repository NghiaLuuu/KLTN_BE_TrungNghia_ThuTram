/**
 * Test with REAL current time
 */

const { getStartOfDayVN, getEndOfDayVN } = require('./src/utils/timezone.helper');

console.log('='.repeat(80));
console.log('REAL-TIME TEST - Current System Time');
console.log('='.repeat(80));

const now = new Date();
console.log('\nCurrent time (UTC):     ', now.toISOString());
console.log('Current time (VN local):', now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

const startOfDay = getStartOfDayVN();
const endOfDay = getEndOfDayVN();

console.log('\n' + '='.repeat(80));
console.log('Query Range for TODAY (VN timezone)');
console.log('='.repeat(80));
console.log('Start of day (UTC):     ', startOfDay.toISOString());
console.log('End of day (UTC):       ', endOfDay.toISOString());

// Format to VN time for verification
console.log('\nVerification (convert back to VN):');
console.log('Start represents:       ', new Date(startOfDay).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('End represents:         ', new Date(endOfDay).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

// Test with your actual appointment
const testApt = new Date('2025-12-07T17:00:00.000Z');
console.log('\n' + '='.repeat(80));
console.log('Test Appointment from API Response');
console.log('='.repeat(80));
console.log('Appointment UTC:        ', testApt.toISOString());
console.log('Appointment VN:         ', testApt.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log('In today query range?   ', testApt >= startOfDay && testApt <= endOfDay ? '✅ YES (WRONG!)' : '❌ NO (CORRECT!)');
console.log('\nExpected: NO - because 2025-12-07T17:00:00.000Z = 2025-12-08 00:00 VN (tomorrow)');
console.log('='.repeat(80));

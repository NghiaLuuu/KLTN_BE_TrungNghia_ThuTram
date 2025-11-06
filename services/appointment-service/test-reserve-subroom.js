/**
 * Test Script: Online Appointment Booking with Subroom
 * Purpose: Debug why subroomId and subroomName are null after payment
 * 
 * This script simulates the online booking flow:
 * 1. Reserve appointment with slots that have subroom
 * 2. Check if subroom data is correctly stored in Redis
 * 3. Complete payment
 * 4. Verify appointment has subroom data
 */

const axios = require('axios');

// Configuration
const API_BASE_URL = process.env.API_GATEWAY_URL || 'http://localhost:3000';
const APPOINTMENT_SERVICE_URL = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3007';
const SCHEDULE_SERVICE_URL = process.env.SCHEDULE_SERVICE_URL || 'http://localhost:3005';

// Test data - Update these with real IDs from your database
const TEST_DATA = {
  // Update with real patient credentials
  patientEmail: 'patient@test.com',
  patientPassword: 'password123',
  
  // Update with real slot IDs that have subroom
  // Get these from MongoDB: db.slots.find({ subRoomId: { $ne: null } }).limit(2)
  slotIds: ['SLOT_ID_1', 'SLOT_ID_2'], // Replace with actual slot IDs
  
  // Update with real service and dentist IDs
  serviceId: 'SERVICE_ID', // Replace with actual service ID
  serviceAddOnId: null, // Optional
  dentistId: 'DENTIST_ID', // Replace with actual dentist ID
  
  appointmentDate: new Date().toISOString().split('T')[0], // Today
  notes: 'Test subroom booking'
};

let authToken = null;
let reservationData = null;
let appointmentCode = null;

async function login() {
  console.log('\n🔐 Step 1: Login as patient...');
  try {
    const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
      email: TEST_DATA.patientEmail,
      password: TEST_DATA.patientPassword
    });
    
    authToken = response.data.data.token;
    console.log('✅ Login successful');
    console.log('Token:', authToken.substring(0, 20) + '...');
    return true;
  } catch (error) {
    console.error('❌ Login failed:', error.response?.data || error.message);
    return false;
  }
}

async function checkSlots() {
  console.log('\n📅 Step 2: Check slot details...');
  try {
    for (const slotId of TEST_DATA.slotIds) {
      const response = await axios.get(
        `${SCHEDULE_SERVICE_URL}/api/slot/${slotId}`
      );
      
      const slot = response.data.slot || response.data.data || response.data;
      console.log(`\nSlot ${slotId}:`);
      console.log('  - roomId:', slot.roomId);
      console.log('  - subRoomId:', slot.subRoomId || 'null ⚠️');
      console.log('  - status:', slot.status);
      console.log('  - startTime:', slot.startTime);
      
      if (!slot.subRoomId) {
        console.warn('⚠️ WARNING: This slot has no subroom! Test may not be accurate.');
      }
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to check slots:', error.response?.data || error.message);
    return false;
  }
}

async function reserveAppointment() {
  console.log('\n🎫 Step 3: Reserve appointment...');
  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/appointment/reserve`,
      {
        slotIds: TEST_DATA.slotIds,
        serviceId: TEST_DATA.serviceId,
        serviceAddOnId: TEST_DATA.serviceAddOnId,
        dentistId: TEST_DATA.dentistId,
        date: TEST_DATA.appointmentDate,
        notes: TEST_DATA.notes
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    );
    
    reservationData = response.data.data;
    console.log('✅ Reservation created successfully');
    console.log('\nReservation Details:');
    console.log('  - reservationId:', reservationData.reservationId);
    console.log('  - roomId:', reservationData.roomId);
    console.log('  - roomName:', reservationData.roomName);
    console.log('  - subroomId:', reservationData.subroomId || 'null ⚠️');
    console.log('  - subroomName:', reservationData.subroomName || 'null ⚠️');
    console.log('  - paymentUrl:', reservationData.paymentUrl);
    console.log('  - expiresAt:', reservationData.expiresAt);
    
    if (!reservationData.subroomId) {
      console.error('\n❌ BUG CONFIRMED: subroomId is null in reservation!');
      console.log('👉 Check appointment-service logs for debug output');
    } else {
      console.log('\n✅ subroomId is present in reservation');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Reservation failed:', error.response?.data || error.message);
    return false;
  }
}

async function simulatePaymentSuccess() {
  console.log('\n💰 Step 4: Simulate payment success (manual trigger)...');
  console.log('\nTo complete this test, you need to:');
  console.log('1. Go to payment URL:', reservationData.paymentUrl);
  console.log('2. Complete payment (or trigger payment webhook manually)');
  console.log('3. Check appointment in database');
  console.log('\nOR use this Redis command to check reservation data:');
  console.log(`   redis-cli GET "temp_reservation:${reservationData.reservationId}"`);
  
  console.log('\n🔍 Waiting 5 seconds for you to check logs...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  return true;
}

async function checkAppointment() {
  console.log('\n📋 Step 5: Check if appointment was created with subroom data...');
  console.log('(This requires payment to be completed first)');
  
  // This will only work if payment was actually completed
  // For now, just show what to check
  console.log('\n📊 Manual verification steps:');
  console.log('1. Complete the payment process');
  console.log('2. Check MongoDB appointment collection:');
  console.log('   db.appointments.findOne({ patientId: ObjectId("YOUR_PATIENT_ID") }).sort({ createdAt: -1 })');
  console.log('3. Verify fields:');
  console.log('   - subroomId should NOT be null');
  console.log('   - subroomName should NOT be null');
  
  return true;
}

async function runTest() {
  console.log('========================================');
  console.log('🧪 SUBROOM BOOKING TEST');
  console.log('========================================');
  console.log('\n⚠️ IMPORTANT: Update TEST_DATA with real IDs before running!');
  console.log('This test will help identify where subroom data is lost.\n');
  
  // Validate test data
  if (TEST_DATA.slotIds[0] === 'SLOT_ID_1') {
    console.error('❌ ERROR: Please update TEST_DATA with real slot IDs!');
    console.log('Run this MongoDB query to find slots with subrooms:');
    console.log('  db.slots.find({ subRoomId: { $ne: null }, status: "available" }).limit(2)');
    process.exit(1);
  }
  
  let success = true;
  
  // Step 1: Login
  success = await login();
  if (!success) {
    console.error('\n❌ Test aborted: Login failed');
    process.exit(1);
  }
  
  // Step 2: Check slots
  success = await checkSlots();
  if (!success) {
    console.error('\n❌ Test aborted: Slot check failed');
    process.exit(1);
  }
  
  // Step 3: Reserve appointment
  success = await reserveAppointment();
  if (!success) {
    console.error('\n❌ Test aborted: Reservation failed');
    process.exit(1);
  }
  
  // Step 4: Simulate payment (manual)
  await simulatePaymentSuccess();
  
  // Step 5: Check appointment (manual)
  await checkAppointment();
  
  console.log('\n========================================');
  console.log('🎯 TEST COMPLETED');
  console.log('========================================');
  console.log('\n📝 Summary:');
  console.log('- Reservation created:', !!reservationData);
  console.log('- Subroom in reservation:', !!reservationData?.subroomId);
  console.log('\n👉 Check appointment-service logs for detailed debug output');
  console.log('Look for lines with: 🔍 [reserveAppointment]');
  console.log('\nIf subroomId is null in reservation, the bug is in reserveAppointment()');
  console.log('If subroomId is present in reservation but null in final appointment,');
  console.log('the bug is in createAppointmentFromPayment()');
}

// Run the test
runTest().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});

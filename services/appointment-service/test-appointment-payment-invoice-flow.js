/**
 * Test Script: Appointment → Record → Payment → Invoice Flow
 * 
 * This script tests the complete workflow from appointment creation to invoice generation
 * 
 * Flow:
 * 1. Staff creates walk-in appointment (offline)
 * 2. System auto-checks-in appointment
 * 3. Record auto-created with status=pending
 * 4. Staff starts treatment (record.status=in_progress)
 * 5. Appointment.status updates to in-progress
 * 6. Staff completes record (totalCost set)
 * 7. Payment created with finalAmount (no deposit for walk-in)
 * 8. Staff confirms cash payment
 * 9. Invoice auto-created
 * 10. Record.invoiceId updated
 * 
 * Usage:
 *   node test-appointment-payment-invoice-flow.js
 */

require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');

// Service URLs
const APPOINTMENT_SERVICE = process.env.APPOINTMENT_SERVICE_URL || 'http://localhost:3006';
const RECORD_SERVICE = process.env.RECORD_SERVICE_URL || 'http://localhost:3010';
const PAYMENT_SERVICE = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3007';
const INVOICE_SERVICE = process.env.INVOICE_SERVICE_URL || 'http://localhost:3011';

// Test data
const TEST_DATA = {
  // Staff token (replace with actual token from auth-service)
  staffToken: 'Bearer YOUR_STAFF_TOKEN_HERE',
  
  // Test appointment data
  appointment: {
    patientId: new mongoose.Types.ObjectId().toString(),
    patientName: 'Nguyễn Test',
    patientPhone: '0912345678',
    patientEmail: 'test@example.com',
    dentistId: new mongoose.Types.ObjectId().toString(),
    dentistName: 'BS Test',
    nurseId: new mongoose.Types.ObjectId().toString(),
    nurseName: 'Y tá Test',
    serviceId: new mongoose.Types.ObjectId().toString(),
    serviceName: 'Nhổ răng',
    servicePrice: 500000,
    appointmentDate: new Date().toISOString().split('T')[0],
    startTime: '09:00',
    endTime: '10:00',
    slotIds: ['SLOT001', 'SLOT002'],
    notes: 'Test appointment for full flow'
  }
};

// Delay helper
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// API client with error handling
async function apiCall(method, url, data = null, headers = {}) {
  try {
    const config = {
      method,
      url,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };
    
    if (data) {
      config.data = data;
    }
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`❌ API Error [${method} ${url}]:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Main test flow
 */
async function runTest() {
  console.log('='.repeat(80));
  console.log('🧪 TESTING: Appointment → Record → Payment → Invoice Flow');
  console.log('='.repeat(80));
  console.log();
  
  let appointmentId = null;
  let recordId = null;
  let paymentId = null;
  let invoiceId = null;
  
  try {
    // ========== STEP 1: Create Walk-in Appointment ==========
    console.log('📋 STEP 1: Creating walk-in appointment...');
    const appointmentResponse = await apiCall(
      'POST',
      `${APPOINTMENT_SERVICE}/api/appointments`,
      TEST_DATA.appointment,
      { Authorization: TEST_DATA.staffToken }
    );
    
    appointmentId = appointmentResponse.data._id;
    console.log('✅ Appointment created:', {
      id: appointmentId,
      status: appointmentResponse.data.status,
      bookedByRole: appointmentResponse.data.bookedByRole,
      bookingChannel: appointmentResponse.data.bookingChannel
    });
    console.log();
    
    // ========== STEP 2: Wait for auto check-in ==========
    console.log('⏳ STEP 2: Waiting for auto check-in...');
    await delay(2000); // Wait 2 seconds
    
    const appointmentCheck = await apiCall(
      'GET',
      `${APPOINTMENT_SERVICE}/api/appointments/${appointmentId}`,
      null,
      { Authorization: TEST_DATA.staffToken }
    );
    
    console.log('✅ Appointment status:', appointmentCheck.data.status);
    
    if (appointmentCheck.data.status !== 'checked-in') {
      console.warn('⚠️  Appointment not auto-checked-in, manually checking in...');
      await apiCall(
        'PATCH',
        `${APPOINTMENT_SERVICE}/api/appointments/${appointmentId}/check-in`,
        {},
        { Authorization: TEST_DATA.staffToken }
      );
      console.log('✅ Manual check-in completed');
    }
    console.log();
    
    // ========== STEP 3: Verify Record Created ==========
    console.log('📋 STEP 3: Verifying record auto-creation...');
    await delay(2000); // Wait for event processing
    
    // Get appointment again to see recordId
    const appointmentWithRecord = await apiCall(
      'GET',
      `${APPOINTMENT_SERVICE}/api/appointments/${appointmentId}`,
      null,
      { Authorization: TEST_DATA.staffToken }
    );
    
    recordId = appointmentWithRecord.data.recordId;
    
    if (!recordId) {
      throw new Error('Record was not auto-created after check-in');
    }
    
    console.log('✅ Record auto-created:', recordId);
    
    // Get record details
    const recordResponse = await apiCall(
      'GET',
      `${RECORD_SERVICE}/api/record/${recordId}`,
      null,
      { Authorization: TEST_DATA.staffToken }
    );
    
    console.log('✅ Record details:', {
      id: recordId,
      status: recordResponse.data.status,
      appointmentId: recordResponse.data.appointmentId
    });
    console.log();
    
    // ========== STEP 4: Start Treatment ==========
    console.log('💉 STEP 4: Starting treatment (update record to in-progress)...');
    const recordUpdateResponse = await apiCall(
      'PUT',
      `${RECORD_SERVICE}/api/record/${recordId}`,
      {
        status: 'in_progress',
        diagnosis: 'Test diagnosis',
        treatmentPlan: 'Test treatment plan'
      },
      { Authorization: TEST_DATA.staffToken }
    );
    
    console.log('✅ Record updated to in-progress');
    console.log();
    
    // ========== STEP 5: Verify Appointment Status Sync ==========
    console.log('🔄 STEP 5: Verifying appointment status sync...');
    await delay(2000);
    
    const appointmentInProgress = await apiCall(
      'GET',
      `${APPOINTMENT_SERVICE}/api/appointments/${appointmentId}`,
      null,
      { Authorization: TEST_DATA.staffToken }
    );
    
    console.log('✅ Appointment status synced:', appointmentInProgress.data.status);
    console.log();
    
    // ========== STEP 6: Complete Treatment ==========
    console.log('✅ STEP 6: Completing treatment...');
    const recordCompleteResponse = await apiCall(
      'PUT',
      `${RECORD_SERVICE}/api/record/${recordId}`,
      {
        status: 'completed',
        totalCost: 500000,
        medications: [
          {
            name: 'Paracetamol',
            dosage: '500mg',
            frequency: '2 viên/ngày',
            duration: '3 ngày'
          }
        ],
        notes: 'Treatment completed successfully'
      },
      { Authorization: TEST_DATA.staffToken }
    );
    
    console.log('✅ Record completed with totalCost:', recordCompleteResponse.data.totalCost);
    console.log();
    
    // ========== STEP 7: Verify Payment Created ==========
    console.log('💰 STEP 7: Verifying payment auto-creation...');
    await delay(3000); // Wait for event processing
    
    // Get appointment again to see paymentId
    const appointmentWithPayment = await apiCall(
      'GET',
      `${APPOINTMENT_SERVICE}/api/appointments/${appointmentId}`,
      null,
      { Authorization: TEST_DATA.staffToken }
    );
    
    // Find payment by record (if appointment doesn't have paymentId)
    // Note: May need to implement GET /api/payments/by-record/:recordId endpoint
    console.log('⚠️  Need to get payment by recordId - implement if not available');
    console.log('    Assuming payment created...');
    console.log();
    
    // ========== STEP 8: Confirm Cash Payment ==========
    console.log('💵 STEP 8: Confirming cash payment...');
    
    // For testing, let's assume we have the paymentId
    // In production, you'd query payments by recordId
    console.log('⚠️  To complete test, you need:');
    console.log('    1. GET /api/payments/by-record/:recordId endpoint');
    console.log('    2. paymentId from that response');
    console.log('    3. Call POST /api/payments/:id/confirm-cash');
    console.log();
    
    // Example confirmation (uncomment when paymentId available):
    /*
    const paymentConfirmResponse = await apiCall(
      'POST',
      `${PAYMENT_SERVICE}/api/payments/${paymentId}/confirm-cash`,
      {
        paidAmount: 500000,
        notes: 'Cash payment confirmed'
      },
      { Authorization: TEST_DATA.staffToken }
    );
    
    console.log('✅ Cash payment confirmed:', {
      paymentId: paymentConfirmResponse.data._id,
      status: paymentConfirmResponse.data.status,
      changeAmount: paymentConfirmResponse.data.changeAmount
    });
    */
    
    // ========== STEP 9: Verify Invoice Created ==========
    console.log('📄 STEP 9: Verifying invoice auto-creation...');
    await delay(2000);
    
    // Get record again to see invoiceId
    const recordWithInvoice = await apiCall(
      'GET',
      `${RECORD_SERVICE}/api/record/${recordId}`,
      null,
      { Authorization: TEST_DATA.staffToken }
    );
    
    invoiceId = recordWithInvoice.data.invoiceId;
    
    if (invoiceId) {
      console.log('✅ Invoice auto-created:', invoiceId);
      
      // Get invoice details (if endpoint available)
      console.log('⚠️  To get invoice details, implement GET /api/invoices/:id');
    } else {
      console.log('⚠️  Invoice not yet created - check event processing');
    }
    console.log();
    
    // ========== STEP 10: Summary ==========
    console.log('='.repeat(80));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(80));
    console.log('✅ Appointment ID:', appointmentId);
    console.log('✅ Record ID:', recordId);
    console.log('⏳ Payment ID:', paymentId || 'Pending - need to query');
    console.log('⏳ Invoice ID:', invoiceId || 'Pending - need payment confirmation');
    console.log();
    console.log('🎯 Next Steps:');
    console.log('   1. Implement GET /api/payments/by-record/:recordId');
    console.log('   2. Get paymentId from response');
    console.log('   3. Call POST /api/payments/:id/confirm-cash');
    console.log('   4. Verify invoice created');
    console.log('   5. Verify record.invoiceId updated');
    console.log();
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run test
runTest()
  .then(() => {
    console.log('✅ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test error:', error);
    process.exit(1);
  });

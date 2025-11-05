/**
 * Test RPC getRecordById từ payment-service
 * Run: node test-rpc-get-record.js <recordId>
 */

require('dotenv').config();
const rpcClient = require('./src/utils/rpcClient');

async function testGetRecordById() {
  try {
    const recordId = process.argv[2];
    
    if (!recordId) {
      console.error('❌ Usage: node test-rpc-get-record.js <recordId>');
      process.exit(1);
    }

    console.log('🔍 Testing RPC getRecordById...');
    console.log('📋 Record ID:', recordId);
    console.log('');

    // Call RPC
    const response = await rpcClient.request('record_rpc_queue', {
      action: 'getRecordById',
      payload: { id: recordId }
    });

    console.log('✅ RPC Response:', JSON.stringify(response, null, 2));

    if (response.error) {
      console.error('❌ Error:', response.error);
      process.exit(1);
    }

    if (response.record) {
      console.log('');
      console.log('✅ Record Found:');
      console.log('- Record Code:', response.record.recordCode);
      console.log('- Patient:', response.record.patientInfo?.name);
      console.log('- Service:', response.record.serviceName);
      console.log('- Total Cost:', response.record.totalCost);
      console.log('- Booking Channel:', response.record.bookingChannel);
      console.log('- Status:', response.record.status);
      console.log('- Appointment ID:', response.record.appointmentId);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testGetRecordById();

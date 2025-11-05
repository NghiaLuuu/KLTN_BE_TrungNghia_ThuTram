/**
 * TEST RPC GET RECORD BY ID
 * 
 * File này test RPC communication giữa payment-service và record-service
 * 
 * Usage:
 *   node test-rpc-get-record-detailed.js <recordId>
 * 
 * Example:
 *   node test-rpc-get-record-detailed.js 67123abc456def789012
 */

require('dotenv').config();
const amqp = require('amqplib');
const { randomUUID } = require('crypto');

async function testRpcGetRecord(recordId) {
  console.log('🔍 Testing RPC Get Record by ID');
  console.log('='.repeat(60));
  console.log('📋 Record ID:', recordId);
  console.log('🌐 RabbitMQ URL:', process.env.RABBITMQ_URL);
  console.log('='.repeat(60));

  try {
    // 1. Connect to RabbitMQ
    console.log('\n1️⃣ Connecting to RabbitMQ...');
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    console.log('   ✅ Connected');

    // 2. Create channel
    console.log('\n2️⃣ Creating channel...');
    const channel = await connection.createChannel();
    console.log('   ✅ Channel created');

    // 3. Assert reply queue
    console.log('\n3️⃣ Creating reply queue...');
    const replyQueue = await channel.assertQueue('', { exclusive: true });
    console.log('   ✅ Reply queue:', replyQueue.queue);

    // 4. Generate correlation ID
    const correlationId = randomUUID();
    console.log('\n4️⃣ Correlation ID:', correlationId);

    // 5. Setup consumer for reply
    console.log('\n5️⃣ Setting up reply consumer...');
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('RPC timeout after 10 seconds'));
      }, 10000);

      channel.consume(
        replyQueue.queue,
        (msg) => {
          if (msg.properties.correlationId === correlationId) {
            clearTimeout(timeout);
            const response = JSON.parse(msg.content.toString());
            resolve(response);
          }
        },
        { noAck: true }
      );
    });
    console.log('   ✅ Consumer ready');

    // 6. Send RPC request
    console.log('\n6️⃣ Sending RPC request...');
    const request = {
      action: 'getRecordById',
      payload: { id: recordId }
    };
    console.log('   📤 Request:', JSON.stringify(request, null, 2));

    channel.sendToQueue(
      'record_rpc_queue',
      Buffer.from(JSON.stringify(request)),
      {
        correlationId,
        replyTo: replyQueue.queue,
      }
    );
    console.log('   ✅ Request sent to record_rpc_queue');

    // 7. Wait for response
    console.log('\n7️⃣ Waiting for response...');
    const response = await promise;
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ RPC RESPONSE RECEIVED');
    console.log('='.repeat(60));

    if (response.error) {
      console.error('❌ ERROR:', response.error);
    } else if (response.record) {
      const record = response.record;
      console.log('\n📄 RECORD DETAILS:');
      console.log('   Record Code:', record.recordCode);
      console.log('   Status:', record.status);
      console.log('   Type:', record.type);
      console.log('   Booking Channel:', record.bookingChannel);
      console.log('   Total Cost:', record.totalCost);
      console.log('   Patient:', record.patientInfo?.name);
      console.log('   Phone:', record.patientInfo?.phone);
      console.log('   Dentist:', record.dentistName);
      console.log('   Service:', record.serviceName);
      console.log('   Service Price:', record.servicePrice);
      console.log('   Add-on:', record.serviceAddOnName || 'N/A');
      console.log('   Add-on Price:', record.serviceAddOnPrice || 0);
      console.log('   Appointment ID:', record.appointmentId || 'N/A');
      console.log('   Created:', record.createdAt);
      console.log('   Completed:', record.completedAt || 'Not completed');
      
      console.log('\n📦 ADDITIONAL SERVICES:');
      if (record.additionalServices && record.additionalServices.length > 0) {
        record.additionalServices.forEach((service, index) => {
          console.log(`   ${index + 1}. ${service.serviceName}`);
          console.log(`      Price: ${service.price} x ${service.quantity} = ${service.totalPrice}`);
        });
      } else {
        console.log('   (none)');
      }

      console.log('\n💊 PRESCRIPTION:');
      if (record.prescription?.medicines && record.prescription.medicines.length > 0) {
        record.prescription.medicines.forEach((med, index) => {
          console.log(`   ${index + 1}. ${med.medicineName} - ${med.dosage}`);
          console.log(`      Quantity: ${med.quantity}`);
        });
      } else {
        console.log('   (none)');
      }

      console.log('\n✅ TEST PASSED - Record retrieved successfully!');
    } else {
      console.log('⚠️  Unexpected response format:', response);
    }

    // 8. Cleanup
    setTimeout(() => {
      connection.close();
      console.log('\n🔌 Connection closed');
      process.exit(0);
    }, 500);

  } catch (error) {
    console.error('\n❌ TEST FAILED');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Check command line arguments
const recordId = process.argv[2];

if (!recordId) {
  console.error('❌ Usage: node test-rpc-get-record-detailed.js <recordId>');
  console.error('Example: node test-rpc-get-record-detailed.js 67123abc456def789012');
  process.exit(1);
}

// Run test
testRpcGetRecord(recordId);

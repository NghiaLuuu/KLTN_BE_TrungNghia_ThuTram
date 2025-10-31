/**
 * Test Queue Logic - Verify no time filtering
 * 
 * Run: node test-queue-logic.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dental_clinic';

async function testQueueLogic() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const Appointment = require('./src/models/appointment.model');

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    console.log('\n📅 Testing Queue Logic for Today:');
    console.log(`Date Range: ${startOfDay.toLocaleString()} - ${endOfDay.toLocaleString()}`);
    console.log(`Current Time: ${new Date().toLocaleString()}\n`);

    // Query without endTime filter
    const query = {
      status: { $in: ['in-progress', 'checked-in', 'confirmed'] },
      appointmentDate: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    };

    console.log('🔍 Query:', JSON.stringify(query, null, 2));

    const appointments = await Appointment.find(query)
      .sort({ roomId: 1, subroomId: 1, startTime: 1 })
      .lean();

    console.log(`\n📊 Found ${appointments.length} appointments\n`);

    if (appointments.length === 0) {
      console.log('⚠️ No appointments found today with status in-progress, checked-in, or confirmed');
      console.log('\n💡 Suggestions:');
      console.log('1. Check if there are any appointments today');
      console.log('2. Verify appointment status (should be: confirmed, checked-in, or in-progress)');
      console.log('3. Check appointmentDate field format');
    } else {
      // Group by status
      const byStatus = {
        'in-progress': [],
        'checked-in': [],
        'confirmed': []
      };

      const currentTime = new Date();
      let pastEndTime = 0;
      let futureStartTime = 0;

      appointments.forEach(apt => {
        byStatus[apt.status].push(apt);

        // Parse time strings (HH:MM format)
        const [endHour, endMin] = apt.endTime.split(':').map(Number);
        const endDateTime = new Date(apt.appointmentDate);
        endDateTime.setHours(endHour, endMin, 0, 0);

        const [startHour, startMin] = apt.startTime.split(':').map(Number);
        const startDateTime = new Date(apt.appointmentDate);
        startDateTime.setHours(startHour, startMin, 0, 0);

        if (endDateTime < currentTime) {
          pastEndTime++;
        }

        if (startDateTime > currentTime) {
          futureStartTime++;
        }
      });

      console.log('📈 Status Breakdown:');
      console.log(`  - in-progress: ${byStatus['in-progress'].length}`);
      console.log(`  - checked-in: ${byStatus['checked-in'].length}`);
      console.log(`  - confirmed: ${byStatus['confirmed'].length}`);

      console.log('\n⏰ Time Analysis:');
      console.log(`  - Past end time (can still be in-progress): ${pastEndTime}`);
      console.log(`  - Future start time (not started yet): ${futureStartTime}`);

      console.log('\n✅ Sample Appointments:\n');
      
      // Show first 5 appointments
      appointments.slice(0, 5).forEach(apt => {
        const [endHour, endMin] = apt.endTime.split(':').map(Number);
        const endDateTime = new Date(apt.appointmentDate);
        endDateTime.setHours(endHour, endMin, 0, 0);
        
        const isPastEndTime = endDateTime < currentTime;

        console.log(`📋 ${apt.appointmentCode}`);
        console.log(`   Patient: ${apt.patientInfo.name}`);
        console.log(`   Status: ${apt.status}`);
        console.log(`   Time: ${apt.startTime} - ${apt.endTime}`);
        console.log(`   Room: ${apt.roomName}${apt.subroomName ? ` - ${apt.subroomName}` : ''}`);
        console.log(`   End Time: ${endDateTime.toLocaleTimeString()} ${isPastEndTime ? '⚠️ PAST' : '✅ FUTURE'}`);
        console.log('');
      });

      if (pastEndTime > 0) {
        console.log(`\n✅ GOOD: ${pastEndTime} appointments past end time are still included (no time filtering)`);
      }
    }

    await mongoose.connection.close();
    console.log('\n✅ Test completed');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run test
testQueueLogic();

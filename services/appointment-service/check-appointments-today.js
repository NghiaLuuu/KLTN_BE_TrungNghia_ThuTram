/**
 * Check all appointments today
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dental_clinic';

async function checkAllAppointments() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const Appointment = require('./src/models/appointment.model');

    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    console.log(`📅 Checking appointments for: ${today.toLocaleDateString()}`);
    console.log(`Current time: ${new Date().toLocaleString()}\n`);

    // Get ALL appointments today (any status)
    const allAppointments = await Appointment.find({
      appointmentDate: {
        $gte: startOfDay,
        $lte: endOfDay
      }
    }).lean();

    console.log(`📊 Total appointments today: ${allAppointments.length}\n`);

    if (allAppointments.length === 0) {
      console.log('⚠️ No appointments found for today');
      console.log('\n💡 Try checking:');
      console.log('1. Are there appointments in the database?');
      console.log('2. Check the appointmentDate field format');
      console.log('3. Timezone issues?');
    } else {
      // Group by status
      const statusGroups = {};
      allAppointments.forEach(apt => {
        const status = apt.status || 'undefined';
        if (!statusGroups[status]) {
          statusGroups[status] = [];
        }
        statusGroups[status].push(apt);
      });

      console.log('📈 Appointments by Status:\n');
      Object.keys(statusGroups).sort().forEach(status => {
        const count = statusGroups[status].length;
        console.log(`  ${status}: ${count}`);
        
        // Show first 3 of each status
        statusGroups[status].slice(0, 3).forEach(apt => {
          console.log(`    - ${apt.appointmentCode} | ${apt.patientInfo.name} | ${apt.startTime}-${apt.endTime}`);
        });
      });

      // Check time analysis
      console.log('\n⏰ Time Analysis:\n');
      const currentTime = new Date();
      
      const inProgressPast = allAppointments.filter(apt => {
        if (apt.status !== 'in-progress') return false;
        const [endHour, endMin] = apt.endTime.split(':').map(Number);
        const endDateTime = new Date(apt.appointmentDate);
        endDateTime.setHours(endHour, endMin, 0, 0);
        return endDateTime < currentTime;
      });

      console.log(`  in-progress appointments past end time: ${inProgressPast.length}`);
      
      if (inProgressPast.length > 0) {
        console.log('\n  📋 These appointments should appear in queue:');
        inProgressPast.forEach(apt => {
          console.log(`    - ${apt.appointmentCode} | ${apt.patientInfo.name} | ${apt.startTime}-${apt.endTime} | Room: ${apt.roomName}`);
        });
      }

      const checkedIn = statusGroups['checked-in'] || [];
      const confirmed = statusGroups['confirmed'] || [];
      const inProgress = statusGroups['in-progress'] || [];

      console.log(`\n✅ Should appear in queue:`);
      console.log(`  - in-progress: ${inProgress.length}`);
      console.log(`  - checked-in: ${checkedIn.length}`);
      console.log(`  - confirmed: ${confirmed.length}`);
      console.log(`  TOTAL: ${inProgress.length + checkedIn.length + confirmed.length}`);
    }

    await mongoose.connection.close();
    console.log('\n✅ Check completed');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAllAppointments();

/**
 * Tạo dữ liệu mẫu để test timezone fix
 * Script này tạo appointment và invoice mẫu cho ngày 06/12/2025
 */

const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/dental-clinic';

// Sample data configuration
const TEST_DATE = new Date('2025-12-06T10:00:00+07:00'); // 10:00 AM VN time on 06/12/2025
const PATIENT_ID = '507f1f77bcf86cd799439011'; // Dummy patient ID
const DENTIST_ID = '6923b2ccc96fd594d2e3b135'; // Existing dentist ID from your data
const SERVICE_ID = '692332654bad0e8aaaa5f451'; // Existing service ID
const ROOM_ID = '692329037ae1fa280c255df0'; // Existing room ID

async function createSampleAppointment() {
  console.log('📅 Creating sample appointment for 2025-12-06...');
  
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));
  
  const appointment = new Appointment({
    appointmentCode: 'APT-20251206-TEST',
    patientId: PATIENT_ID,
    patientInfo: {
      name: 'Nguyễn Văn Test',
      phone: '0901234567',
      email: 'test@example.com',
      birthYear: 1990
    },
    dentistId: DENTIST_ID,
    serviceId: SERVICE_ID,
    serviceName: 'Khám và tư vấn cơ bản',
    serviceType: 'examination',
    roomId: ROOM_ID,
    appointmentDate: TEST_DATE,
    startTime: new Date('2025-12-06T10:00:00+07:00'),
    endTime: new Date('2025-12-06T10:30:00+07:00'),
    status: 'completed',
    bookedByRole: 'patient', // Online booking
    note: 'Test appointment for timezone fix verification',
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true
  });
  
  await appointment.save();
  console.log('✅ Appointment created:', appointment._id);
  
  return appointment;
}

async function createSampleInvoice(appointmentId) {
  console.log('💰 Creating sample invoice for appointment...');
  
  const Invoice = mongoose.model('Invoice', new mongoose.Schema({}, { strict: false }));
  const InvoiceDetail = mongoose.model('InvoiceDetail', new mongoose.Schema({}, { strict: false }));
  
  // Create invoice
  const invoice = new Invoice({
    invoiceCode: 'INV-20251206-TEST',
    appointmentId: appointmentId,
    patientId: PATIENT_ID,
    patientInfo: {
      name: 'Nguyễn Văn Test',
      phone: '0901234567'
    },
    totalAmount: 200000,
    paidAmount: 200000,
    remainingAmount: 0,
    status: 'completed',
    paymentMethod: 'cash',
    completedDate: new Date('2025-12-06T10:30:00+07:00'), // Completed at 10:30 AM VN time
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true
  });
  
  await invoice.save();
  console.log('✅ Invoice created:', invoice._id);
  
  // Create invoice detail
  const invoiceDetail = new InvoiceDetail({
    invoiceId: invoice._id,
    appointmentId: appointmentId,
    dentistId: DENTIST_ID,
    serviceId: SERVICE_ID,
    serviceName: 'Khám và tư vấn cơ bản',
    serviceType: 'examination',
    unitPrice: 200000,
    quantity: 1,
    totalPrice: 200000,
    status: 'completed',
    completedDate: new Date('2025-12-06T10:30:00+07:00'),
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true
  });
  
  await invoiceDetail.save();
  console.log('✅ Invoice detail created:', invoiceDetail._id);
  
  return { invoice, invoiceDetail };
}

async function createMultipleBookingChannelData() {
  console.log('📊 Creating multiple appointments for booking channel stats...');
  
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));
  
  const appointments = [];
  const dates = [
    '2025-11-07',
    '2025-11-08',
    '2025-11-09',
    '2025-12-06',
    '2025-12-07'
  ];
  
  const roles = ['patient', 'receptionist', 'patient', 'manager', 'patient'];
  const statuses = ['completed', 'completed', 'cancelled', 'completed', 'no-show'];
  
  for (let i = 0; i < dates.length; i++) {
    const apt = new Appointment({
      appointmentCode: `APT-${dates[i]}-${i}`,
      patientId: PATIENT_ID,
      patientInfo: {
        name: `Test Patient ${i}`,
        phone: `090123456${i}`,
        birthYear: 1990
      },
      dentistId: DENTIST_ID,
      serviceId: SERVICE_ID,
      serviceName: 'Khám và tư vấn cơ bản',
      roomId: ROOM_ID,
      appointmentDate: new Date(`${dates[i]}T${10 + i}:00:00+07:00`),
      startTime: new Date(`${dates[i]}T${10 + i}:00:00+07:00`),
      endTime: new Date(`${dates[i]}T${10 + i}:30:00+07:00`),
      status: statuses[i],
      bookedByRole: roles[i],
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true
    });
    
    await apt.save();
    appointments.push(apt);
  }
  
  console.log(`✅ Created ${appointments.length} appointments for booking channel testing`);
  return appointments;
}

async function createScheduleSlots() {
  console.log('🏥 Creating schedule slots for clinic utilization stats...');
  
  const Slot = mongoose.model('Slot', new mongoose.Schema({}, { strict: false }));
  
  const slots = [];
  const dates = ['2025-11-07', '2025-12-06', '2025-12-07'];
  const rooms = [ROOM_ID];
  
  for (const date of dates) {
    for (let hour = 8; hour < 17; hour++) {
      for (const roomId of rooms) {
        const slot = new Slot({
          roomId: roomId,
          startTime: new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00+07:00`),
          endTime: new Date(`${date}T${(hour + 1).toString().padStart(2, '0')}:00:00+07:00`),
          isAvailable: hour % 3 === 0, // Some slots are booked
          appointmentId: hour % 3 === 0 ? null : mongoose.Types.ObjectId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          isActive: true
        });
        
        await slot.save();
        slots.push(slot);
      }
    }
  }
  
  console.log(`✅ Created ${slots.length} slots for clinic utilization testing`);
  return slots;
}

async function cleanupTestData() {
  console.log('🧹 Cleaning up old test data...');
  
  const Appointment = mongoose.model('Appointment', new mongoose.Schema({}, { strict: false }));
  const Invoice = mongoose.model('Invoice', new mongoose.Schema({}, { strict: false }));
  const InvoiceDetail = mongoose.model('InvoiceDetail', new mongoose.Schema({}, { strict: false }));
  
  // Delete test appointments
  const aptResult = await Appointment.deleteMany({
    appointmentCode: /^APT-.*-TEST$|^APT-2025-.*-\d+$/
  });
  console.log(`  Deleted ${aptResult.deletedCount} test appointments`);
  
  // Delete test invoices
  const invResult = await Invoice.deleteMany({
    invoiceCode: /^INV-.*-TEST$/
  });
  console.log(`  Deleted ${invResult.deletedCount} test invoices`);
  
  // Delete test invoice details
  const detailResult = await InvoiceDetail.deleteMany({
    serviceName: 'Khám và tư vấn cơ bản',
    unitPrice: 200000
  });
  console.log(`  Deleted ${detailResult.deletedCount} test invoice details`);
}

async function main() {
  console.log('🚀 Starting sample data creation for timezone fix testing\n');
  console.log(`MongoDB URI: ${MONGO_URI}\n`);
  
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Cleanup old test data
    await cleanupTestData();
    console.log('');
    
    // Create sample data
    const appointment = await createSampleAppointment();
    await createSampleInvoice(appointment._id);
    console.log('');
    
    await createMultipleBookingChannelData();
    console.log('');
    
    // Note: Schedule slots require schedule-service database
    console.log('⚠️  Note: Clinic utilization requires slots in schedule-service database');
    console.log('   Please create slots manually or run schedule-service seed script\n');
    
    console.log('✅ Sample data created successfully!');
    console.log('\nYou can now run: node test-timezone-fix.js\n');
    
  } catch (error) {
    console.error('❌ Error creating sample data:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { createSampleAppointment, createSampleInvoice, createMultipleBookingChannelData };

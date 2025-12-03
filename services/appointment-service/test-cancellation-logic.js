/**
 * Test canRequestCancellation logic
 * Verify timezone handling for 24-hour cancellation rule
 */

// Mock appointment data
const mockAppointment = {
  appointmentDate: new Date("2025-12-03T17:00:00.000Z"), // = 2025-12-04 00:00 Vietnam
  startTime: "08:00", // 8:00 AM Vietnam
  status: "confirmed",
  bookedByRole: "patient"
};

console.log("📅 Testing canRequestCancellation Logic");
console.log("=" .repeat(60));

// Test logic from appointment.model.js
function testCanRequestCancellation(appointment, mockNow) {
  console.log("\n🔍 Test Case:");
  console.log("Appointment Date (UTC):", appointment.appointmentDate.toISOString());
  
  // Convert to Vietnam timezone for display
  const vietnamDateStr = appointment.appointmentDate.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  console.log("Appointment Date (Vietnam):", vietnamDateStr);
  console.log("Appointment Time:", appointment.startTime);
  
  // Current implementation logic
  const [hours, minutes] = appointment.startTime.split(':').map(Number);
  
  const vietnamDate = appointment.appointmentDate.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const [month, day, year] = vietnamDate.split('/');
  
  // Create appointment datetime in Vietnam timezone
  const appointmentDateTime = new Date(`${year}-${month}-${day}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+07:00`);
  
  console.log("Constructed Appointment DateTime:", appointmentDateTime.toISOString());
  console.log("Constructed Appointment (Vietnam):", appointmentDateTime.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }));
  
  const now = mockNow || new Date();
  console.log("\nCurrent Time (UTC):", now.toISOString());
  console.log("Current Time (Vietnam):", now.toLocaleString('en-US', { 
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }));
  
  const timeDiff = appointmentDateTime - now;
  const hours24 = timeDiff / (1000 * 60 * 60);
  const oneDayInMs = 24 * 60 * 60 * 1000;
  
  console.log("\nTime Difference:");
  console.log("  Milliseconds:", timeDiff);
  console.log("  Hours:", hours24.toFixed(2));
  console.log("  Days:", (hours24 / 24).toFixed(2));
  
  const canRequest = timeDiff >= oneDayInMs;
  console.log("\n✅ Result:", canRequest ? "CAN REQUEST CANCEL" : "❌ CANNOT REQUEST CANCEL");
  console.log("  Reason:", canRequest ? "More than 24 hours before appointment" : "Less than 24 hours before appointment");
  
  return canRequest;
}

// Test Case 1: 07:41 ngày 3/12 - appointment 08:00 ngày 4/12
console.log("\n" + "=".repeat(60));
console.log("TEST 1: Now = 03/12/2025 07:41 Vietnam");
console.log("        Appointment = 04/12/2025 08:00 Vietnam");
console.log("        Expected: CAN CANCEL (24h19m before)");
console.log("=".repeat(60));

const testNow1 = new Date("2025-12-03T00:41:00.000Z"); // 07:41 Vietnam
testCanRequestCancellation(mockAppointment, testNow1);

// Test Case 2: 08:01 ngày 3/12 - appointment 08:00 ngày 4/12  
console.log("\n" + "=".repeat(60));
console.log("TEST 2: Now = 03/12/2025 08:01 Vietnam");
console.log("        Appointment = 04/12/2025 08:00 Vietnam");
console.log("        Expected: CANNOT CANCEL (23h59m before)");
console.log("=".repeat(60));

const testNow2 = new Date("2025-12-03T01:01:00.000Z"); // 08:01 Vietnam
testCanRequestCancellation(mockAppointment, testNow2);

// Test Case 3: Edge case - exactly 24 hours
console.log("\n" + "=".repeat(60));
console.log("TEST 3: Now = 03/12/2025 08:00 Vietnam");
console.log("        Appointment = 04/12/2025 08:00 Vietnam");
console.log("        Expected: CAN CANCEL (exactly 24h before)");
console.log("=".repeat(60));

const testNow3 = new Date("2025-12-03T01:00:00.000Z"); // 08:00 Vietnam
testCanRequestCancellation(mockAppointment, testNow3);

// Test Case 4: Same day - morning
console.log("\n" + "=".repeat(60));
console.log("TEST 4: Now = 04/12/2025 07:00 Vietnam");
console.log("        Appointment = 04/12/2025 08:00 Vietnam");
console.log("        Expected: CANNOT CANCEL (1h before)");
console.log("=".repeat(60));

const testNow4 = new Date("2025-12-04T00:00:00.000Z"); // 07:00 Vietnam
testCanRequestCancellation(mockAppointment, testNow4);

console.log("\n" + "=".repeat(60));
console.log("✅ All tests completed!");
console.log("=".repeat(60));

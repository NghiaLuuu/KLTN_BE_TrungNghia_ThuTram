/**
 * Test file để kiểm tra logic filter appointmentDateVN
 */

// Test data giống như API response
const testData = [
  {
    appointmentId: "692f500c37313e320ccc7ace",
    patientName: "Nguyễn Thu Trâm",
    appointmentDate: "2025-12-28T17:00:00.000Z",
    appointmentDateVN: "2025-12-29T00:00:00.000Z"
  },
  {
    appointmentId: "692f486537313e320ccc7a7b",
    patientName: "Nguyễn Thu Trâm",
    appointmentDate: "2025-12-26T17:00:00.000Z",
    appointmentDateVN: "2025-12-27T00:00:00.000Z"
  },
  {
    appointmentId: "692f1a498ca6e05458e20091",
    patientName: "Unknown",
    appointmentDate: "2025-12-10T01:00:00.000Z",
    appointmentDateVN: "2025-12-10T08:00:00.000Z"
  }
];

// Test filter với startDate = 2025-12-29
const startDate = "2025-12-29";
const endDate = "2025-12-29";

console.log("=== TEST FILTER LOGIC ===\n");
console.log(`Filter: startDate=${startDate}, endDate=${endDate}\n`);

console.log("\n🔴 OLD LOGIC (BUG - using toISOString):\n");
testData.forEach(p => {
  console.log(`📋 Patient: ${p.patientName} (${p.appointmentId.slice(-4)})`);
  console.log(`   appointmentDateVN: ${p.appointmentDateVN}`);
  
  // OLD LOGIC (BUG)
  const apptDateObj = new Date(p.appointmentDateVN);
  const apptDateStrOld = apptDateObj.toISOString().split('T')[0];
  
  console.log(`   OLD: Converted to: ${apptDateStrOld}`);
  const matchOld = apptDateStrOld >= startDate && apptDateStrOld <= endDate;
  console.log(`   OLD: Match = ${matchOld} ${matchOld ? '✅' : '❌'}\n`);
});

console.log("\n✅ NEW LOGIC (FIXED - using UTC methods):\n");
testData.forEach(p => {
  console.log(`📋 Patient: ${p.patientName} (${p.appointmentId.slice(-4)})`);
  console.log(`   appointmentDateVN: ${p.appointmentDateVN}`);
  
  // NEW LOGIC (FIXED)
  const apptDateObj = new Date(p.appointmentDateVN);
  const year = apptDateObj.getUTCFullYear();
  const month = String(apptDateObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(apptDateObj.getUTCDate()).padStart(2, '0');
  const apptDateStrNew = `${year}-${month}-${day}`;
  
  console.log(`   NEW: Converted to: ${apptDateStrNew}`);
  const matchNew = apptDateStrNew >= startDate && apptDateStrNew <= endDate;
  console.log(`   NEW: Match = ${matchNew} ${matchNew ? '✅' : '❌'}\n`);
});

console.log("\n=== EXPECTED RESULT ===");
console.log("✅ Patient 'Nguyễn Thu Trâm' (7ace) should MATCH (appointmentDateVN = 2025-12-29)");
console.log("❌ Patient 'Nguyễn Thu Trâm' (7a7b) should NOT match (appointmentDateVN = 2025-12-27)");
console.log("❌ Patient 'Unknown' (0091) should NOT match (appointmentDateVN = 2025-12-10)");

/**
 * Debug filter logic - NEW LOGIC
 * Filter theo appointmentDate (UTC) rồi convert sang VN timezone
 */

// Data từ API response thực tế
const testPatients = [
  {
    appointmentId: "692f500c37313e320ccc7ace",
    patientName: "Nguyễn Thu Trâm",
    appointmentDate: "2025-12-28T17:00:00.000Z", // UTC: 28/12 17:00 = VN: 29/12 00:00
    appointmentDateVN: "2025-12-29T00:00:00.000Z"
  },
  {
    appointmentId: "692f486537313e320ccc7a7b",
    patientName: "Nguyễn Thu Trâm",
    appointmentDate: "2025-12-26T17:00:00.000Z", // UTC: 26/12 17:00 = VN: 27/12 00:00
    appointmentDateVN: "2025-12-27T00:00:00.000Z"
  }
];

console.log("=== NEW LOGIC: Convert appointmentDate (UTC) to VN timezone ===\n");

// Test 1: Filter startDate=2025-12-29, endDate=2025-12-29
console.log("TEST 1: Filter 2025-12-29\n");
const startDate1 = "2025-12-29";
const endDate1 = "2025-12-29";

testPatients.forEach(p => {
  console.log(`Patient: ${p.patientName} (${p.appointmentId.slice(-4)})`);
  console.log(`  appointmentDate (UTC): ${p.appointmentDate}`);
  
  // NEW LOGIC: Convert appointmentDate to VN timezone
  const apptDateUTC = new Date(p.appointmentDate);
  const apptDateVN = new Date(apptDateUTC.getTime() + 7 * 60 * 60 * 1000);
  
  const year = apptDateVN.getUTCFullYear();
  const month = String(apptDateVN.getUTCMonth() + 1).padStart(2, '0');
  const day = String(apptDateVN.getUTCDate()).padStart(2, '0');
  const apptDateStr = `${year}-${month}-${day}`;
  
  console.log(`  Converted to VN date: ${apptDateStr}`);
  console.log(`  Comparison: ${apptDateStr} >= ${startDate1} && ${apptDateStr} <= ${endDate1}`);
  
  const match = apptDateStr >= startDate1 && apptDateStr <= endDate1;
  console.log(`  Match: ${match ? '✅ YES' : '❌ NO'}\n`);
});

// Test 2: Filter startDate=2025-12-28, endDate=2025-12-28
console.log("\nTEST 2: Filter 2025-12-28\n");
const startDate2 = "2025-12-28";
const endDate2 = "2025-12-28";

testPatients.forEach(p => {
  console.log(`Patient: ${p.patientName} (${p.appointmentId.slice(-4)})`);
  console.log(`  appointmentDate (UTC): ${p.appointmentDate}`);
  
  const apptDateUTC = new Date(p.appointmentDate);
  const apptDateVN = new Date(apptDateUTC.getTime() + 7 * 60 * 60 * 1000);
  
  const year = apptDateVN.getUTCFullYear();
  const month = String(apptDateVN.getUTCMonth() + 1).padStart(2, '0');
  const day = String(apptDateVN.getUTCDate()).padStart(2, '0');
  const apptDateStr = `${year}-${month}-${day}`;
  
  console.log(`  Converted to VN date: ${apptDateStr}`);
  console.log(`  Comparison: ${apptDateStr} >= ${startDate2} && ${apptDateStr} <= ${endDate2}`);
  
  const match = apptDateStr >= startDate2 && apptDateStr <= endDate2;
  console.log(`  Match: ${match ? '✅ YES' : '❌ NO'}\n`);
});

console.log("\n=== EXPECTED RESULTS ===");
console.log("Filter 2025-12-29: Patient 7ace should MATCH ✅ (appointmentDate UTC 28/12 17:00 = VN 29/12 00:00)");
console.log("Filter 2025-12-29: Patient 7a7b should NOT match ❌ (appointmentDate UTC 26/12 17:00 = VN 27/12 00:00)");
console.log("Filter 2025-12-28: Both should NOT match ❌ (cả 2 đều là ngày 29 và 27 ở VN timezone)");

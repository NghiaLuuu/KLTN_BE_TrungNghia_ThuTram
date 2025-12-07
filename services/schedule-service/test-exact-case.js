/**
 * Test exact case từ API
 */

const appointmentDate = "2025-12-28T17:00:00.000Z";

console.log("=== DEBUG EXACT CASE ===\n");
console.log(`appointmentDate: ${appointmentDate}`);

// Convert to VN timezone (+7 hours)
const apptDateUTC = new Date(appointmentDate);
console.log(`apptDateUTC parsed: ${apptDateUTC.toISOString()}`);
console.log(`apptDateUTC time: ${apptDateUTC.getTime()}`);

const apptDateVN = new Date(apptDateUTC.getTime() + 7 * 60 * 60 * 1000);
console.log(`\napptDateVN (+7h): ${apptDateVN.toISOString()}`);
console.log(`apptDateVN time: ${apptDateVN.getTime()}`);

// Extract date parts
const year = apptDateVN.getUTCFullYear();
const month = String(apptDateVN.getUTCMonth() + 1).padStart(2, '0');
const day = String(apptDateVN.getUTCDate()).padStart(2, '0');
const apptDateStr = `${year}-${month}-${day}`;

console.log(`\nExtracted VN date: ${apptDateStr}`);
console.log(`Year: ${year}, Month: ${month}, Day: ${day}`);

// Test filters
console.log("\n=== FILTER TESTS ===\n");

// Test 1: 29-29
const start1 = "2025-12-29";
const end1 = "2025-12-29";
const match1 = apptDateStr >= start1 && apptDateStr <= end1;
console.log(`Filter ${start1} to ${end1}:`);
console.log(`  ${apptDateStr} >= ${start1} = ${apptDateStr >= start1}`);
console.log(`  ${apptDateStr} <= ${end1} = ${apptDateStr <= end1}`);
console.log(`  Result: ${match1 ? '✅ MATCH' : '❌ NO MATCH'}`);

// Test 2: 28-28
console.log(`\nFilter 2025-12-28 to 2025-12-28:`);
const start2 = "2025-12-28";
const end2 = "2025-12-28";
const match2 = apptDateStr >= start2 && apptDateStr <= end2;
console.log(`  ${apptDateStr} >= ${start2} = ${apptDateStr >= start2}`);
console.log(`  ${apptDateStr} <= ${end2} = ${apptDateStr <= end2}`);
console.log(`  Result: ${match2 ? '✅ MATCH' : '❌ NO MATCH'}`);

// Test 3: 28-29
console.log(`\nFilter 2025-12-28 to 2025-12-29:`);
const start3 = "2025-12-28";
const end3 = "2025-12-29";
const match3 = apptDateStr >= start3 && apptDateStr <= end3;
console.log(`  ${apptDateStr} >= ${start3} = ${apptDateStr >= start3}`);
console.log(`  ${apptDateStr} <= ${end3} = ${apptDateStr <= end3}`);
console.log(`  Result: ${match3 ? '✅ MATCH' : '❌ NO MATCH'}`);

console.log("\n=== EXPECTED ===");
console.log("Filter 29-29: Should MATCH ✅");
console.log("Filter 28-28: Should NOT match ❌");
console.log("Filter 28-29: Should MATCH ✅");

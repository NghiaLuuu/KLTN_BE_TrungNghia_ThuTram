const { isLastDayOfQuarter, getNextQuarterForScheduling } = require('./src/services/schedule.service');

console.log('=== Test Quarter-End Logic ===');
console.log('Testing dates:');

const dates = [
  '2024-03-30',   // 30/3 - not last day of Q1
  '2024-03-31',   // 31/3 - last day of Q1  
  '2024-06-29',   // 29/6 - not last day of Q2
  '2024-06-30',   // 30/6 - last day of Q2
  '2024-09-30',   // 30/9 - last day of Q3
  '2024-12-30',   // 30/12 - not last day of Q4
  '2024-12-31'    // 31/12 - last day of Q4
];

dates.forEach(dateStr => {
  const date = new Date(dateStr + 'T10:00:00+07:00');
  const isLast = isLastDayOfQuarter(date);
  console.log(`${dateStr}: ${isLast ? 'LAST DAY' : 'normal'}`);
});

console.log('\nNext quarter calculation:');
const nextQ = getNextQuarterForScheduling();
console.log('Next Quarter:', nextQ);

// Test auto-schedule simulation
const autoScheduleService = require('./src/services/autoSchedule.service');

console.log('\n=== Test Auto-Schedule Simulation ===');

// Test với ngày cuối quý
const testLastDay = async () => {
  try {
    const lastDayQ1 = new Date('2024-03-31T10:00:00+07:00');
    console.log('\nSimulating last day of Q1 (31/3):');
    
    const result = await autoScheduleService.simulateAutoGeneration(lastDayQ1);
    console.log('Action Plan:', result.actionPlan.message);
    console.log('Summary:', result.summary);
  } catch (error) {
    console.error('Error:', error.message);
  }
};

testLastDay();
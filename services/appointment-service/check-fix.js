/**
 * Quick check to verify the fix is applied
 */
const fs = require('fs');
const path = require('path');

const serviceFile = path.join(__dirname, 'src', 'services', 'appointment.service.js');
const content = fs.readFileSync(serviceFile, 'utf8');

// Check if the fix is present
const hasExtractId = content.includes('const extractId = (field) =>');
const hasFixedRoomId = content.includes('const roomId = extractId(firstSlot.roomId)');
const hasFixedSubRoomId = content.includes('const subRoomId = extractId(firstSlot.subRoomId)');

console.log('✅ Fix Status Check:');
console.log('  - Has extractId helper:', hasExtractId ? '✅' : '❌');
console.log('  - Uses extractId for roomId:', hasFixedRoomId ? '✅' : '❌');
console.log('  - Uses extractId for subRoomId:', hasFixedSubRoomId ? '✅' : '❌');

if (hasExtractId && hasFixedRoomId && hasFixedSubRoomId) {
  console.log('\n🎉 Fix is properly applied!');
  console.log('👉 Please restart appointment-service to use the new code.');
  console.log('\nIf using npm/nodemon:');
  console.log('  1. Press Ctrl+C in the appointment-service terminal');
  console.log('  2. Run: npm run dev');
  console.log('\nIf using Docker:');
  console.log('  docker-compose restart appointment-service');
} else {
  console.log('\n❌ Fix is NOT properly applied!');
  console.log('Please check the file manually.');
}

// Show a sample of the fixed code
const lines = content.split('\n');
const extractIdLineIndex = lines.findIndex(l => l.includes('const extractId = (field) =>'));
if (extractIdLineIndex !== -1) {
  console.log('\n📝 Sample of fixed code (around line', extractIdLineIndex + 1, '):');
  console.log(lines.slice(extractIdLineIndex, extractIdLineIndex + 8).join('\n'));
}

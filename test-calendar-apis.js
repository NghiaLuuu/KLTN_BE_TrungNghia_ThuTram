/**
 * Test Calendar APIs - Room, Dentist, Nurse Calendar với Phân Trang và Xem Lịch Quá Khứ
 * 
 * Các API có sẵn:
 * 1. GET /room/:roomId/calendar - Lịch phòng
 * 2. GET /dentist/:dentistId/calendar - Lịch nha sỹ  
 * 3. GET /nurse/:nurseId/calendar - Lịch y tá
 * 
 * Phân trang:
 * - page=1: Hiện tại và tương lai
 * - page=-1: Quá khứ (1 chu kỳ trước)
 * - page=-2: Quá khứ (2 chu kỳ trước)
 * - page=2: Tương lai (2 chu kỳ sau)
 * 
 * ViewType: day, week, month
 * Limit: số chu kỳ trả về (1-100)
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5006/api/slots';

// Test data
const ROOM_ID = '68dd31c43df7b61e7b509e61';
const DENTIST_ID = '68dd337f327b922b6119b902';
const NURSE_ID = '68dd338d327b922b6119b90d';

async function testRoomCalendar() {
  console.log('\n=== 🏥 TEST ROOM CALENDAR ===');
  
  try {
    // Test 1: Lịch phòng theo tuần - hiện tại
    console.log('\n1. Lịch phòng theo tuần - hiện tại (page=1):');
    const currentWeek = await axios.get(`${BASE_URL}/room/${ROOM_ID}/calendar`, {
      params: {
        viewType: 'week',
        page: 1,
        limit: 2
      }
    });
    console.log('✅ Current week:', currentWeek.data.data.periods.length, 'periods');
    
    // Test 2: Lịch phòng theo tuần - quá khứ
    console.log('\n2. Lịch phòng theo tuần - quá khứ (page=-1):');
    const pastWeek = await axios.get(`${BASE_URL}/room/${ROOM_ID}/calendar`, {
      params: {
        viewType: 'week',
        page: -1,
        limit: 2
      }
    });
    console.log('✅ Past week:', pastWeek.data.data.periods.length, 'periods');
    
    // Test 3: Lịch phòng theo tháng - tương lai
    console.log('\n3. Lịch phòng theo tháng - tương lai (page=2):');
    const futureMonth = await axios.get(`${BASE_URL}/room/${ROOM_ID}/calendar`, {
      params: {
        viewType: 'month',
        page: 2,
        limit: 1
      }
    });
    console.log('✅ Future month:', futureMonth.data.data.periods.length, 'periods');
    
  } catch (error) {
    console.error('❌ Room calendar test failed:', error.response?.data || error.message);
  }
}

async function testDentistCalendar() {
  console.log('\n=== 🦷 TEST DENTIST CALENDAR ===');
  
  try {
    // Test 1: Lịch nha sỹ theo ngày - hiện tại
    console.log('\n1. Lịch nha sỹ theo ngày - hiện tại (page=1):');
    const currentDay = await axios.get(`${BASE_URL}/dentist/${DENTIST_ID}/calendar`, {
      params: {
        viewType: 'day',
        page: 1,
        limit: 5
      }
    });
    console.log('✅ Current days:', currentDay.data.data.periods.length, 'periods');
    
    // Test 2: Lịch nha sỹ theo ngày - quá khứ
    console.log('\n2. Lịch nha sỹ theo ngày - quá khứ (page=-2):');
    const pastDays = await axios.get(`${BASE_URL}/dentist/${DENTIST_ID}/calendar`, {
      params: {
        viewType: 'day',
        page: -2,
        limit: 5
      }
    });
    console.log('✅ Past days:', pastDays.data.data.periods.length, 'periods');
    
    // Test 3: Lịch nha sỹ theo tuần
    console.log('\n3. Lịch nha sỹ theo tuần (page=1):');
    const week = await axios.get(`${BASE_URL}/dentist/${DENTIST_ID}/calendar`, {
      params: {
        viewType: 'week',
        page: 1,
        limit: 3
      }
    });
    console.log('✅ Weekly view:', week.data.data.periods.length, 'periods');
    
  } catch (error) {
    console.error('❌ Dentist calendar test failed:', error.response?.data || error.message);
  }
}

async function testNurseCalendar() {
  console.log('\n=== 💉 TEST NURSE CALENDAR ===');
  
  try {
    // Test 1: Lịch y tá theo tháng - hiện tại
    console.log('\n1. Lịch y tá theo tháng - hiện tại (page=1):');
    const currentMonth = await axios.get(`${BASE_URL}/nurse/${NURSE_ID}/calendar`, {
      params: {
        viewType: 'month',
        page: 1,
        limit: 2
      }
    });
    console.log('✅ Current months:', currentMonth.data.data.periods.length, 'periods');
    
    // Test 2: Lịch y tá theo tháng - quá khứ
    console.log('\n2. Lịch y tá theo tháng - quá khứ (page=-1):');
    const pastMonth = await axios.get(`${BASE_URL}/nurse/${NURSE_ID}/calendar`, {
      params: {
        viewType: 'month',
        page: -1,
        limit: 1
      }
    });
    console.log('✅ Past month:', pastMonth.data.data.periods.length, 'periods');
    
  } catch (error) {
    console.error('❌ Nurse calendar test failed:', error.response?.data || error.message);
  }
}

async function runAllTests() {
  console.log('🚀 TESTING CALENDAR APIs WITH PAGINATION & HISTORICAL DATA');
  console.log('Base URL:', BASE_URL);
  
  await testRoomCalendar();
  await testDentistCalendar();
  await testNurseCalendar();
  
  console.log('\n✨ All tests completed!');
  console.log('\n📋 API Usage Examples:');
  console.log(`
  🏥 Room Calendar:
  GET ${BASE_URL}/room/${ROOM_ID}/calendar?viewType=week&page=1&limit=2
  
  🦷 Dentist Calendar:
  GET ${BASE_URL}/dentist/${DENTIST_ID}/calendar?viewType=day&page=-1&limit=5
  
  💉 Nurse Calendar:
  GET ${BASE_URL}/nurse/${NURSE_ID}/calendar?viewType=month&page=2&limit=1
  
  📅 Pagination Examples:
  - page=1: Hiện tại (chu kỳ 0 → limit-1)
  - page=2: Tương lai (chu kỳ limit → 2*limit-1)  
  - page=-1: Quá khứ gần (chu kỳ -limit → -1)
  - page=-2: Quá khứ xa (chu kỳ -2*limit → -limit-1)
  
  🔍 ViewType Options:
  - day: Theo ngày
  - week: Theo tuần (Thứ 2 - Chủ nhật)
  - month: Theo tháng
  `);
}

// Chạy test nếu file được execute trực tiếp
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testRoomCalendar,
  testDentistCalendar, 
  testNurseCalendar,
  runAllTests
};
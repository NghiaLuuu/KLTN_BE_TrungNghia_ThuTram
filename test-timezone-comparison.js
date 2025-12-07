/**
 * Test so sánh logic parse date: Code CŨ vs Code MỚI
 * Không cần database, chỉ test logic xử lý timezone
 */

const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Ho_Chi_Minh';

// ============================================================================
// CODE CŨ - Parse date theo UTC (SAI)
// ============================================================================
function parseDate_OLD(dateStr) {
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0); // Set giờ local (nhưng Date object vẫn lưu UTC)
  return date;
}

function parseDateRange_OLD(startDateStr, endDateStr) {
  const startDate = new Date(startDateStr);
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(endDateStr);
  endDate.setHours(23, 59, 59, 999);
  
  return { startDate, endDate };
}

// ============================================================================
// CODE MỚI - Parse date theo timezone Việt Nam (ĐÚNG)
// ============================================================================
function parseDate_NEW(dateStr) {
  return moment.tz(dateStr, TIMEZONE).startOf('day').toDate();
}

function parseDateRange_NEW(startDateStr, endDateStr) {
  const startDate = moment.tz(startDateStr, TIMEZONE).startOf('day').toDate();
  const endDate = moment.tz(endDateStr, TIMEZONE).endOf('day').toDate();
  return { startDate, endDate };
}

// ============================================================================
// MOCK DATA - Giả lập dữ liệu trong database
// ============================================================================
const mockAppointments = [
  {
    id: 1,
    appointmentCode: 'APT001',
    patientName: 'Nguyễn Văn A',
    appointmentDate: new Date('2025-12-06T03:00:00.000Z'), // 10:00 VN = 03:00 UTC
    status: 'completed',
    bookedByRole: 'patient'
  },
  {
    id: 2,
    appointmentCode: 'APT002',
    patientName: 'Trần Thị B',
    appointmentDate: new Date('2025-12-06T08:00:00.000Z'), // 15:00 VN = 08:00 UTC
    status: 'completed',
    bookedByRole: 'receptionist'
  },
  {
    id: 3,
    appointmentCode: 'APT003',
    patientName: 'Lê Văn C',
    appointmentDate: new Date('2025-12-06T16:30:00.000Z'), // 23:30 VN = 16:30 UTC
    status: 'cancelled',
    bookedByRole: 'patient'
  },
  {
    id: 4,
    appointmentCode: 'APT004',
    patientName: 'Phạm Thị D',
    appointmentDate: new Date('2025-12-07T02:00:00.000Z'), // 09:00 VN ngày 07/12 = 02:00 UTC ngày 07/12
    status: 'completed',
    bookedByRole: 'patient'
  }
];

const mockInvoiceDetails = [
  {
    id: 1,
    invoiceCode: 'INV001',
    patientName: 'Nguyễn Văn A',
    serviceName: 'Khám tổng quát',
    completedDate: new Date('2025-12-06T03:30:00.000Z'), // 10:30 VN = 03:30 UTC
    unitPrice: 200000,
    quantity: 1,
    totalPrice: 200000,
    status: 'completed'
  },
  {
    id: 2,
    invoiceCode: 'INV002',
    patientName: 'Trần Thị B',
    serviceName: 'Nhổ răng',
    completedDate: new Date('2025-12-06T09:00:00.000Z'), // 16:00 VN = 09:00 UTC
    unitPrice: 500000,
    quantity: 1,
    totalPrice: 500000,
    status: 'completed'
  },
  {
    id: 3,
    invoiceCode: 'INV003',
    patientName: 'Phạm Thị D',
    serviceName: 'Trám răng',
    completedDate: new Date('2025-12-07T02:30:00.000Z'), // 09:30 VN ngày 07/12 = 02:30 UTC ngày 07/12
    unitPrice: 300000,
    quantity: 2,
    totalPrice: 600000,
    status: 'completed'
  }
];

// ============================================================================
// QUERY SIMULATION
// ============================================================================
function queryAppointments(startDate, endDate) {
  return mockAppointments.filter(apt => 
    apt.appointmentDate >= startDate && apt.appointmentDate <= endDate
  );
}

function queryInvoiceDetails(startDate, endDate) {
  return mockInvoiceDetails.filter(inv => 
    inv.completedDate >= startDate && inv.completedDate <= endDate
  );
}

// ============================================================================
// COLORS
// ============================================================================
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================
function displayDateInfo(label, dateStr) {
  console.log(`\n${label}:`);
  console.log(`  Input: "${dateStr}"`);
  
  // VN timezone (ĐÚNG)
  const vnStart = moment.tz(dateStr, TIMEZONE).startOf('day');
  const vnEnd = moment.tz(dateStr, TIMEZONE).endOf('day');
  log(`  ✓ VN Timezone (${TIMEZONE}):`, 'green');
  console.log(`    Start: ${vnStart.format('YYYY-MM-DD HH:mm:ss')} VN = ${vnStart.toISOString()}`);
  console.log(`    End:   ${vnEnd.format('YYYY-MM-DD HH:mm:ss')} VN = ${vnEnd.toISOString()}`);
  
  // UTC (SAI)
  const utcDate = new Date(dateStr);
  utcDate.setHours(0, 0, 0, 0);
  const utcEnd = new Date(dateStr);
  utcEnd.setHours(23, 59, 59, 999);
  log(`  ✗ UTC Parse (SAI):`, 'red');
  console.log(`    Start: ${utcDate.toISOString()} (thiếu dữ liệu từ 00:00-07:00 VN)`);
  console.log(`    End:   ${utcEnd.toISOString()} (dư dữ liệu đến 07:00 sáng hôm sau VN)`);
}

function testQuery(testName, dateStr, oldMethod, newMethod) {
  log('\n' + '='.repeat(80), 'bright');
  log(testName, 'cyan');
  log('='.repeat(80), 'bright');
  
  displayDateInfo('Date Range Info', dateStr);
  
  // Test CODE CŨ
  console.log('\n' + '-'.repeat(80));
  log('CODE CŨ (parse theo UTC):', 'red');
  const oldRange = oldMethod(dateStr, dateStr);
  console.log(`  Start: ${oldRange.startDate.toISOString()}`);
  console.log(`  End:   ${oldRange.endDate.toISOString()}`);
  
  const oldResults = queryAppointments(oldRange.startDate, oldRange.endDate);
  log(`  Kết quả: ${oldResults.length} appointments`, oldResults.length > 0 ? 'yellow' : 'reset');
  oldResults.forEach(apt => {
    const vnTime = moment(apt.appointmentDate).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    console.log(`    - ${apt.appointmentCode}: ${apt.patientName} (${vnTime} VN)`);
  });
  
  // Test CODE MỚI
  console.log('\n' + '-'.repeat(80));
  log('CODE MỚI (parse theo timezone VN):', 'green');
  const newRange = newMethod(dateStr, dateStr);
  console.log(`  Start: ${newRange.startDate.toISOString()}`);
  console.log(`  End:   ${newRange.endDate.toISOString()}`);
  
  const newResults = queryAppointments(newRange.startDate, newRange.endDate);
  log(`  Kết quả: ${newResults.length} appointments`, newResults.length > 0 ? 'yellow' : 'reset');
  newResults.forEach(apt => {
    const vnTime = moment(apt.appointmentDate).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    console.log(`    - ${apt.appointmentCode}: ${apt.patientName} (${vnTime} VN)`);
  });
  
  // So sánh
  console.log('\n' + '-'.repeat(80));
  const isCorrect = newResults.length === 3 && oldResults.length === 0;
  if (isCorrect) {
    log('✓ KẾT QUẢ: CODE MỚI ĐÚNG, CODE CŨ SAI', 'green');
    console.log('  - Code cũ: Thiếu dữ liệu (query từ 07:00 sáng, mất data từ 00:00-07:00 VN)');
    console.log('  - Code mới: Đầy đủ dữ liệu (query từ 00:00 VN)');
  } else {
    log('? Kết quả không như mong đợi', 'yellow');
  }
}

function testInvoiceQuery(dateStr) {
  log('\n' + '='.repeat(80), 'bright');
  log('TEST 2: Revenue Statistics (Invoice Details)', 'cyan');
  log('='.repeat(80), 'bright');
  
  displayDateInfo('Date Range Info', dateStr);
  
  // CODE CŨ
  console.log('\n' + '-'.repeat(80));
  log('CODE CŨ (parse theo UTC):', 'red');
  const oldRange = parseDateRange_OLD(dateStr, dateStr);
  console.log(`  Start: ${oldRange.startDate.toISOString()}`);
  console.log(`  End:   ${oldRange.endDate.toISOString()}`);
  
  const oldInvoices = queryInvoiceDetails(oldRange.startDate, oldRange.endDate);
  const oldRevenue = oldInvoices.reduce((sum, inv) => sum + inv.totalPrice, 0);
  log(`  Kết quả: ${oldInvoices.length} invoices, Doanh thu: ${oldRevenue.toLocaleString('vi-VN')} VNĐ`, 'yellow');
  oldInvoices.forEach(inv => {
    const vnTime = moment(inv.completedDate).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    console.log(`    - ${inv.invoiceCode}: ${inv.patientName} - ${inv.serviceName} (${vnTime} VN) = ${inv.totalPrice.toLocaleString()} VNĐ`);
  });
  
  // CODE MỚI
  console.log('\n' + '-'.repeat(80));
  log('CODE MỚI (parse theo timezone VN):', 'green');
  const newRange = parseDateRange_NEW(dateStr, dateStr);
  console.log(`  Start: ${newRange.startDate.toISOString()}`);
  console.log(`  End:   ${newRange.endDate.toISOString()}`);
  
  const newInvoices = queryInvoiceDetails(newRange.startDate, newRange.endDate);
  const newRevenue = newInvoices.reduce((sum, inv) => sum + inv.totalPrice, 0);
  log(`  Kết quả: ${newInvoices.length} invoices, Doanh thu: ${newRevenue.toLocaleString('vi-VN')} VNĐ`, 'yellow');
  newInvoices.forEach(inv => {
    const vnTime = moment(inv.completedDate).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    console.log(`    - ${inv.invoiceCode}: ${inv.patientName} - ${inv.serviceName} (${vnTime} VN) = ${inv.totalPrice.toLocaleString()} VNĐ`);
  });
  
  // So sánh
  console.log('\n' + '-'.repeat(80));
  const revenueDiff = newRevenue - oldRevenue;
  if (revenueDiff > 0) {
    log(`✓ CHÊNH LỆCH: Code mới cao hơn ${revenueDiff.toLocaleString('vi-VN')} VNĐ`, 'green');
    console.log('  - Code cũ: Thiếu doanh thu từ 00:00-07:00 VN');
    console.log('  - Code mới: Đầy đủ doanh thu cả ngày');
  }
}

function displayMockData() {
  log('\n' + '█'.repeat(80), 'bright');
  log('DỮ LIỆU MẪU GIẢ LẬP (Mock Data)', 'bright');
  log('█'.repeat(80) + '\n', 'bright');
  
  log('APPOINTMENTS:', 'cyan');
  mockAppointments.forEach(apt => {
    const vnTime = moment(apt.appointmentDate).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    const utcTime = apt.appointmentDate.toISOString();
    console.log(`  ${apt.appointmentCode}: ${apt.patientName}`);
    console.log(`    VN Time:  ${vnTime}`);
    console.log(`    UTC Time: ${utcTime}`);
    console.log(`    Status: ${apt.status}, Channel: ${apt.bookedByRole}`);
  });
  
  console.log('');
  log('INVOICE DETAILS:', 'cyan');
  mockInvoiceDetails.forEach(inv => {
    const vnTime = moment(inv.completedDate).tz(TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    const utcTime = inv.completedDate.toISOString();
    console.log(`  ${inv.invoiceCode}: ${inv.patientName} - ${inv.serviceName}`);
    console.log(`    VN Time:  ${vnTime}`);
    console.log(`    UTC Time: ${utcTime}`);
    console.log(`    Amount: ${inv.totalPrice.toLocaleString('vi-VN')} VNĐ`);
  });
}

// ============================================================================
// MAIN
// ============================================================================
function main() {
  log('\n' + '█'.repeat(80), 'bright');
  log('TIMEZONE FIX - SO SÁNH CODE CŨ VS CODE MỚI', 'bright');
  log('█'.repeat(80) + '\n', 'bright');
  
  log('Vấn đề:', 'yellow');
  console.log('  - Code cũ: Parse date theo UTC, dùng setHours() để set giờ');
  console.log('    → Khi query database, thiếu data từ 00:00-07:00 giờ VN');
  console.log('  - Code mới: Parse date theo timezone "Asia/Ho_Chi_Minh"');
  console.log('    → Query đúng data cả ngày theo giờ VN\n');
  
  log('Ngày test: 2025-12-06 (có 3 appointments và 2 invoices)', 'yellow');
  console.log('  - Appointment 1: 10:00 VN (nằm trong khoảng 00:00-07:00 UTC+7)');
  console.log('  - Appointment 2: 15:00 VN');
  console.log('  - Appointment 3: 23:30 VN');
  console.log('  - Invoice 1: hoàn thành 10:30 VN');
  console.log('  - Invoice 2: hoàn thành 16:00 VN\n');
  
  // Hiển thị mock data
  displayMockData();
  
  // Test 1: Booking channel / Appointment status
  testQuery(
    'TEST 1: Booking Channel / Appointment Status Statistics',
    '2025-12-06',
    parseDateRange_OLD,
    parseDateRange_NEW
  );
  
  // Test 2: Revenue statistics
  testInvoiceQuery('2025-12-06');
  
  // Summary
  log('\n' + '█'.repeat(80), 'bright');
  log('KẾT LUẬN', 'bright');
  log('█'.repeat(80) + '\n', 'bright');
  
  log('✓ CODE MỚI (sử dụng moment-timezone):', 'green');
  console.log('  - Query đúng timezone Việt Nam');
  console.log('  - Lấy đầy đủ dữ liệu từ 00:00:00 đến 23:59:59 giờ VN');
  console.log('  - Tránh lỗi thiếu/dư data do chênh lệch múi giờ\n');
  
  log('✗ CODE CŨ (parse theo UTC):', 'red');
  console.log('  - Query sai timezone');
  console.log('  - Thiếu dữ liệu từ 00:00-07:00 sáng (theo giờ VN)');
  console.log('  - Dư dữ liệu đến 07:00 sáng hôm sau (theo giờ VN)');
  console.log('  - Dẫn đến thống kê sai\n');
}

main();

/**
 * Timezone Helper Utilities
 * Xử lý chuyển đổi múi giờ cho Việt Nam (UTC+7)
 */

/**
 * Parse một chuỗi ngày (YYYY-MM-DD) thành nửa đêm theo múi giờ Việt Nam
 * Sau đó trả về đối tượng Date UTC để lưu vào MongoDB
 * 
 * Ví dụ:
 * Đầu vào: "2025-11-27"
 * Đầu ra: Date object đại diện cho 2025-11-26T17:00:00.000Z (tức 2025-11-27 00:00 giờ VN)
 * 
 * @param {String|Date} dateInput - Chuỗi ngày định dạng YYYY-MM-DD hoặc Date object
 * @returns {Date} Đối tượng Date UTC
 */
function parseVNDate(dateInput) {
  if (!dateInput) return null;
  
  // Nếu đã là Date object, trả về nguyên trạng
  if (dateInput instanceof Date) {
    return dateInput;
  }
  
  // Parse chuỗi ngày
  const dateStr = String(dateInput);
  
  // Nếu là định dạng ISO có thông tin timezone, parse trực tiếp
  if (dateStr.includes('T') || dateStr.includes('+')) {
    return new Date(dateStr);
  }
  
  // Với định dạng YYYY-MM-DD, thêm offset múi giờ VN
  const [year, month, day] = dateStr.split('-');
  
  if (!year || !month || !day) {
    throw new Error(`Định dạng ngày không hợp lệ: ${dateStr}. Yêu cầu YYYY-MM-DD`);
  }
  
  // Tạo date tại nửa đêm giờ Việt Nam (UTC+7)
  const vnDate = new Date(`${year}-${month}-${day}T00:00:00+07:00`);
  
  return vnDate;
}

/**
 * Lấy ngày/giờ hiện tại theo múi giờ Việt Nam
 * @returns {Date} Thời gian hiện tại đã điều chỉnh về múi giờ VN
 */
function getNowVN() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
}

/**
 * Lấy đầu ngày (00:00:00) theo múi giờ Việt Nam, trả về dạng UTC
 * @param {Date} date - Ngày tùy chọn (mặc định là hôm nay)
 * @returns {Date} Đầu ngày theo múi giờ VN (dạng UTC)
 */
function getStartOfDayVN(date = null) {
  const targetDate = date || new Date();
  
  // Lấy các thành phần ngày/giờ VN
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(targetDate);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  
  // Tạo nửa đêm giờ VN: YYYY-MM-DDT00:00:00+07:00
  return new Date(`${year}-${month}-${day}T00:00:00+07:00`);
}

/**
 * Lấy cuối ngày (23:59:59.999) theo múi giờ Việt Nam, trả về dạng UTC
 * @param {Date} date - Ngày tùy chọn (mặc định là hôm nay)
 * @returns {Date} Cuối ngày theo múi giờ VN (dạng UTC)
 */
function getEndOfDayVN(date = null) {
  const targetDate = date || new Date();
  
  // Lấy các thành phần ngày/giờ VN
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  const parts = formatter.formatToParts(targetDate);
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  
  // Tạo cuối ngày giờ VN: YYYY-MM-DDT23:59:59.999+07:00
  return new Date(`${year}-${month}-${day}T23:59:59.999+07:00`);
}

/**
 * Format date thành YYYY-MM-DD theo múi giờ Việt Nam
 * @param {Date} date - Đối tượng Date
 * @returns {String} Chuỗi ngày định dạng YYYY-MM-DD
 */
function formatDateVN(date) {
  const vnDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const year = vnDate.getFullYear();
  const month = String(vnDate.getMonth() + 1).padStart(2, '0');
  const day = String(vnDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  parseVNDate,
  getNowVN,
  getStartOfDayVN,
  getEndOfDayVN,
  formatDateVN
};

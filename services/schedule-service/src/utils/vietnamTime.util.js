// Các hàm tiện ích để xử lý múi giờ Việt Nam

/**
 * Lấy ngày hiện tại theo múi giờ Việt Nam
 * @returns {Date} Ngày hiện tại theo múi giờ Việt Nam
 */
function getVietnamDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
}

/**
 * Chuyển đổi bất kỳ ngày nào sang múi giờ Việt Nam
 * @param {Date|string} date - Ngày cần chuyển đổi
 * @returns {Date} Ngày theo múi giờ Việt Nam
 */
function toVietnamTime(date) {
  const inputDate = new Date(date);
  return new Date(inputDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
}

/**
 * Định dạng ngày theo múi giờ Việt Nam thành chuỗi
 * @param {Date} date - Ngày cần định dạng
 * @param {Object} options - Các tùy chọn Intl.DateTimeFormat
 * @returns {string} Chuỗi ngày đã định dạng
 */
function formatVietnamDate(date, options = {}) {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    ...options
  }).format(date);
}

module.exports = {
  getVietnamDate,
  toVietnamTime,
  formatVietnamDate
};
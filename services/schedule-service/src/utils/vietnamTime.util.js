// Utility functions for Vietnam timezone handling

/**
 * Get current date in Vietnam timezone
 * @returns {Date} Current date in Vietnam timezone
 */
function getVietnamDate() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
}

/**
 * Convert any date to Vietnam timezone
 * @param {Date|string} date - Date to convert
 * @returns {Date} Date in Vietnam timezone
 */
function toVietnamTime(date) {
  const inputDate = new Date(date);
  return new Date(inputDate.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
}

/**
 * Format date to Vietnam timezone string
 * @param {Date} date - Date to format
 * @param {Object} options - Intl.DateTimeFormat options
 * @returns {string} Formatted date string
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
const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Parse khoảng thời gian và chuyển sang timezone Việt Nam
 * @param {string} startDateStr - Chuỗi ngày bắt đầu (YYYY-MM-DD)
 * @param {string} endDateStr - Chuỗi ngày kết thúc (YYYY-MM-DD)
 * @returns {Object} { startDate: Date, endDate: Date }
 */
function parseDateRange(startDateStr, endDateStr) {
  // Parse theo timezone VN (00:00:00 giờ VN)
  const startDate = moment.tz(startDateStr, TIMEZONE).startOf('day').toDate();
  
  // Parse theo timezone VN (23:59:59.999 giờ VN)
  const endDate = moment.tz(endDateStr, TIMEZONE).endOf('day').toDate();

  return { startDate, endDate };
}

/**
 * Lấy đầu ngày và cuối ngày theo timezone VN
 * @param {Date} date - Đối tượng Date
 * @returns {Object} { startOfDay: Date, endOfDay: Date }
 */
function getVietnamDayBounds(date) {
  const vnDate = moment(date).tz(TIMEZONE);
  return {
    startOfDay: vnDate.clone().startOf('day').toDate(),
    endOfDay: vnDate.clone().endOf('day').toDate()
  };
}

/**
 * Chuyển Date sang chuỗi theo timezone Việt Nam
 * @param {Date} date - Đối tượng Date
 * @param {string} format - Chuỗi định dạng moment
 * @returns {string} Chuỗi thời gian đã format
 */
function toVietnamTime(date, format = 'YYYY-MM-DD HH:mm:ss') {
  return moment(date).tz(TIMEZONE).format(format);
}

module.exports = {
  parseDateRange,
  getVietnamDayBounds,
  toVietnamTime,
  TIMEZONE
};

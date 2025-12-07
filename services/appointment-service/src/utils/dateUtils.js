const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Parse date range và chuyển sang timezone Việt Nam
 * @param {string} startDateStr - Start date string (YYYY-MM-DD)
 * @param {string} endDateStr - End date string (YYYY-MM-DD)
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
 * Get start and end of day theo timezone VN
 * @param {Date} date 
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
 * Convert Date to Vietnam timezone string
 * @param {Date} date 
 * @param {string} format - moment format string
 * @returns {string}
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

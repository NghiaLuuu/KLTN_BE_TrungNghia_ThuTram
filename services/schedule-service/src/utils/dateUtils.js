const moment = require('moment-timezone');

const TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Parse date range with Vietnam timezone
 * @param {string|Date} startDate - Start date
 * @param {string|Date} endDate - End date
 * @returns {Object} { startDate: Date, endDate: Date } in UTC
 */
function parseDateRange(startDate, endDate) {
  // Parse start date as Vietnam timezone 00:00:00
  const start = moment.tz(startDate, TIMEZONE).startOf('day').toDate();
  
  // Parse end date as Vietnam timezone 23:59:59.999
  const end = moment.tz(endDate, TIMEZONE).endOf('day').toDate();
  
  console.log('📅 [DateUtils] Parsed date range:', {
    input: { startDate, endDate },
    output: {
      startDate: start.toISOString(),
      endDate: end.toISOString()
    },
    timezone: TIMEZONE
  });
  
  return { startDate: start, endDate: end };
}

module.exports = {
  parseDateRange,
  TIMEZONE
};

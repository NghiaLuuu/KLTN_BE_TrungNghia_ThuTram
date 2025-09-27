const moment = require('moment-timezone');

const VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';

const getVietnamTime = (date = null) => {
  const baseDate = date ? moment(date) : moment();
  return baseDate.tz(VIETNAM_TIMEZONE).toDate();
};

const formatVietnamTime = (date, format = 'YYYY-MM-DD HH:mm:ss') => {
  return moment(date).tz(VIETNAM_TIMEZONE).format(format);
};

module.exports = {
  getVietnamTime,
  formatVietnamTime,
  VIETNAM_TIMEZONE
};
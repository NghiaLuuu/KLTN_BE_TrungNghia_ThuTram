const moment = require('moment');

class DateUtils {
  /**
   * Get start and end dates for a specific period
   * @param {string} period - 'day', 'week', 'month', 'quarter', 'year'
   * @param {Date} date - Reference date (default: now)
   * @returns {Object} { startDate, endDate }
   */
  static getPeriodRange(period, date = new Date()) {
    const momentDate = moment(date);
    let startDate, endDate;

    switch (period) {
      case 'day':
        startDate = momentDate.clone().startOf('day').toDate();
        endDate = momentDate.clone().endOf('day').toDate();
        break;
      case 'week':
        startDate = momentDate.clone().startOf('week').toDate();
        endDate = momentDate.clone().endOf('week').toDate();
        break;
      case 'month':
        startDate = momentDate.clone().startOf('month').toDate();
        endDate = momentDate.clone().endOf('month').toDate();
        break;
      case 'quarter':
        startDate = momentDate.clone().startOf('quarter').toDate();
        endDate = momentDate.clone().endOf('quarter').toDate();
        break;
      case 'year':
        startDate = momentDate.clone().startOf('year').toDate();
        endDate = momentDate.clone().endOf('year').toDate();
        break;
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    return { startDate, endDate };
  }

  /**
   * Get previous period dates for comparison
   */
  static getPreviousPeriodRange(period, date = new Date()) {
    const momentDate = moment(date);
    let prevDate;

    switch (period) {
      case 'day':
        prevDate = momentDate.clone().subtract(1, 'day');
        break;
      case 'week':
        prevDate = momentDate.clone().subtract(1, 'week');
        break;
      case 'month':
        prevDate = momentDate.clone().subtract(1, 'month');
        break;
      case 'quarter':
        prevDate = momentDate.clone().subtract(1, 'quarter');
        break;
      case 'year':
        prevDate = momentDate.clone().subtract(1, 'year');
        break;
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    return this.getPeriodRange(period, prevDate.toDate());
  }

  /**
   * Generate date series for a period
   */
  static generateDateSeries(startDate, endDate, interval = 'day') {
    const dates = [];
    let current = moment(startDate);
    const end = moment(endDate);

    while (current.isSameOrBefore(end)) {
      dates.push(current.clone().toDate());
      current.add(1, interval);
    }

    return dates;
  }

  /**
   * Format date for Vietnamese timezone
   */
  static formatVNDate(date, format = 'YYYY-MM-DD') {
    return moment(date).utcOffset('+07:00').format(format);
  }

  /**
   * Get Vietnam current time
   */
  static getVNNow() {
    return moment().utcOffset('+07:00').toDate();
  }

  /**
   * Parse date range from query params
   */
  static parseDateRange(startDate, endDate, defaultPeriod = 'month') {
    if (startDate && endDate) {
      return {
        startDate: new Date(startDate),
        endDate: new Date(endDate)
      };
    }

    return this.getPeriodRange(defaultPeriod);
  }
}

module.exports = DateUtils;
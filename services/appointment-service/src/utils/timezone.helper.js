/**
 * Timezone Helper Utilities
 * Handle timezone conversions for Vietnam (UTC+7)
 */

/**
 * Parse a date string (YYYY-MM-DD) as midnight in Vietnam timezone
 * Then return as UTC Date object for MongoDB storage
 * 
 * Example:
 * Input: "2025-11-27"
 * Output: Date object representing 2025-11-26T17:00:00.000Z (which is 2025-11-27 00:00 VN time)
 * 
 * @param {String|Date} dateInput - Date string in YYYY-MM-DD format or Date object
 * @returns {Date} UTC Date object
 */
function parseVNDate(dateInput) {
  if (!dateInput) return null;
  
  // If already a Date object, return as-is
  if (dateInput instanceof Date) {
    return dateInput;
  }
  
  // Parse string date
  const dateStr = String(dateInput);
  
  // If it's ISO format with timezone info, parse directly
  if (dateStr.includes('T') || dateStr.includes('+')) {
    return new Date(dateStr);
  }
  
  // For YYYY-MM-DD format, add VN timezone offset
  const [year, month, day] = dateStr.split('-');
  
  if (!year || !month || !day) {
    throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD`);
  }
  
  // Create date at midnight Vietnam time (UTC+7)
  const vnDate = new Date(`${year}-${month}-${day}T00:00:00+07:00`);
  
  return vnDate;
}

/**
 * Get current date/time in Vietnam timezone
 * @returns {Date} Current time adjusted to VN timezone
 */
function getNowVN() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
}

/**
 * Get start of day (00:00:00) in Vietnam timezone, returned as UTC
 * @param {Date} date - Optional date (defaults to today)
 * @returns {Date} Start of day in VN timezone (as UTC)
 */
function getStartOfDayVN(date = null) {
  const targetDate = date || new Date();
  
  // Get VN date/time components
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
  
  // Create midnight VN time: YYYY-MM-DDT00:00:00+07:00
  return new Date(`${year}-${month}-${day}T00:00:00+07:00`);
}

/**
 * Get end of day (23:59:59.999) in Vietnam timezone, returned as UTC
 * @param {Date} date - Optional date (defaults to today)
 * @returns {Date} End of day in VN timezone (as UTC)
 */
function getEndOfDayVN(date = null) {
  const targetDate = date || new Date();
  
  // Get VN date/time components
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
  
  // Create end of day VN time: YYYY-MM-DDT23:59:59.999+07:00
  return new Date(`${year}-${month}-${day}T23:59:59.999+07:00`);
}

/**
 * Format date to YYYY-MM-DD in Vietnam timezone
 * @param {Date} date - Date object
 * @returns {String} Date string in YYYY-MM-DD format
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

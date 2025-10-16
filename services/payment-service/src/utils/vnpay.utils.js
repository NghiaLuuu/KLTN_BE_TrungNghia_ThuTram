const crypto = require('crypto');
const querystring = require('qs');

/**
 * Sắp xếp object theo key alphabetically
 */
function sortObject(obj) {
  const sorted = {};
  const keys = Object.keys(obj).sort();
  keys.forEach(key => {
    sorted[key] = obj[key];
  });
  return sorted;
}

/**
 * Tạo VNPay secure hash (HMAC SHA512)
 * @param {object} vnpParams - VNPay parameters (đã sorted)
 * @param {string} secretKey - VNPay Hash Secret
 * @returns {string} secure hash
 */
function createVNPaySecureHash(vnpParams, secretKey) {
  // CRITICAL: Must encode for VNPay signature validation
  // Default behavior encodes special characters (: / ? etc.)
  const signData = querystring.stringify(vnpParams);
  console.log('🔵 [VNPay Hash] Sign data:', signData);
  console.log('🔵 [VNPay Hash] Secret key:', secretKey);
  
  const hmac = crypto.createHmac('sha512', secretKey);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  
  console.log('🔵 [VNPay Hash] Generated hash:', signed);
  return signed;
}

/**
 * Verify VNPay callback signature
 * @param {object} vnpParams - Query params từ VNPay callback
 * @param {string} secretKey - VNPay Hash Secret
 * @returns {boolean} valid hay không
 */
function verifyVNPayCallback(vnpParams, secretKey) {
  const secureHash = vnpParams['vnp_SecureHash'];
  
  // Xóa các field không dùng để verify
  delete vnpParams['vnp_SecureHash'];
  delete vnpParams['vnp_SecureHashType'];
  
  // Sort và tạo hash
  const sortedParams = sortObject(vnpParams);
  const calculatedHash = createVNPaySecureHash(sortedParams, secretKey);
  
  return secureHash === calculatedHash;
}

/**
 * Format date cho VNPay (yyyyMMddHHmmss)
 */
function formatVNPayDate(date = new Date()) {
  const pad = (n) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}${hour}${minute}${second}`;
}

module.exports = {
  sortObject,
  createVNPaySecureHash,
  verifyVNPayCallback,
  formatVNPayDate
};

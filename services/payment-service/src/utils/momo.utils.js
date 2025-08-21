const crypto = require('crypto');

/**
 * Tạo HMAC SHA256 signature cho MoMo
 * @param {object} params - tất cả các tham số cần ký, key sẽ được sắp xếp theo alphabet
 * @param {string} secretKey - MoMo secret key
 * @returns {string} signature hex
 */
function generateMoMoSignature(params, secretKey) {
  // 1️⃣ Sắp xếp key alphabetically
  const sortedKeys = Object.keys(params).sort();

  // 2️⃣ Tạo chuỗi rawSignature: key=value&key=value...
  const rawSignature = sortedKeys
    .map(key => `${key}=${params[key] != null ? String(params[key]) : ''}`)
    .join('&');

  // 3️⃣ HMAC SHA256
  const signature = crypto.createHmac('sha256', secretKey.trim())
                          .update(rawSignature, 'utf8')
                          .digest('hex');



  return signature;
}

module.exports = { generateMoMoSignature };

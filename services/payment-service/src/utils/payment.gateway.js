// momo.service.js
const axios = require('axios');
const { generateMoMoSignature } = require('./momo.utils');

/**
 * Tạo MoMo payment URL / QR code
 * @param {string} orderId
 * @param {number} amount
 * @param {string} extraData
 * @param {string} paymentMethod - 'redirect' | 'qr'
 * @returns {object} { payUrl, qrCodeUrl, requestId, orderId }
 */
async function createMoMoPayment(orderId, amount, extraData = '', paymentMethod = 'redirect') {
  const partnerCode = process.env.MOMO_PARTNER_CODE;
  const accessKey = process.env.MOMO_ACCESS_KEY;
  const secretKey = process.env.MOMO_SECRET_KEY;
  const returnUrl = process.env.MOMO_RETURN_URL;
  const notifyUrl = process.env.MOMO_NOTIFY_URL;

  const requestId = `req_${Date.now()}`;
  const orderInfo = `AppointmentPayment${orderId}`;
  const requestType = 'payWithMethod';

  // 1️⃣ Chuẩn bị params theo MoMo API
  const params = {
    accessKey,
    amount,
    extraData,
    ipnUrl: notifyUrl,
    orderId,
    orderInfo,
    partnerCode,
    redirectUrl: returnUrl,
    requestId,
    requestType
  };

  // 2️⃣ Tạo signature HMAC SHA256
  const signature = generateMoMoSignature(params, secretKey);

  // 3️⃣ Request body
  const requestBody = {
    ...params,
    signature,
    amount: amount.toString() // MoMo yêu cầu amount là string
  };

  try {
    const response = await axios.post('https://test-payment.momo.vn/v2/gateway/api/create', requestBody);

    return {
      payUrl: paymentMethod === 'redirect' ? response.data.payUrl : undefined,
      qrCodeUrl: paymentMethod === 'qr' ? response.data.qrCodeUrl : undefined,
      requestId,
      orderId
    };
  } catch (err) {
    console.error('❌ MoMo create payment error:', err.response?.data || err.message);
    throw new Error('Failed to create MoMo payment');
  }
}

module.exports = { createMoMoPayment };

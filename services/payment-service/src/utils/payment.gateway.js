// payment.gateway.js - VNPay Integration Only
const querystring = require('qs');
const { sortObject, createVNPaySecureHash, formatVNPayDate } = require('./vnpay.utils');

/**
 * Tạo VNPay payment URL (sandbox)
 * @param {string} orderId - Mã đơn hàng
 * @param {number} amount - Số tiền (VND)
 * @param {string} orderInfo - Thông tin đơn hàng
 * @param {string} ipAddr - IP address của khách hàng
 * @param {string} bankCode - Mã ngân hàng (optional)
 * @param {string} locale - Ngôn ngữ: 'vn' hoặc 'en' (default: 'vn')
 * @returns {string} VNPay payment URL
 */
function createVNPayPayment(orderId, amount, orderInfo, ipAddr, bankCode = '', locale = 'vn') {
  // VNPay sandbox credentials
  const tmnCode = process.env.VNPAY_TMN_CODE || 'KZ1MPDRW';
  const secretKey = process.env.VNPAY_HASH_SECRET || 'LGJNHZSLMX362UGJOKERT14VR4MF3JBD';
  const vnpUrl = process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
  const returnUrl = process.env.VNPAY_RETURN_URL || 'http://localhost:3007/api/payments/return/vnpay';

  const createDate = formatVNPayDate(new Date());
  const currCode = 'VND';

  // NO SPACES - VNPay may have issues with spaces even with encode:false
  const sanitizedOrderInfo = `ThanhToanGD:${orderId}`;

  // Build VNPay params
  let vnp_Params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: tmnCode,
    vnp_Locale: locale,
    vnp_CurrCode: currCode,
    vnp_TxnRef: orderId,
    vnp_OrderInfo: sanitizedOrderInfo,
    vnp_OrderType: 'other',
    vnp_Amount: amount * 100,
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: ipAddr,
    vnp_CreateDate: createDate
  };

  // Add bank code if provided
  if (bankCode && bankCode !== '') {
    vnp_Params.vnp_BankCode = bankCode;
  }

  // Sort params
  vnp_Params = sortObject(vnp_Params);

  // Create secure hash
  const secureHash = createVNPaySecureHash(vnp_Params, secretKey);
  vnp_Params['vnp_SecureHash'] = secureHash;

  // Build final URL
  const paymentUrl = vnpUrl + '?' + querystring.stringify(vnp_Params, { encode: false });

  return paymentUrl;
}

module.exports = {
  createVNPayPayment
};


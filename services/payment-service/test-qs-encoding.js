// Test qs encoding behavior
const querystring = require('qs');

const testParams = {
  vnp_OrderInfo: 'ThanhToanGD:RSV1760613823371',
  vnp_ReturnUrl: 'http://localhost:3007/api/payments/return/vnpay',
  vnp_IpAddr: '127.0.0.1'
};

console.log('Test params:', testParams);
console.log('\n--- With encode: false ---');
const stringFalse = querystring.stringify(testParams, { encode: false });
console.log(stringFalse);

console.log('\n--- With encode: true (default) ---');
const stringTrue = querystring.stringify(testParams, { encode: true });
console.log(stringTrue);

console.log('\n--- Without options ---');
const stringDefault = querystring.stringify(testParams);
console.log(stringDefault);

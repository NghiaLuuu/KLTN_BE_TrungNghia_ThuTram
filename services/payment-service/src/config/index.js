require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3007,
  MONGO_URI: process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/KLTN',
  ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET || 'default-access-secret',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'default-refresh-secret',
  REDIS_URL: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  // Cấu hình Cổng thanh toán VNPay
  VNPAY_TMN_CODE: process.env.VNPAY_TMN_CODE || 'KZ1MPDRW',
  VNPAY_HASH_SECRET: process.env.VNPAY_HASH_SECRET || 'LGJNHZSLMX362UGJOKERT14VR4MF3JBD',
  VNPAY_URL: process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  VNPAY_RETURN_URL: process.env.VNPAY_RETURN_URL || 'http://localhost:3007/api/payments/return/vnpay',
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  ADMIN_URL: process.env.ADMIN_URL || 'http://localhost:3001',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
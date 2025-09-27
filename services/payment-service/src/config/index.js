require('dotenv').config();

module.exports = {
  PORT: process.env.PORT || 3007,
  MONGO_URI: process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/KLTN',
  ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET || 'default-access-secret',
  REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || 'default-refresh-secret',
  REDIS_URL: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`,
  REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  MOMO_PARTNER_CODE: process.env.MOMO_PARTNER_CODE || '',
  MOMO_ACCESS_KEY: process.env.MOMO_ACCESS_KEY || '',
  MOMO_SECRET_KEY: process.env.MOMO_SECRET_KEY || '',
  MOMO_RETURN_URL: process.env.MOMO_RETURN_URL || '',
  MOMO_NOTIFY_URL: process.env.MOMO_NOTIFY_URL || '',
  ZALOPAY_APP_ID: process.env.ZALOPAY_APP_ID || '',
  ZALOPAY_KEY1: process.env.ZALOPAY_KEY1 || '',
  ZALOPAY_KEY2: process.env.ZALOPAY_KEY2 || '',
  VNPAY_TMN_CODE: process.env.VNPAY_TMN_CODE || '',
  VNPAY_HASH_SECRET: process.env.VNPAY_HASH_SECRET || '',
  VNPAY_URL: process.env.VNPAY_URL || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  ADMIN_URL: process.env.ADMIN_URL || 'http://localhost:3001',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
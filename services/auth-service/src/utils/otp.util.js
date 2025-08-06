// utils/otp.util.js
exports.generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString(); // mã 6 số
};

exports.isOtpExpired = (expiresAt) => {
  return Date.now() > expiresAt;
};

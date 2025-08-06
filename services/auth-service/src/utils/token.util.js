const jwt = require('jsonwebtoken');

exports.generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: '15m',
  });
};

exports.generateRefreshToken = (userId) => {
  return jwt.sign({ userId }, process.env.REFRESH_TOKEN_SECRET, {
    expiresIn: '7d',
  });
};

exports.isTokenExpired = (token) => {
  try {
    const decoded = jwt.decode(token);
    return decoded.exp * 1000 < Date.now(); // so sánh với thời gian hiện tại
  } catch (err) {
    return true;
  }
};

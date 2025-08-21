const jwt = require('jsonwebtoken');

exports.generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role, 
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: '1d',
    }
  );
};


exports.generateRefreshToken = (user) => {
  return jwt.sign(
    {
      userId: user._id,
      role: user.role, // ✅ Thêm role nếu cần dùng cho refresh token
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: '7d',
    }
  );
};


exports.isTokenExpired = (token) => {
  try {
    const decoded = jwt.decode(token);
    return decoded.exp * 1000 < Date.now(); // so sánh với thời gian hiện tại
  } catch (err) {
    return true;
  }
};

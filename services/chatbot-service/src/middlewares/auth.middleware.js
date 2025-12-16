/**
 * Middleware xác thực
 * Xác minh JWT token từ header của request
 */
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  try {
    // Lấy token từ header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Không có token'
      });
    }

    const token = authHeader.substring(7); // Loại bỏ tiền tố 'Bearer '

    // Xác minh token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    
    // Thêm thông tin user vào request
    req.user = {
      userId: decoded.userId || decoded.id,
      role: decoded.role,
      email: decoded.email
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token đã hết hạn'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Lỗi xác thực'
    });
  }
};

module.exports = authMiddleware;

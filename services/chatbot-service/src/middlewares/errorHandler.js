/**
 * Middleware xử lý lỗi
 * Xử lý lỗi toàn cục cho ứng dụng
 */

const errorHandler = (err, req, res, next) => {
  console.error('❌ Lỗi:', err);

  // Lỗi validation Mongoose
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Lỗi validation',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }

  // Lỗi cast Mongoose (ObjectId không hợp lệ)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Định dạng ID không hợp lệ'
    });
  }

  // Lỗi khóa trùng lặp MongoDB
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Dữ liệu đã tồn tại'
    });
  }

  // Lỗi JWT
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token đã hết hạn'
    });
  }

  // Lỗi mặc định
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Lỗi máy chủ nội bộ',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = errorHandler;

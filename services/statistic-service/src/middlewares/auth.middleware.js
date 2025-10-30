const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Token không được cung cấp'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: 'Token không hợp lệ hoặc đã hết hạn'
    });
  }
};

const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Chưa xác thực người dùng'
      });
    }

    // ✅ Support both activeRole (new token structure) and role (old structure)
    const userRole = req.user.activeRole || req.user.role;

    if (roles.length > 0 && !roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Không có quyền truy cập'
      });
    }

    next();
  };
};

// Middleware for admin/manager only statistics
const requireAdminOrManager = authorize(['admin', 'manager']);

// Middleware for statistics that dentists can also see
const requireStaff = authorize(['admin', 'manager', 'dentist', 'receptionist']);

module.exports = {
  authenticate,
  authorize,
  requireAdminOrManager,
  requireStaff
};
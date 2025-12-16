const jwt = require('jsonwebtoken');

/**
 * Middleware xác thực - Kiểm tra và giải mã JWT token
 */
const authenticate = (req, res, next) => {
  // console.log('🔍 [Auth Middleware] Headers:', {
  //   authorization: req.headers.authorization ? 'Có' : 'Thiếu',
  //   authValue: req.headers.authorization
  // });
  
  const authHeader = req.headers.authorization;
  // if (!authHeader || !authHeader.startsWith("Bearer ")) {
  //   console.log('❌ [Auth Middleware] Không có token');
  //   return res.status(401).json({ message: 'Không có token' });
  // }

  const token = authHeader.split(" ")[1];
  // console.log('🔍 [Auth Middleware] Token:', token.substring(0, 20) + '...');

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    // console.log('✅ [Auth Middleware] Token hợp lệ, user:', decoded.userId, 'activeRole:', decoded.activeRole);
    req.user = decoded; // Lưu userId, role,... tùy payload bạn đã ký
    next();
  } catch (err) {
    // console.log('❌ [Auth Middleware] Xác thực token thất bại:', err.message);
    return res.status(403).json({ message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
};

/**
 * Middleware phân quyền - Kiểm tra vai trò người dùng
 * @param {Array} roles - Danh sách các vai trò được phép
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Không có thông tin xác thực' 
      });
    }

    // ✅ Kiểm tra nếu user có BẤT KỲ vai trò nào trong danh sách (hỗ trợ nhiều vai trò)
    if (roles.length > 0) {
      // ✅ Hỗ trợ cấu trúc token mới với activeRole (một vai trò cho mỗi phiên)
      const userRole = req.user.activeRole || req.user.role;
      const userRoles = req.user.roles || [userRole]; // Fallback về mảng roles hoặc single role
      const hasPermission = roles.some(role => userRoles.includes(role)) || roles.includes(userRole);
      
      if (!hasPermission) {
        return res.status(403).json({ 
          success: false,
          message: 'Từ chối quyền: bạn không có đủ quyền để thực hiện thao tác này' 
        });
      }
    }

    next();
  };
};

module.exports = { authenticate, authorize };

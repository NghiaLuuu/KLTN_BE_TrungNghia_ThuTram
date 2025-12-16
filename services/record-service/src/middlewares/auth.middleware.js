const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  // ✅ Cho phép các cuộc gọi nội bộ giữa các dịch vụ
  if (req.headers['x-internal-call'] === 'true') {
    req.user = {
      userId: 'system',
      role: 'system',
      roles: ['system'],
      activeRole: 'system',
      isInternal: true
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // Lưu userId, role,... tùy payload bạn đã ký
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Không có thông tin xác thực' 
      });
    }

    // ✅ Cho phép các cuộc gọi nội bộ hệ thống
    if (req.user.isInternal === true && req.user.role === 'system') {
      return next();
    }

    // ✅ Kiểm tra xem user có BẤT KỲ vai trò yêu cầu nào không (hỗ trợ nhiều vai trò)
    if (roles.length > 0) {
      // ✅ Hỗ trợ cấu trúc token mới với activeRole (mỗi phiên một vai trò)
      const userRole = req.user.activeRole || req.user.role;
      const userRoles = req.user.roles || [userRole]; // Dự phòng về mảng roles hoặc vai trò đơn
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

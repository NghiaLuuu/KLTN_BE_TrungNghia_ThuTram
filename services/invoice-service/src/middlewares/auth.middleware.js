const jwt = require('jsonwebtoken');

class AuthMiddleware {
  // Middleware xác thực
  authenticate(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          success: false,
          message: 'Token không được cung cấp'
        });
      }

      const token = authHeader.split(" ")[1];

      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      req.user = decoded; // Chứa id, email, role/activeRole, v.v.
      
      console.log(`🔐 Người dùng đã xác thực: ${decoded.email || decoded.userId} (${decoded.activeRole || decoded.role})`);
      next();
    } catch (error) {
      console.error('❌ Authentication error:', error.message);
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token đã hết hạn'
        });
      }
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(403).json({
          success: false,
          message: 'Token không hợp lệ'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Lỗi xác thực'
      });
    }
  }

  // Middleware phân quyền - kiểm tra vai trò người dùng
  authorize(allowedRoles = []) {
    return (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Chưa xác thực người dùng'
          });
        }

        // ✅ Hỗ trợ cả activeRole (cấu trúc token mới) và role (cấu trúc cũ)
        const userRole = req.user.activeRole || req.user.role;

        if (!allowedRoles.includes(userRole)) {
          console.warn(`⚠️ Truy cập bị từ chối cho vai trò: ${userRole}, được phép: ${allowedRoles.join(', ')}`);
          return res.status(403).json({
            success: false,
            message: 'Không có quyền truy cập'
          });
        }

        console.log(`✅ Truy cập được cấp cho vai trò: ${userRole}`);
        next();
      } catch (error) {
        console.error('❌ Authorization error:', error.message);
        return res.status(500).json({
          success: false,
          message: 'Lỗi phân quyền'
        });
      }
    };
  }

  // Kiểm tra xem người dùng có sở hữu tài nguyên hoặc có quyền admin không
  authorizeOwnerOrAdmin(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Chưa xác thực người dùng'
        });
      }

      const userId = req.user.id;
      // ✅ Hỗ trợ cả activeRole (cấu trúc token mới) và role (cấu trúc cũ)
      const userRole = req.user.activeRole || req.user.role;
      const resourceUserId = req.params.userId || req.body.userId || req.query.userId;

      // Admin và manager có thể truy cập bất kỳ tài nguyên nào
      if (['admin', 'manager'].includes(userRole)) {
        return next();
      }

      // Người dùng chỉ có thể truy cập tài nguyên của chính mình
      if (userId === resourceUserId) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'Chỉ có thể truy cập tài nguyên của chính mình'
      });
    } catch (error) {
      console.error('❌ Owner authorization error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Lỗi phân quyền'
      });
    }
  }

  // Xác thực tùy chọn - tiếp tục ngay cả khi không có token
  optionalAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        req.user = null;
        return next();
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
      req.user = decoded;
      
      console.log(`🔐 Xác thực tùy chọn: ${decoded.email || decoded.userId} (${decoded.activeRole || decoded.role})`);
      next();
    } catch (error) {
      // Tiếp tục không cần xác thực nếu token không hợp lệ
      req.user = null;
      console.warn(`⚠️ Xác thực tùy chọn thất bại: ${error.message}`);
      next();
    }
  }

  // Kiểm tra xem người dùng có quyền cụ thể cho các thao tác hóa đơn không
  checkInvoicePermission(action) {
    return (req, res, next) => {
      try {
        if (!req.user) {
          return res.status(401).json({
            success: false,
            message: 'Chưa xác thực người dùng'
          });
        }

        // ✅ Support both activeRole (new token structure) and role (old structure)
        const userRole = req.user.activeRole || req.user.role;
        const permissions = {
          create: ['admin', 'manager', 'dentist', 'receptionist'],
          read: ['admin', 'manager', 'dentist', 'receptionist', 'patient'],
          update: ['admin', 'manager', 'dentist', 'receptionist'],
          delete: ['admin', 'manager'],
          finalize: ['admin', 'manager', 'dentist', 'receptionist'],
          cancel: ['admin', 'manager'],
          statistics: ['admin', 'manager', 'dentist']
        };

        if (!permissions[action] || !permissions[action].includes(userRole)) {
          return res.status(403).json({
            success: false,
            message: `Không có quyền ${action} hóa đơn`
          });
        }

        next();
      } catch (error) {
        console.error('❌ Invoice permission error:', error.message);
        return res.status(500).json({
          success: false,
          message: 'Lỗi kiểm tra quyền'
        });
      }
    };
  }
}

const authMiddleware = new AuthMiddleware();

module.exports = authMiddleware;

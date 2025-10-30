const jwt = require('jsonwebtoken');

class AuthMiddleware {
  // Authentication middleware
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
      req.user = decoded; // Contains id, email, role/activeRole, etc.
      
      console.log(`🔐 User authenticated: ${decoded.email || decoded.userId} (${decoded.activeRole || decoded.role})`);
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

  // Authorization middleware - check user roles
  authorize(allowedRoles = []) {
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

        if (!allowedRoles.includes(userRole)) {
          console.warn(`⚠️ Access denied for role: ${userRole}, allowed: ${allowedRoles.join(', ')}`);
          return res.status(403).json({
            success: false,
            message: 'Không có quyền truy cập'
          });
        }

        console.log(`✅ Access granted for role: ${userRole}`);
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

  // Check if user owns the resource or has admin privileges
  authorizeOwnerOrAdmin(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Chưa xác thực người dùng'
        });
      }

      const userId = req.user.id;
      // ✅ Support both activeRole (new token structure) and role (old structure)
      const userRole = req.user.activeRole || req.user.role;
      const resourceUserId = req.params.userId || req.body.userId || req.query.userId;

      // Admin and manager can access any resource
      if (['admin', 'manager'].includes(userRole)) {
        return next();
      }

      // User can only access their own resources
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

  // Optional authentication - continue even without token
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
      
      console.log(`🔐 Optional auth: ${decoded.email || decoded.userId} (${decoded.activeRole || decoded.role})`);
      next();
    } catch (error) {
      // Continue without authentication if token is invalid
      req.user = null;
      console.warn(`⚠️ Optional auth failed: ${error.message}`);
      next();
    }
  }

  // Check if user has specific permission for invoice operations
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

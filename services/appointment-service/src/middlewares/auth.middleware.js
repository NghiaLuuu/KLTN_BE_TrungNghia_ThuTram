const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  // console.log('🔍 [Auth Middleware] Headers:', {
  //   authorization: req.headers.authorization ? 'Present' : 'Missing',
  //   authValue: req.headers.authorization
  // });
  
  const authHeader = req.headers.authorization;
  // if (!authHeader || !authHeader.startsWith("Bearer ")) {
  //   console.log('❌ [Auth Middleware] No token provided');
  //   return res.status(401).json({ message: 'No token provided' });
  // }

  const token = authHeader.split(" ")[1];
  // console.log('🔍 [Auth Middleware] Token:', token.substring(0, 20) + '...');

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    // console.log('✅ [Auth Middleware] Token valid, user:', decoded.userId, 'activeRole:', decoded.activeRole);
    req.user = decoded; // Lưu userId, role,... tùy payload bạn đã ký
    next();
  } catch (err) {
    // console.log('❌ [Auth Middleware] Token verification failed:', err.message);
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

    // ✅ Check if user has ANY of the required roles (support multiple roles)
    if (roles.length > 0) {
      // ✅ Support new token structure with activeRole (single role per session)
      const userRole = req.user.activeRole || req.user.role;
      const userRoles = req.user.roles || [userRole]; // Fallback to roles array or single role
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

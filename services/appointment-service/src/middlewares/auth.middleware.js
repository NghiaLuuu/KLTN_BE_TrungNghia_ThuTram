const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
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

    // ✅ Check if user has ANY of the required roles (support multiple roles)
    if (roles.length > 0) {
      const userRoles = req.user.roles || [req.user.role]; // Support both roles array and legacy role string
      const hasPermission = roles.some(role => userRoles.includes(role));
      
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

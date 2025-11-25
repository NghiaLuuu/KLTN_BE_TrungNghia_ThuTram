const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer "))
    return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    req.user = decoded; // Lưu userId, role,... tùy payload bạn đã ký
    
    // ✅ Check X-Selected-Role header to support role switching
    const selectedRole = req.headers['x-selected-role'];
    if (selectedRole) {
      // Validate that selected role exists in user's roles array
      const userRoles = decoded.roles || [decoded.role];
      if (userRoles.includes(selectedRole)) {
        req.user.activeRole = selectedRole;
        console.log(`🔄 [Auth Middleware] Override activeRole: ${decoded.activeRole} → ${selectedRole}`);
      } else {
        console.warn(`⚠️ [Auth Middleware] Invalid selectedRole "${selectedRole}" not in user roles:`, userRoles);
      }
    }
    
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;

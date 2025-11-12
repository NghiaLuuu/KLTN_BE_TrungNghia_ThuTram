const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  // ✅ Allow internal service-to-service calls
  if (req.headers['x-internal-call'] === 'true') {
    // Set a system user for internal calls
    req.user = {
      userId: 'system',
      role: 'system',
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

module.exports = authMiddleware;

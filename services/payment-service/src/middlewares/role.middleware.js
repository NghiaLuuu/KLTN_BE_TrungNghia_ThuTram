const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Người dùng chưa được xác thực'
        });
      }

      // ✅ Allow internal service calls to bypass role checks
      if (user.isInternal === true && user.role === 'system') {
        return next();
      }

      // ✅ Support both activeRole (new token structure) and role (old structure)
      const userRole = user.activeRole || user.role;

      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Không có quyền truy cập. Yêu cầu vai trò: ${allowedRoles.join(', ')}`
        });
      }

      // Check if user is accessing their own patient data
      if (userRole === 'patient' && req.params.patientId) {
        if (req.params.patientId !== user.userId) {
          return res.status(403).json({
            success: false,
            message: 'Bạn chỉ có thể xem thanh toán của chính mình'
          });
        }
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Lỗi kiểm tra quyền truy cập',
        error: error.message
      });
    }
  };
};

module.exports = roleMiddleware;
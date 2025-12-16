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

      // ✅ Cho phép các cuộc gọi service nội bộ bỏ qua kiểm tra vai trò
      if (user.isInternal === true && user.role === 'system') {
        return next();
      }

      // ✅ Hỗ trợ cả activeRole (cấu trúc token mới) và role (cấu trúc cũ)
      const userRole = user.activeRole || user.role;

      if (!userRole || !allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: `Không có quyền truy cập. Yêu cầu vai trò: ${allowedRoles.join(', ')}`
        });
      }

      // Kiểm tra xem người dùng có đang truy cập dữ liệu bệnh nhân của chính họ không
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
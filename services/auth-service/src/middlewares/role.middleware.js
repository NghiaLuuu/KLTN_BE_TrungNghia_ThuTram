/**
 * 🛡️ Role-based Authorization Middleware
 * Kiểm tra quyền truy cập dựa trên role của user
 */

// ✅ Middleware kiểm tra role có trong danh sách cho phép
const authorize = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Token không hợp lệ hoặc chưa đăng nhập'
      });
    }

    const userRole = req.user.role;
    
    // Nếu không có giới hạn role hoặc user role được cho phép
    if (allowedRoles.length === 0 || allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Quyền truy cập bị từ chối. Cần role: ${allowedRoles.join(' hoặc ')}`
    });
  };
};

// ✅ Middleware chỉ cho admin và manager
const adminOrManager = authorize(['admin', 'manager']);

// ✅ Middleware chỉ cho admin
const adminOnly = authorize(['admin']);

// ✅ Middleware chỉ cho admin và manager xem staff
const canViewStaff = authorize(['admin', 'manager']);

// ✅ Middleware chỉ cho admin và manager xem patients
const canViewPatients = authorize(['admin', 'manager']);

// ✅ Middleware cho update user permissions (sẽ check logic phức tạp hơn ở controller)
const canUpdateUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Token không hợp lệ hoặc chưa đăng nhập'
    });
  }

  const userRole = req.user.role;
  const allowedRoles = ['admin', 'manager', 'patient']; // ✅ Chỉ admin, manager, patient được phép
  
  // Chỉ admin, manager, patient có thể gọi endpoint này 
  // (logic phức tạp hơn sẽ được check ở service layer)
  if (allowedRoles.includes(userRole)) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: `Quyền truy cập bị từ chối. Role '${userRole}' không có quyền cập nhật thông tin người dùng. Chỉ admin, manager, patient được phép.`
  });
};

module.exports = {
  authorize,
  adminOnly,
  adminOrManager,
  canViewStaff,
  canViewPatients,
  canUpdateUser
};
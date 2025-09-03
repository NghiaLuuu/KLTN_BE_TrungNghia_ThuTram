const userService = require('../services/user.service');

exports.getProfile = async (req, res) => {
  try {
    const user = await userService.getProfile(req.user.userId);
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi máy chủ, không thể lấy thông tin người dùng' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const updated = await userService.updateUser(req.user.userId, req.body);
    return res.status(200).json({ message: 'Cập nhật thông tin thành công', user: updated });
  } catch (err) {
    return res.status(500).json({ message: 'Lỗi máy chủ, không thể cập nhật thông tin' });
  }
};

// ✅ Lấy danh sách người dùng theo role + phân trang
exports.getUsersByRole = async (req, res) => {
  try {
    const currentUserRole = req.user.role;
    if (!['admin', 'manager'].includes(currentUserRole)) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập chức năng này' });
    }

    const { role, page = 1, limit = 10 } = req.query;
    if (!role) {
      return res.status(400).json({ message: 'Thiếu tham số role' });
    }

    const data = await userService.getUsersByRole(role, page, limit);
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi máy chủ, không thể lấy danh sách người dùng' });
  }
};

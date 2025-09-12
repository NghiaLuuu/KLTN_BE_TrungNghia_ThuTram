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


exports.getAllStaff = async (req, res) => {
  try {
    const currentUserRole = req.user.role;
    if (!['admin', 'manager'].includes(currentUserRole)) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập chức năng này' });
    }

    const { page = 1, limit = 10 } = req.query;

    const data = await userService.getAllStaff(page, limit);
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi máy chủ, không thể lấy danh sách nhân viên' });
  }
};

// PUT /update/:id
exports.updateProfileByAdmin = async (req, res) => {
  try {
    const currentUser = req.user; // user hiện tại từ middleware auth
    const userId = req.params.id; // user cần cập nhật
    const updated = await userService.updateProfileByAdmin(currentUser, userId, req.body);

    return res.status(200).json({
      message: 'Cập nhật thông tin thành công',
      user: updated
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

// GET /users/:id
exports.getUserById = async (req, res) => {
  try {
    const currentUser = req.user; // user hiện tại từ auth middleware
    const userId = req.params.id;
    const user = await userService.getUserById(currentUser, userId);

    return res.status(200).json({ user });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
};

exports.searchStaff = async (req, res) => {
  try {
    const currentUserRole = req.user.role;
    if (!['admin', 'manager'].includes(currentUserRole)) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập chức năng này' });
    }

    const { fullName, email, phone, role, gender, type, page = 1, limit = 10 } = req.query;

    const data = await userService.searchStaff({ fullName, email, phone, role, gender, type }, page, limit);
    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Lỗi máy chủ, không thể tìm kiếm nhân viên' });
  }
};

exports.getStaffByIds = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Thiếu danh sách ids" });
    }

    const result = await userService.getStaffByIds(ids);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.params.id;
    const file = req.file;

    const updatedUser = await userService.updateUserAvatar(userId, file);

    res.json({
      message: 'Cập nhật avatar thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};


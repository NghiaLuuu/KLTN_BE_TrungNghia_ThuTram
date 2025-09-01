const userService = require('../services/user.service');

exports.getProfile = async (req, res) => {
  try {
    const user = await userService.getProfile(req.user.userId);
    return res.status(200).json(user);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const updated = await userService.updateUser(req.user.userId, req.body);
    return res.status(200).json(updated);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getUsersByRole = async (req, res) => {
  try {
    const currentUserRole = req.user.role;
    if (!['admin', 'manager'].includes(currentUserRole)) {
      return res.status(403).json({ message: 'Forbidden: Access denied' });
    }

    const { role } = req.query; // role lấy từ query string
    if (!role) {
      return res.status(400).json({ message: 'Role is required' });
    }

    const users = await userService.getUsersByRole(role);
    return res.status(200).json(users);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};


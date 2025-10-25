const authService = require('../services/auth.service');

exports.register = async (req, res) => {
  try {
    const user = await authService.register(req.body);
    res.status(201).json({ message: 'Đăng ký người dùng thành công', user });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Đăng ký thất bại' });
  }
};

exports.login = async (req, res) => {
  try {
    const { login, password, role } = req.body; // 🆕 Thêm role (optional)
    const result = await authService.login({ login, password, role });
    res.status(200).json({ message: 'Đăng nhập thành công', ...result });
  } catch (err) {
    res.status(401).json({ message: err.message || 'Đăng nhập thất bại' });
  }
};


exports.logout = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ message: 'Thiếu refreshToken' });
    }

    await authService.logout(userId, refreshToken);
    res.status(200).json({ message: 'Đăng xuất thành công' });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Đăng xuất thất bại' });
  }
};

exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: 'Thiếu refreshToken' });
    }

    const result = await authService.refresh(refreshToken);
    res.status(200).json({ message: 'Làm mới token thành công', ...result });
  } catch (err) {
    res.status(403).json({ message: err.message || 'Làm mới token thất bại' });
  }
};

exports.sendOtpRegister = async (req, res) => {
  const { email } = req.body;
  try {
    const result = await authService.sendOtpRegister(email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Gửi OTP đăng ký thất bại' });
  }
};

exports.verifyOtpRegister = async (req, res) => {
  const { email, otp } = req.body;
  try {
    const result = await authService.verifyOtpRegister(email, otp);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Xác thực OTP đăng ký thất bại' });
  }
};

exports.sendOtpResetPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const result = await authService.sendOtpResetPassword(email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message || 'Gửi OTP quên mật khẩu thất bại' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Mật khẩu mới và xác nhận mật khẩu không khớp' });
    }

    const result = await authService.changePassword(userId, currentPassword, newPassword);
    res.status(200).json({ message: 'Đổi mật khẩu thành công', ...result });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Đổi mật khẩu thất bại' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Mật khẩu mới và xác nhận mật khẩu không khớp' });
    }

    const result = await authService.resetPassword(email, otp, newPassword);
    res.status(200).json({ message: 'Đặt lại mật khẩu thành công', ...result });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Đặt lại mật khẩu thất bại' });
  }
};

// 🆕 Select role (for users with multiple roles)
exports.selectRole = async (req, res) => {
  try {
    const { tempToken, selectedRole } = req.body;

    if (!tempToken || !selectedRole) {
      return res.status(400).json({ message: 'Thiếu thông tin tempToken hoặc selectedRole' });
    }

    const result = await authService.selectRole(tempToken, selectedRole);
    res.status(200).json({ message: 'Chọn vai trò thành công', ...result });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Chọn vai trò thất bại' });
  }
};

// 🆕 Complete forced password change (first login or default password)
exports.completePasswordChange = async (req, res) => {
  try {
    const { tempToken, newPassword, confirmPassword } = req.body;

    if (!tempToken || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'Thiếu thông tin tempToken, newPassword hoặc confirmPassword' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'Mật khẩu mới và xác nhận mật khẩu không khớp' });
    }

    const result = await authService.completePasswordChange(tempToken, newPassword);
    res.status(200).json({ message: 'Đổi mật khẩu thành công', ...result });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Đổi mật khẩu thất bại' });
  }
};

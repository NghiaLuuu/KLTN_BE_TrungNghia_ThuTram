// auth.service.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const redis = require('../utils/redis.client');
const { generateOtp } = require('../utils/otp.util');
const { sendEmail } = require('../utils/mail.util');
const { refreshUserCache } = require('./user.service');
const {
  generateAccessToken,
  generateRefreshToken,
} = require('../utils/token.util');
const userRepo = require('../repositories/user.repository');

const OTP_EXPIRE_SECONDS = 5 * 60; // 5 phút
const OTP_VERIFIED_EXPIRE_SECONDS = 10 * 60; // 10 phút để hoàn tất đăng ký sau khi xác thực

// Gửi OTP đăng ký
exports.sendOtpRegister = async (email) => {
  const existingUser = await userRepo.findByEmail(email);
  if (existingUser) throw new Error('Email đã được sử dụng');

  const code = generateOtp();
  await redis.set(`otp:register:${email}`, code, { EX: OTP_EXPIRE_SECONDS });

  console.log(`Mã OTP đăng ký (${email}):`, code);
  await sendEmail(email, 'Mã OTP đăng ký', `Mã OTP của bạn là: ${code}`);
  return { message: 'OTP đăng ký đã được gửi đến email' };
};

// Gửi OTP quên mật khẩu
exports.sendOtpResetPassword = async (email) => {
  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('Email chưa được đăng ký trong hệ thống');

  const code = generateOtp();
  await redis.set(`otp:reset:${email}`, code, { EX: OTP_EXPIRE_SECONDS });

  console.log(`Mã OTP quên mật khẩu (${email}):`, code);
  await sendEmail(email, 'Mã OTP đặt lại mật khẩu', `Mã OTP của bạn là: ${code}`);
  return { message: 'OTP đặt lại mật khẩu đã được gửi đến email' };
};

// Xác minh OTP
exports.verifyOtp = async (email, code, type) => {
  const key = `otp:${type}:${email}`;
  const storedCode = await redis.get(key);

  if (!storedCode) throw new Error('Không tìm thấy mã OTP hoặc mã đã hết hạn');
  if (storedCode !== code) throw new Error('Mã OTP không chính xác');

  await redis.del(key);
  return true;
};

// Xác thực OTP đăng ký và lưu trạng thái đã xác thực
exports.verifyOtpRegister = async (email, code) => {
  await exports.verifyOtp(email, code, 'register');

  const verifiedKey = `otp:register:verified:${email}`;
  await redis.set(verifiedKey, 'true', { EX: OTP_VERIFIED_EXPIRE_SECONDS });

  return { message: 'Xác thực OTP thành công' };
};

// Đăng ký
exports.register = async (data) => {
  const { email, phone, password, confirmPassword, role, ...rest } = data;

  if (!email) throw new Error('Thiếu email');
  if (!password) throw new Error('Thiếu mật khẩu');
  if (!confirmPassword) throw new Error('Thiếu mật khẩu xác nhận');

  if (password.length < 8 || password.length > 16) {
    throw new Error('Mật khẩu phải có độ dài từ 8 đến 16 ký tự');
  }

  if (password !== confirmPassword) {
    throw new Error('Mật khẩu xác nhận không khớp');
  }

  const [existingEmail, existingPhone] = await Promise.all([
    userRepo.findByEmail(email),
    userRepo.findByPhone(phone),
  ]);

  if (existingEmail) throw new Error('Email đã được sử dụng');
  if (existingPhone) throw new Error('Số điện thoại đã được sử dụng');

  const verifiedKey = `otp:register:verified:${email}`;
  const isVerified = await redis.get(verifiedKey);
  if (!isVerified) {
    throw new Error('Email chưa được xác thực OTP');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new (require('../models/user.model'))({
    email,
    password: hashedPassword,
    role,
    phone,
    ...rest,
  });

  const savedUser = await user.save();
  await refreshUserCache(); // Cập nhật cache ngay sau khi đăng ký
  await redis.del(verifiedKey);

  return savedUser;
};

// Đăng nhập
exports.login = async ({ login, password, role }) => {
  // ✅ Tìm user theo email/employeeCode/phone (KHÔNG validation format)
  const user = await userRepo.findByLogin(login);
  
  if (!user) {
    throw new Error('Không tìm thấy người dùng với thông tin đăng nhập này');
  }

  // ✅ Kiểm tra mật khẩu
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new Error('Sai mật khẩu');
  }

  // ✅ Kiểm tra trạng thái tài khoản
  if (!user.isActive) {
    throw new Error('Tài khoản đã bị tạm khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
  }

  // ✅ Kiểm tra mật khẩu mặc định - BẮT BUỘC đổi mật khẩu
  const isPatient = user.role === 'patient' || (user.roles && user.roles.length === 1 && user.roles[0] === 'patient');
  const isUsingDefaultPassword = isPatient 
    ? (password === '12345678') // Patient default password
    : (user.employeeCode && password === user.employeeCode); // Staff default password
  
  if (isUsingDefaultPassword) {
    // Generate temp token for password change
    const tempToken = jwt.sign(
      { userId: user._id, type: 'password-change' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' } // 15 minutes to change password
    );
    
    return {
      message: 'Cần đổi mật khẩu',
      pendingData: {
        requiresPasswordChange: true,
        userId: user._id,
        tempToken,
        user: {
          _id: user._id,
          fullName: user.fullName,
          email: user.email,
          employeeCode: user.employeeCode,
          role: user.role
        }
      }
    };
  }

  // ✅ Check if user has multiple roles
  if (user.roles && user.roles.length > 1) {
    // Generate temporary token for role selection
    const tempToken = jwt.sign(
      { userId: user._id, type: 'role-selection' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' } // Short expiry for security
    );
    
    return {
      message: 'Đăng nhập thành công',
      pendingData: {
        requiresRoleSelection: true,
        roles: user.roles,
        userId: user._id,
        tempToken,
        user: {
          _id: user._id,
          fullName: user.fullName,
          email: user.email,
          employeeCode: user.employeeCode
        }
      }
    };
  }

  // ✅ Single role - normal login
  const refreshToken = generateRefreshToken(user);
  const accessToken = generateAccessToken(user);

  await userRepo.updateRefreshTokens(user, [refreshToken]);

  return { accessToken, refreshToken, user };
};

// Refresh token
exports.refresh = async (refreshToken) => {
  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (err) {
    throw new Error('Refresh token không hợp lệ');
  }

  const user = await userRepo.findById(payload.userId);
  if (!user || !user.refreshTokens.includes(refreshToken)) {
    throw new Error('Refresh token không tồn tại hoặc đã bị thu hồi');
  }

  // ✅ Preserve activeRole from refresh token payload
  const activeRole = payload.activeRole || user.roles?.[0];
  const newAccessToken = generateAccessToken(user, activeRole);
  const updatedTokens = user.refreshTokens.filter((t) => t !== refreshToken);
  await userRepo.updateRefreshTokens(user, updatedTokens);

  return { accessToken: newAccessToken };
};

// Đăng xuất
exports.logout = async (userId, refreshToken) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new Error('Không tìm thấy người dùng');

  if (!user.refreshTokens.includes(refreshToken)) {
    throw new Error('Refresh token không tồn tại hoặc không hợp lệ');
  }

  const updatedTokens = user.refreshTokens.filter((t) => t !== refreshToken);
  await userRepo.updateRefreshTokens(user, updatedTokens);
};

// Đổi mật khẩu
exports.changePassword = async (userId, currentPassword, newPassword) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new Error('Không tìm thấy người dùng');

  // Kiểm tra mật khẩu hiện tại
  const isHashed = user.password.startsWith('$2');
  let isMatch = false;

  if (isHashed) {
    isMatch = await bcrypt.compare(currentPassword, user.password);
  } else {
    isMatch = currentPassword === user.password;
  }

  if (!isMatch) throw new Error('Mật khẩu hiện tại không đúng');

  if (newPassword.length < 8 || newPassword.length > 16) {
    throw new Error('Mật khẩu mới phải có độ dài từ 8 đến 16 ký tự');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;

  await userRepo.saveUser(user);
  return { message: 'Đổi mật khẩu thành công' };
};

// Đặt lại mật khẩu
exports.resetPassword = async (email, otp, newPassword) => {
  await exports.verifyOtp(email, otp, 'reset');

  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('Không tìm thấy người dùng');

  if (newPassword.length < 8 || newPassword.length > 16) {
    throw new Error('Mật khẩu mới phải có độ dài từ 8 đến 16 ký tự');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;

  await userRepo.saveUser(user);
  return { message: 'Đặt lại mật khẩu thành công' };
};

// 🆕 Select role after login (for users with multiple roles)
exports.selectRole = async (tempToken, selectedRole) => {
  // Verify temp token
  let payload;
  try {
    payload = jwt.verify(tempToken, process.env.JWT_SECRET);
    if (payload.type !== 'role-selection') {
      throw new Error('Token không hợp lệ');
    }
  } catch (err) {
    throw new Error('Token không hợp lệ hoặc đã hết hạn');
  }

  // Get user
  const user = await userRepo.findById(payload.userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  // Validate selected role
  if (!user.roles || !user.roles.includes(selectedRole)) {
    throw new Error('Vai trò không hợp lệ');
  }

  // ✅ Generate tokens with selected role as activeRole
  const refreshToken = generateRefreshToken(user, selectedRole);
  const accessToken = generateAccessToken(user, selectedRole);

  await userRepo.updateRefreshTokens(user, [refreshToken]);

  return { accessToken, refreshToken, user };
};

// 🆕 Complete forced password change (first login or default password)
exports.completePasswordChange = async (tempToken, newPassword) => {
  // Verify temp token
  let payload;
  try {
    payload = jwt.verify(tempToken, process.env.JWT_SECRET);
    if (payload.type !== 'password-change') {
      throw new Error('Token không hợp lệ');
    }
  } catch (err) {
    throw new Error('Token không hợp lệ hoặc đã hết hạn');
  }

  // Get user
  const user = await userRepo.findById(payload.userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  // Validate new password
  if (newPassword.length < 8 || newPassword.length > 16) {
    throw new Error('Mật khẩu mới phải có độ dài từ 8 đến 16 ký tự');
  }

  // Check if new password is same as default password
  const isPatient = user.role === 'patient' || (user.roles && user.roles.length === 1 && user.roles[0] === 'patient');
  if (isPatient && newPassword === '12345678') {
    throw new Error('Mật khẩu mới không được trùng với mật khẩu mặc định');
  }
  if (!isPatient && user.employeeCode && newPassword === user.employeeCode) {
    throw new Error('Mật khẩu mới không được trùng với mã nhân viên');
  }

  // Hash and save new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;
  user.isFirstLogin = false; // Mark as not first login anymore
  await userRepo.saveUser(user);

  // Generate real tokens and complete login
  const refreshToken = generateRefreshToken(user);
  const accessToken = generateAccessToken(user);
  await userRepo.updateRefreshTokens(user, [refreshToken]);

  return { 
    accessToken, 
    refreshToken, 
    user,
    message: 'Đổi mật khẩu thành công' 
  };
};

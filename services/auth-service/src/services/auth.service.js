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

// Gửi OTP đăng ký
exports.sendOtpRegister = async (email) => {
  const existingUser = await userRepo.findByEmail(email);
  if (existingUser) throw new Error('Email đã tồn tại');

  const code = generateOtp();
  await redis.set(`otp:register:${email}`, code, {
    EX: OTP_EXPIRE_SECONDS,
  });
  console.log("Ma otp dang ky:${email}:", code);
  await sendEmail(email, 'Mã OTP đăng ký', `Mã OTP là: ${code}`);
  return { message: 'OTP đăng ký đã được gửi đến email' };
};

// Gửi OTP quên mật khẩu
exports.sendOtpResetPassword = async (email) => {
  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('Email chưa đăng ký');

  const code = generateOtp();
  await redis.set(`otp:reset:${email}`, code, {
    EX: OTP_EXPIRE_SECONDS,
  });

  console.log("Ma otp quen mat khau:${email}:", code);

  await sendEmail(email, 'Mã OTP đặt lại mật khẩu', `Mã OTP là: ${code}`);
  return { message: 'OTP khôi phục mật khẩu đã được gửi đến email' };
};


// Xác minh OTP (có kiểm tra loại)
exports.verifyOtp = async (email, code, type) => {
  const key = `otp:${type}:${email}`;
  const storedCode = await redis.get(key);

  if (!storedCode) throw new Error('Không tìm thấy mã OTP hoặc đã hết hạn');
  if (storedCode !== code) throw new Error('Mã OTP không đúng');

  await redis.del(key); // Xoá sau khi xác minh thành công
  return true;
};

// Đăng ký
exports.register = async (data) => {
  const { email, phone, password, confirmPassword, role, otp, ...rest } = data;

  if (!email) throw new Error('Thiếu email');
  if (!password) throw new Error('Thiếu mật khẩu');
  if (!confirmPassword) throw new Error('Thiếu mật khẩu xác nhận');
  if (!otp) throw new Error('Thiếu mã OTP');

  if (password.length < 8 || password.length > 16) {
    throw new Error('Mật khẩu phải từ 8 đến 16 ký tự');
  }

  if (password !== confirmPassword) {
    throw new Error('Mật khẩu xác nhận không khớp');
  }

  const [existingEmail, existingPhone] = await Promise.all([
    userRepo.findByEmail(email),
    userRepo.findByPhone(phone)
  ]);

  if (existingEmail) throw new Error('Email đã tồn tại');
  if (existingPhone) throw new Error('Số điện thoại đã tồn tại');

  await exports.verifyOtp(email, otp, 'register');

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = new (require('../models/user.model'))({
    email,
    password: hashedPassword,
    role,
    phone,
    ...rest,
  });

  const savedUser = await user.save();

  // 👇 Cập nhật lại cache ngay sau khi đăng ký thành công
  await refreshUserCache();

  return savedUser;
};


// Đăng nhập
exports.login = async ({ email, password }) => {
  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('User not found');

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new Error('Invalid credentials');

  const refreshToken = generateRefreshToken(user);
  const accessToken = generateAccessToken(user); // ✅ truyền toàn bộ user

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
    throw new Error('Invalid refresh token');
  }

  const newAccessToken = generateAccessToken(user._id);
  const updatedTokens = user.refreshTokens.filter(t => t !== refreshToken);
  await userRepo.updateRefreshTokens(user, updatedTokens);

  return { accessToken: newAccessToken };
};

// Logout
exports.logout = async (userId, refreshToken) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new Error('User not found');

  if (!user.refreshTokens.includes(refreshToken)) {
    throw new Error('Invalid refresh token');
  }

  const updatedTokens = user.refreshTokens.filter(t => t !== refreshToken);
  await userRepo.updateRefreshTokens(user, updatedTokens);
};

// Đổi mật khẩu
exports.changePassword = async (userId, currentPassword, newPassword) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new Error('User không tồn tại');

  // Kiểm tra xem password trong DB đã hash chưa
  const isHashed = user.password.startsWith('$2');
  let isMatch = false;

  if (isHashed) {
    // So sánh với hash
    isMatch = await bcrypt.compare(currentPassword, user.password);
  } else {
    // Trường hợp password chưa hash (plain text)
    isMatch = currentPassword === user.password;
  }

  if (!isMatch) throw new Error('Mật khẩu hiện tại không đúng');

  if (newPassword.length < 8 || newPassword.length > 16) {
    throw new Error('Mật khẩu mới phải từ 8 đến 16 ký tự');
  }

  // Hash mật khẩu mới trước khi lưu
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;

  await userRepo.saveUser(user);
  return { message: 'Đổi mật khẩu thành công' };
};

// Đặt lại mật khẩu
exports.resetPassword = async (email, otp, newPassword) => {
  await exports.verifyOtp(email, otp, 'reset');

  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('Không tìm thấy user');
  if (newPassword.length < 8 || newPassword.length > 16) {
  throw new Error('Mật khẩu mới phải từ 8 đến 16 ký tự');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;

  await userRepo.saveUser(user);
  return { message: 'Đặt lại mật khẩu thành công' };
};

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { generateOtp, isOtpExpired } = require('../utils/otp.util');
const { sendEmail } = require('../utils/mail.util');

const {
  generateAccessToken,
  generateRefreshToken,
} = require('../utils/token.util');
const userRepo = require('../repositories/user.repository');

// Biến RAM tạm lưu OTP: email => { code, expiresAt }
const otpStore = new Map();

// Gửi OTP đăng ký
exports.sendOtpRegister = async (email) => {
  const existingUser = await userRepo.findByEmail(email);
  if (existingUser) throw new Error('Email đã tồn tại');

  const code = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  otpStore.set(`${email}-register`, { code, expiresAt });

  await sendEmail(email, 'Mã OTP đăng ký', `Mã OTP là: ${code}`);
  return { message: 'OTP đăng ký đã được gửi đến email' };
};

// Gửi OTP quên mật khẩu
exports.sendOtpResetPassword = async (email) => {
  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('Email chưa đăng ký');

  const code = generateOtp();
  const expiresAt = Date.now() + 5 * 60 * 1000;

  otpStore.set(`${email}-reset`, { code, expiresAt });

  await sendEmail(email, 'Mã OTP đặt lại mật khẩu', `Mã OTP là: ${code}`);
  return { message: 'OTP khôi phục mật khẩu đã được gửi đến email' };
};

// Xác minh OTP (có kiểm tra loại)
exports.verifyOtp = async (email, code, type) => {
  const key = `${email}-${type}`;
  const record = otpStore.get(key);
  if (!record) throw new Error('Không tìm thấy mã OTP');
  if (record.expiresAt < Date.now()) {
    otpStore.delete(key);
    throw new Error('Mã OTP đã hết hạn');
  }
  if (record.code !== code) throw new Error('Mã OTP không đúng');

  otpStore.delete(key);
  return true;
};

exports.register = async (data) => {
  const { email, phone, password, role, otp, ...rest } = data;

  if (!email || !password || !otp) {
    throw new Error('Thiếu thông tin bắt buộc: email, mật khẩu hoặc mã OTP');
  }

 const [existingEmail, existingPhone] = await Promise.all([
    userRepo.findByEmail(email),
    userRepo.findByPhone(phone)
  ]);

  if (existingEmail) throw new Error('Email đã tồn tại');
  if (existingPhone) throw new Error('Số điện thoại đã tồn tại');

  // Kiểm tra OTP loại "register"
  await exports.verifyOtp(email, otp, 'register');

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = new (require('../models/user.model'))({
    email,
    password: hashedPassword,
    role,
    ...rest,
  });

  await userRepo.saveUser(user);

  return user;
};



// Đăng nhập
exports.login = async ({ email, password }) => {
  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('User not found');

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw new Error('Invalid credentials');

  const refreshToken = generateRefreshToken(user._id);
  const accessToken = generateAccessToken(user._id);

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

exports.changePassword = async (userId, currentPassword, newPassword) => {
  const user = await userRepo.findById(userId);
  console.log("userId: ", user)
  if (!user) throw new Error('User không tồn tại');

  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) throw new Error('Mật khẩu hiện tại không đúng');

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;

  await userRepo.saveUser(user);
  return { message: 'Đổi mật khẩu thành công' };
};

exports.resetPassword = async (email, otp, newPassword) => {
  // Kiểm tra OTP loại "reset"
  await exports.verifyOtp(email, otp, 'reset');

  const user = await userRepo.findByEmail(email);
  if (!user) throw new Error('Không tìm thấy user');

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  user.password = hashedPassword;

  await userRepo.saveUser(user);
  return { message: 'Đặt lại mật khẩu thành công' };
};


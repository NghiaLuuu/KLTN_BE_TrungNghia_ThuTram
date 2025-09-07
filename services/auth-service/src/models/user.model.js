const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userSchema = new Schema({
  role: {
    type: String,
    enum: ['admin', 'dentist', 'nurse', 'receptionist', 'patient', 'manager'],
    required: true,
  },
  type: {
    type: String,
    enum: ['fullTime', 'partTime'],
    default: "fullTime",
    required: false,
  },
  email: {
    type: String,
    unique: true,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: true,
  },
  fullName: {
    type: String,
    required: true,
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other'],
    required: true,
  },
  dateOfBirth: {
    type: Date,
    required: true,
  },
  employeeCode: {
    type: String,
    unique: true,
    sparse: true, // cho phép null nếu role = patient
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  refreshTokens: [{
    type: String,
  }],
});

// 🔹 Hook pre-save tự sinh employeeCode
userSchema.pre('save', async function(next) {
  const user = this;

  // Chỉ sinh mã cho role khác patient và nếu chưa có mã
  if (user.role === 'patient' || user.employeeCode) return next();

  const prefixMap = {
    admin: 'A',
    dentist: 'D',
    nurse: 'N',
    receptionist: 'R',
    manager: 'M'
  };
  const prefix = prefixMap[user.role] || 'X';

  const User = mongoose.model('User');

  // Tìm user có employeeCode cao nhất cùng role
  const lastUser = await User.findOne({ role: user.role, employeeCode: { $exists: true } })
                             .sort({ employeeCode: -1 })
                             .exec();

  let nextNumber = 1;
  if (lastUser && lastUser.employeeCode) {
    const match = lastUser.employeeCode.match(/\d+$/);
    if (match) nextNumber = parseInt(match[0], 10) + 1;
  }

  // Sinh employeeCode với 7 chữ số
  user.employeeCode = `${prefix}${String(nextNumber).padStart(7, '0')}`; // ví dụ: D0000001
  next();
});


module.exports = mongoose.model('User', userSchema);

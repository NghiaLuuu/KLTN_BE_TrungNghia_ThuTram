const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// 🆕 Schema cho chứng chỉ - mỗi chứng chỉ có tên và ảnh trước/sau
const certificateSchema = new Schema({
  certificateId: {
    type: String,
    required: true,
    unique: false // Unique trong scope của user, không global
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200 // Tên chứng chỉ
  },
  frontImage: {
    type: String,
    required: true // Ảnh mặt trước bắt buộc
  },
  backImage: {
    type: String,
    required: false // Ảnh mặt sau tùy chọn
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null // ID của admin/manager đã xác thực
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  verifiedAt: {
    type: Date,
    default: null // thời gian xác thực
  },
  notes: {
    type: String,
    maxlength: 200
  }
}, { _id: true, timestamps: true });

const userSchema = new Schema({
  avatar: { type: String, default: null },
  
  // 🆕 MULTIPLE ROLES - User có thể có nhiều role
  roles: {
    type: [String],
    enum: ['admin', 'manager', 'dentist', 'nurse', 'receptionist', 'patient'],
    required: true,
    default: ['patient'],
    validate: {
      validator: function(roles) {
        return roles && roles.length > 0;
      },
      message: 'User phải có ít nhất 1 role'
    }
  },
  
  email: {
    type: String,
    unique: true,
    sparse: true, // Allow null/undefined for staff without email
  },
  phone: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  fullName: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: null,
    trim: true,
    maxlength: 1000
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
    sparse: true,
  },
  
  // 🆕 DANH SÁCH CHỨNG CHỈ (chỉ cho dentist)
  certificates: {
    type: [certificateSchema],
    default: [],
    validate: [
      {
        validator: function(certificates) {
          // Chỉ dentist mới được có certificates
          if (!this.roles.includes('dentist')) return certificates.length === 0;
          return true;
        },
        message: 'Chỉ nha sĩ mới được có danh sách chứng chỉ'
      },
      {
        validator: function(certificates) {
          // Kiểm tra không trùng tên chứng chỉ
          if (certificates.length === 0) return true;
          
          const names = certificates.map(cert => cert.name?.toLowerCase().trim()).filter(Boolean);
          const uniqueNames = [...new Set(names)];
          return names.length === uniqueNames.length;
        },
        message: 'Tên chứng chỉ không được trùng lặp'
      },
      {
        validator: function(certificates) {
          // Kiểm tra không trùng certificateId
          if (certificates.length === 0) return true;
          
          const ids = certificates.map(cert => cert.certificateId).filter(Boolean);
          const uniqueIds = [...new Set(ids)];
          return ids.length === uniqueIds.length;
        },
        message: 'ID chứng chỉ không được trùng lặp'
      }
    ]
  },
  
  // 🆕 GHI CHÚ CHUNG CHO TẤT CẢ CHỨNG CHỈ
  certificateNotes: {
    type: String,
    default: '',
    trim: true,
    maxlength: 1000 // Mô tả chung cho tất cả chứng chỉ
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  hasBeenUsed: {
    type: Boolean,
    default: false,
    index: true // Index for performance when checking delete permissions
  },
  isFirstLogin: {
    type: Boolean,
    default: false, // Mặc định false, chỉ true khi admin/manager tạo nhân viên
  },
  refreshTokens: [{
    type: String,
  }],
}, {
  timestamps: true
});

// 🔹 Hook pre-save tự sinh employeeCode
userSchema.pre('save', async function(next) {
  const user = this;

  // ✅ Validate roles
  if (!user.roles || user.roles.length === 0) {
    user.roles = ['patient']; // Default to patient
  }

  // Bỏ qua patient hoặc đã có mã nhân viên
  if (user.roles.includes('patient') && user.roles.length === 1) {
    return next();
  }
  
  if (user.employeeCode) return next();

  // 🆕 Format mới: NV + 8 chữ số (NV00000001)
  const prefix = 'NV';

  const User = mongoose.model('User');
  // Tìm user có mã nhân viên lớn nhất (tất cả role staff)
  const lastUser = await User.findOne({ 
    employeeCode: { $exists: true, $ne: null },
    roles: { $nin: ['patient'] } // Loại trừ patient-only
  }).sort({ employeeCode: -1 }).exec();

  let nextNumber = 1;
  if (lastUser && lastUser.employeeCode) {
    const match = lastUser.employeeCode.match(/\d+$/);
    if (match) nextNumber = parseInt(match[0], 10) + 1;
  }

  user.employeeCode = `${prefix}${String(nextNumber).padStart(8, '0')}`;
  next();
});

// 🆕 Method để lấy thống kê chứng chỉ
userSchema.methods.getCertificateStats = function() {
  if (this.role !== 'dentist') return { total: 0, verified: 0, pending: 0 };
  
  const total = this.certificates.length;
  const verified = this.certificates.filter(cert => cert.isVerified).length;
  const pending = total - verified;
  
  return { total, verified, pending };
};

module.exports = mongoose.model('User', userSchema);

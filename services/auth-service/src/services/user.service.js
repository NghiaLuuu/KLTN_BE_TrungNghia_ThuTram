const userRepo = require('../repositories/user.repository');
const redis = require('../utils/redis.client');
const bcrypt = require('bcrypt');
const { uploadToS3 } = require('./s3.service');

const USER_CACHE_KEY = 'users_cache';
const DENTIST_CACHE_KEY = 'dentists_public';

// 🔹 CACHE OPERATIONS
async function initUserCache() {
  try {
    const users = await userRepo.listUsers();
    await redis.set(USER_CACHE_KEY, JSON.stringify(users));
    console.log(`✅ Cache nhân viên đã được tải: ${users.length} nhân viên`);
  } catch (err) {
    console.error('❌ Lỗi khi tải cache người dùng:', err);
  }
}

async function refreshUserCache() {
  try {
    const users = await userRepo.listUsers();
    await redis.set(USER_CACHE_KEY, JSON.stringify(users));

    // pick available repo method (compatibility)
    const getDentists = userRepo.getDentistsWithDescription
      || userRepo.getDentistsWithCertificates
      || userRepo.getDentistsForPatients
      || (async () => users.filter(u => u.role === 'dentist'));

    const dentists = await getDentists();
    await redis.set(DENTIST_CACHE_KEY, JSON.stringify(dentists));

    console.log(`♻ Cache người dùng đã được làm mới: ${Array.isArray(users) ? users.length : 0} người dùng`);
  } catch (err) {
    console.error('❌ Lỗi khi refresh cache:', err);
  }
}

// 🔹 BASIC OPERATIONS
exports.createUser = async (data) => {
  const user = await userRepo.createUser(data);
  await refreshUserCache();
  return user;
};

exports.updateUser = async (userId, data, updatedBy = null) => {
  const updated = await userRepo.updateById(userId, data, updatedBy);
  if (!updated) throw new Error('Không tìm thấy người dùng để cập nhật');
  await refreshUserCache();
  return updated;
};

exports.getProfile = async (userId) => {
  if (!userId) throw new Error('Thiếu mã người dùng');

  let users = await redis.get(USER_CACHE_KEY);
  if (users) {
    users = JSON.parse(users);
    const user = users.find(u => u._id.toString() === userId.toString());
    if (user) return user;
  }

  const userFromDb = await userRepo.findById(userId);
  if (!userFromDb) throw new Error('Không tìm thấy người dùng');
  return userFromDb;
};

// 🔹 LIST & SEARCH OPERATIONS
exports.getUsersByRole = async (role, page = 1, limit = 10) => {
  if (!role) throw new Error('Thiếu vai trò để lọc người dùng');

  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    userRepo.getUsersByRole(role, skip, limit),
    userRepo.countByRole(role),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
  };
};

exports.getAllStaff = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    userRepo.getAllStaff(skip, limit),
    userRepo.countAllStaff(),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
  };
};

exports.searchStaff = async (criteria = {}, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const [users, total] = await Promise.all([
    userRepo.searchStaff(criteria, skip, limit),
    userRepo.countStaff(criteria),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
  };
};

// 🔹 ADMIN OPERATIONS
exports.updateProfileByAdmin = async (currentUser, userId, data) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Bạn không có quyền thực hiện chức năng này');
  }

  const existingUser = await userRepo.findById(userId);
  if (!existingUser) {
    throw new Error('Không tìm thấy người dùng để cập nhật');
  }

  const updatedData = { ...existingUser.toObject(), ...data };
  const updatedUser = await userRepo.updateById(userId, updatedData, currentUser._id);
  
  if (!updatedUser) {
    throw new Error('Không thể cập nhật người dùng');
  }

  await refreshUserCache();
  return updatedUser;
};

exports.getUserById = async (currentUser, userId) => {
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser._id.toString() !== userId) {
    throw new Error('Bạn không có quyền truy cập thông tin người dùng này');
  }

  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  return user;
};

// 🆕 DELETE OPERATIONS - Chỉ xóa khi chưa được sử dụng
exports.deleteUser = async (currentUser, userId) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Bạn không có quyền xóa người dùng');
  }

  if (currentUser.userId.toString() === userId) {
    throw new Error('Không thể xóa chính mình');
  }

  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng để xóa');
  }

  if (user.role === 'patient') {
    throw new Error('Không thể xóa bệnh nhân từ auth-service');
  }

  // Không cho phép xóa user có role admin (không ai có thể xóa admin)
  if (user.role === 'admin') {
    throw new Error(`Không thể xóa admin ${user.fullName}. Admin không thể bị xóa.`);
  }

  // Chỉ admin mới có thể xóa manager
  if (user.role === 'manager' && currentUser.role !== 'admin') {
    throw new Error(`Chỉ admin mới có thể xóa manager ${user.fullName}.`);
  }

  // � Không cho phép xóa nếu user đã được sử dụng trong hệ thống
  if (user.hasBeenUsed) {
    throw new Error(`Không thể xóa nhân viên ${user.fullName} vì đã được sử dụng trong hệ thống. Vui lòng sử dụng chức năng ngưng hoạt động thay thế.`);
  }

  // Chỉ cho phép hard delete nếu chưa có lịch sử
  await userRepo.hardDeleteUser(userId);
  await refreshUserCache();
  
  return {
    type: 'hard_delete',
    message: `Nhân viên ${user.fullName} đã được xóa hoàn toàn khỏi hệ thống`,
    user: null
  };
};

// 🆕 TOGGLE ACTIVE STATUS - Bật/tắt trạng thái hoạt động của user
exports.toggleUserStatus = async (currentUser, userId) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Bạn không có quyền thay đổi trạng thái người dùng');
  }

  if (currentUser.userId.toString() === userId) {
    throw new Error('Không thể thay đổi trạng thái của chính mình');
  }

  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  if (user.role === 'patient') {
    throw new Error('Không thể thay đổi trạng thái bệnh nhân từ auth-service');
  }

  // Không cho phép thay đổi trạng thái admin (không ai có thể tác động admin)
  if (user.role === 'admin') {
    throw new Error(`Không thể thay đổi trạng thái admin ${user.fullName}. Admin không thể bị tác động.`);
  }

  // Chỉ admin mới có thể thay đổi trạng thái manager
  if (user.role === 'manager' && currentUser.role !== 'admin') {
    throw new Error(`Chỉ admin mới có thể thay đổi trạng thái manager ${user.fullName}.`);
  }

  let updatedUser;
  let actionType;
  let message;

  if (user.isActive) {
    // Đang active -> chuyển thành inactive (deactivate)
    updatedUser = await userRepo.softDeleteUser(userId, currentUser._id || 'Ngưng hoạt động bởi quản trị viên');
    actionType = 'deactivate';
    message = `Nhân viên ${user.fullName} đã được ngưng hoạt động`;
  } else {
    // Đang inactive -> chuyển thành active (reactivate)
    updatedUser = await userRepo.reactivateUser(userId);
    actionType = 'reactivate';
    message = `Nhân viên ${user.fullName} đã được kích hoạt lại`;
  }

  await refreshUserCache();
  
  return {
    type: actionType,
    message: message,
    user: updatedUser
  };
};

// 🆕 CHECK USAGE IN OTHER SERVICES
async function checkUserUsageInSystem(userId) {
  try {
    // TODO: Implement RPC calls to other services
    // const scheduleUsage = await scheduleServiceRPC.checkUserUsage(userId);
    // const appointmentUsage = await appointmentServiceRPC.checkUserUsage(userId);
    
    // Mock implementation for now
    return {
      hasAppointments: false,
      hasSchedules: false,
      appointmentCount: 0,
      scheduleCount: 0
    };
  } catch (error) {
    console.error('Error checking user usage:', error);
    // Nếu không check được, mặc định là có sử dụng để an toàn
    return {
      hasAppointments: true,
      hasSchedules: true,
      appointmentCount: 1,
      scheduleCount: 1
    };
  }
}

// 🔹 UTILITY OPERATIONS
exports.getStaffByIds = async (ids) => {
  const users = await userRepo.findUsersByIds(ids);
  const staff = users.map(u => ({
    _id: u._id,
    name: u.fullName,
    role: u.role,
    specializations: u.specializations,
    description: u.description
  }));

  return { staff };
};

exports.updateUserAvatar = async (userId, file) => {
  if (!file) throw new Error('Chưa có file upload');

  const avatarUrl = await uploadToS3(file.buffer, file.originalname, file.mimetype, 'avatars');
  const updatedUser = await userRepo.updateAvatar(userId, avatarUrl);
  
  if (!updatedUser) throw new Error('Không tìm thấy người dùng');
  
  await refreshUserCache();
  return updatedUser;
};

// 🆕 CERTIFICATE OPERATIONS (upload ảnh với logic xác thực thông minh)
exports.uploadCertificate = async (currentUser, userId, file, notes = null) => {
  // Chỉ admin/manager hoặc chính nha sĩ đó mới được upload
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser._id.toString() !== userId) {
    throw new Error('Bạn không có quyền upload chứng chỉ cho người khác');
  }

  const user = await userRepo.findById(userId);
  if (!user || user.role !== 'dentist') {
    throw new Error('Chỉ có thể upload chứng chỉ cho nha sĩ');
  }

  if (!file) {
    throw new Error('Chưa có file chứng chỉ để upload');
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.mimetype)) {
    throw new Error('Chỉ chấp nhận file ảnh (JPG, PNG, WEBP)');
  }

  // Validate file size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('File ảnh không được vượt quá 5MB');
  }

  try {
    // Upload to S3
    const imageUrl = await uploadToS3(file.buffer, file.originalname, file.mimetype, 'certificates');
    
    // 🎯 LOGIC QUAN TRỌNG: Tự động xác thực nếu admin/manager upload
    const isAutoVerified = ['admin', 'manager'].includes(currentUser.role);
    
    // Save to database với trạng thái xác thực phù hợp
    const certificateData = {
      imageUrl,
      notes,
      isVerified: isAutoVerified,
      verifiedBy: isAutoVerified ? currentUser._id : null,
      verifiedAt: isAutoVerified ? new Date() : null
    };

    const updatedUser = await userRepo.addCertificateImage(userId, certificateData);
    await refreshUserCache();
    
    const message = isAutoVerified 
      ? 'Upload và xác thực chứng chỉ thành công (tự động)' 
      : 'Upload chứng chỉ thành công (đang chờ xác thực)';
    
    return {
      success: true,
      message,
      user: updatedUser,
      certificateUrl: imageUrl,
      isAutoVerified
    };
  } catch (error) {
    throw new Error(`Lỗi upload chứng chỉ: ${error.message}`);
  }
};

exports.deleteCertificate = async (currentUser, userId, certificateId) => {
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser._id.toString() !== userId) {
    throw new Error('Bạn không có quyền xóa chứng chỉ');
  }

  const updatedUser = await userRepo.deleteCertificate(userId, certificateId);
  if (!updatedUser) {
    throw new Error('Không tìm thấy chứng chỉ để xóa');
  }

  await refreshUserCache();
  return updatedUser;
};

// 🆕 ADMIN-ONLY: Verify certificate
exports.verifyCertificate = async (currentUser, userId, certificateId, isVerified = true) => {
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Chỉ admin/manager mới có quyền xác thực chứng chỉ');
  }

  const updatedUser = await userRepo.verifyCertificate(userId, certificateId, isVerified, currentUser._id);
  if (!updatedUser) {
    throw new Error('Không tìm thấy chứng chỉ để xác thực');
  }

  await refreshUserCache();
  return updatedUser;
};

exports.updateCertificateNotes = async (currentUser, userId, certificateId, notes) => {
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser._id.toString() !== userId) {
    throw new Error('Bạn không có quyền cập nhật ghi chú chứng chỉ');
  }

  const updatedUser = await userRepo.updateCertificateNotes(userId, certificateId, notes);
  if (!updatedUser) {
    throw new Error('Không tìm thấy chứng chỉ để cập nhật');
  }

  await refreshUserCache();
  return updatedUser;
};

// 🆕 PUBLIC API: Get dentists with certificates for patient selection
exports.getDentistsForPatients = async () => {
  const cached = await redis.get('dentists_public');
  if (cached) return JSON.parse(cached);

  const dentists = await userRepo.getDentistsWithCertificates();
  
  const formattedDentists = dentists.map(dentist => ({
    id: dentist._id,
    name: dentist.fullName,
    avatar: dentist.avatar,
    certificates: {
      total: dentist.certificates.length,
      verified: dentist.certificates.filter(cert => cert.isVerified).length,
      images: dentist.certificates
        .filter(cert => cert.isVerified) // chỉ hiển thị chứng chỉ đã xác thực
        .map(cert => cert.imageUrl)
    }
  }));

  await redis.set('dentists_public', JSON.stringify(formattedDentists), 'EX', 3600); // cache 1 hour
  return formattedDentists;
};

exports.refreshUserCache = refreshUserCache;

// Initialize cache on startup
initUserCache().catch(err => console.error('❌ Lỗi khi tải cache người dùng:', err));

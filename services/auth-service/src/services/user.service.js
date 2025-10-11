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

// 🔄 Enhanced getAllStaff with search, role filter, and sorting
exports.getAllStaff = async (options = {}) => {
  const { 
    page = 1, 
    limit = 10, 
    search = '', 
    role, 
    sortBy = 'name', 
    sortOrder = 'asc' 
  } = options;
  
  const skip = (page - 1) * limit;
  
  // Build filter criteria
  const criteria = {};
  if (search) {
    criteria.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }
  if (role) {
    criteria.role = role;
  }
  
  const [users, total] = await Promise.all([
    userRepo.getAllStaffWithCriteria(criteria, skip, limit, sortBy, sortOrder),
    userRepo.countStaffWithCriteria(criteria),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
    hasNextPage: page < Math.ceil(total / limit),
    hasPrevPage: page > 1
  };
};

// 🆕 New getAllPatients method
exports.getAllPatients = async (options = {}) => {
  const { 
    page = 1, 
    limit = 10, 
    search = '', 
    sortBy = 'name', 
    sortOrder = 'asc' 
  } = options;
  
  const skip = (page - 1) * limit;
  
  // Build filter criteria for patients only
  const criteria = { role: 'patient' };
  if (search) {
    criteria.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }
  
  const [users, total] = await Promise.all([
    userRepo.getAllPatientsWithCriteria(criteria, skip, limit, sortBy, sortOrder),
    userRepo.countPatientsWithCriteria(criteria),
  ]);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    users,
    hasNextPage: page < Math.ceil(total / limit),
    hasPrevPage: page > 1
  };
};

// 🆕 New updateUserWithPermissions method với role-based permissions
exports.updateUserWithPermissions = async (currentUser, targetUserId, updateData) => {
  // Lấy thông tin target user
  const targetUser = await userRepo.findById(targetUserId);
  if (!targetUser) {
    throw new Error('Không tìm thấy người dùng cần cập nhật');
  }

  // Apply role-based permissions
  const { role: currentRole, userId: currentUserId } = currentUser; // ✅ Sử dụng userId thay vì _id
  
  // Validate current user data
  if (!currentUserId || !currentRole) {
    throw new Error('Thông tin user không hợp lệ từ token');
  }
  
  const isUpdatingSelf = currentUserId.toString() === targetUserId.toString();
  
  // � CERTIFICATE VALIDATION: Chỉ admin/manager mới được cập nhật certificates
  // Và tất cả certificates phải có isVerified = true khi admin/manager thêm
  if (updateData.certificates) {
    // Chỉ admin/manager mới được thêm/sửa certificates
    if (!['admin', 'manager'].includes(currentRole)) {
      throw new Error('Chỉ admin và manager mới có quyền quản lý chứng chỉ');
    }
    
    // Đảm bảo target user là dentist
    if (targetUser.role !== 'dentist') {
      throw new Error('Chỉ có thể quản lý chứng chỉ cho nha sĩ');
    }
    
    // ⭐ QUAN TRỌNG: Tự động set isVerified = true cho tất cả certificates
    // khi admin/manager thêm/cập nhật
    updateData.certificates = updateData.certificates.map(cert => ({
      ...cert,
      isVerified: true,
      verifiedBy: cert.isVerified === false ? null : (cert.verifiedBy || currentUserId),
      verifiedAt: cert.isVerified === false ? null : (cert.verifiedAt || new Date())
    }));
  }
  
  // �🔒 ADMIN RULES
  if (currentRole === 'admin') {
    // Admin không thể cập nhật chính mình
    if (isUpdatingSelf) {
      throw new Error('Admin không thể tự cập nhật thông tin của mình');
    }
    // Admin có thể cập nhật tất cả role khác (không giới hạn field nào)
    // Không có restriction nào khác
  }
  
  // 🔒 MANAGER RULES  
  else if (currentRole === 'manager') {
    // Manager không thể cập nhật admin và manager khác
    if (targetUser.role === 'admin' || (targetUser.role === 'manager' && !isUpdatingSelf)) {
      throw new Error('Manager không thể cập nhật admin hoặc manager khác');
    }
    // Manager có thể cập nhật tất cả user còn lại (trừ email + số điện thoại)
    if (updateData.email || updateData.phoneNumber) {
      throw new Error('Manager không thể cập nhật email hoặc số điện thoại');
    }
  }
  
  // 🔒 PATIENT RULES
  else if (currentRole === 'patient') {
    // Patient chỉ có thể cập nhật chính mình
    if (!isUpdatingSelf) {
      throw new Error('Bạn chỉ có thể cập nhật thông tin của chính mình');
    }
    // Patient không được cập nhật email và số điện thoại
    if (updateData.email || updateData.phoneNumber) {
      throw new Error('Bạn không thể cập nhật email hoặc số điện thoại');
    }
    // Patient không thể thay đổi role
    if (updateData.role) {
      throw new Error('Bạn không thể thay đổi vai trò của mình');
    }
  }
  
  // 🔒 STAFF RULES (dentist, nurse, receptionist, etc.)
  else {
    // Các nhân viên khác không thể cập nhật chính mình hay bất kì ai
    throw new Error(`Nhân viên với role '${currentRole}' không có quyền cập nhật thông tin người dùng`);
  }
  
  // Execute update
  const updated = await userRepo.updateById(targetUserId, updateData, currentUserId);
  if (!updated) throw new Error('Không thể cập nhật thông tin người dùng');
  
  await refreshUserCache();
  return updated;
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

exports.getUserById = async (currentUser, userId) => {
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser.userId.toString() !== userId) {
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
    updatedUser = await userRepo.softDeleteUser(userId, currentUser.userId || 'Ngưng hoạt động bởi quản trị viên');
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
  // Validate currentUser và lấy ID linh hoạt
  if (!currentUser || !currentUser.role) {
    throw new Error('Thông tin người dùng không hợp lệ hoặc token đã hết hạn');
  }

  // Lấy ID từ các field có thể có trong JWT payload  
  const currentUserId = currentUser.userId || currentUser._id || currentUser.id;
  if (!currentUserId) {
    throw new Error('Token không chứa thông tin ID người dùng hợp lệ');
  }

  // Chỉ admin/manager mới được upload chứng chỉ
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Chỉ admin và manager mới có quyền upload chứng chỉ');
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
    // Upload to S3 (sử dụng folder avatars để đảm bảo public như avatar)
    const imageUrl = await uploadToS3(file.buffer, file.originalname, file.mimetype, 'avatars');
    
    // 🎯 LOGIC QUAN TRỌNG: Tự động xác thực nếu admin/manager upload
    const isAutoVerified = ['admin', 'manager'].includes(currentUser.role);
    
    // Save to database với trạng thái xác thực phù hợp
    const certificateData = {
      imageUrl,
      notes,
      isVerified: isAutoVerified,
      verifiedBy: isAutoVerified ? currentUserId : null,
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

exports.uploadMultipleCertificates = async (currentUser, userId, files, notes = null) => {
  // Validate currentUser và lấy ID linh hoạt
  if (!currentUser || !currentUser.role) {
    throw new Error('Thông tin người dùng không hợp lệ hoặc token đã hết hạn');
  }

  const currentUserId = currentUser.userId || currentUser._id || currentUser.id;
  if (!currentUserId) {
    throw new Error('Token không chứa thông tin ID người dùng hợp lệ');
  }

  // Chỉ admin/manager mới được upload chứng chỉ
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Chỉ admin và manager mới có quyền upload chứng chỉ');
  }

  const user = await userRepo.findById(userId);
  if (!user || user.role !== 'dentist') {
    throw new Error('Chỉ có thể upload chứng chỉ cho nha sĩ');
  }

  if (!files || files.length === 0) {
    throw new Error('Chưa có file chứng chỉ để upload');
  }

  if (files.length > 5) {
    throw new Error('Chỉ cho phép upload tối đa 5 chứng chỉ cùng lúc');
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    try {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new Error(`File ${file.originalname}: Chỉ chấp nhận file ảnh (JPG, PNG, WEBP)`);
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        throw new Error(`File ${file.originalname}: File ảnh không được vượt quá 5MB`);
      }

      // Upload to S3
      const imageUrl = await uploadToS3(file.buffer, file.originalname, file.mimetype, 'avatars');
      
      // Auto verify for admin/manager
      const isAutoVerified = ['admin', 'manager'].includes(currentUser.role);
      
      // Save to database
      const certificateData = {
        imageUrl,
        notes: Array.isArray(notes) ? notes[i] : notes,
        isVerified: isAutoVerified,
        verifiedBy: isAutoVerified ? currentUserId : null,
        verifiedAt: isAutoVerified ? new Date() : null
      };

      await userRepo.addCertificateImage(userId, certificateData);
      
      results.push({
        fileName: file.originalname,
        imageUrl,
        success: true
      });

    } catch (error) {
      errors.push({
        fileName: file.originalname,
        error: error.message,
        success: false
      });
    }
  }

  await refreshUserCache();
  
  return {
    success: errors.length === 0,
    message: `Upload hoàn tất: ${results.length} thành công, ${errors.length} lỗi`,
    results,
    errors,
    totalUploaded: results.length
  };
};

// 🚨 DEPRECATED: Sử dụng batchDeleteCertificates thay thế
exports.deleteCertificate = async (currentUser, userId, certificateId) => {
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser.userId.toString() !== userId) {
    throw new Error('Bạn không có quyền xóa chứng chỉ');
  }

  // 🛡️ Validate user is dentist first
  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }
  if (user.role !== 'dentist') {
    throw new Error('Chỉ có thể xóa chứng chỉ của nha sĩ');
  }

  // 🛡️ Verify certificate belongs to this dentist
  const existingCert = user.certificates?.find(cert => cert.certificateId === certificateId);
  if (!existingCert) {
    throw new Error(`Chứng chỉ ${certificateId} không thuộc về nha sĩ ${user.fullName}`);
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

  const updatedUser = await userRepo.verifyCertificate(userId, certificateId, isVerified, currentUser.userId);
  if (!updatedUser) {
    throw new Error('Không tìm thấy chứng chỉ để xác thực');
  }

  await refreshUserCache();
  return updatedUser;
};

exports.updateCertificateNotes = async (currentUser, userId, certificateId, notes) => {
  if (!['admin', 'manager'].includes(currentUser.role) && currentUser.userId.toString() !== userId) {
    throw new Error('Bạn không có quyền cập nhật ghi chú chứng chỉ');
  }

  const updatedUser = await userRepo.updateCertificateNotes(userId, certificateId, notes);
  if (!updatedUser) {
    throw new Error('Không tìm thấy chứng chỉ để cập nhật');
  }

  await refreshUserCache();
  return updatedUser;
};

// 🔍 HELPER: Check duplicate image URLs across all dentists
async function checkDuplicateImageUrls(imageFiles) {
  if (!imageFiles || imageFiles.length === 0) return;

  // Get all existing image URLs from all dentists
  const allDentists = await userRepo.getDentistsWithCertificates();
  const existingUrls = new Set();
  
  allDentists.forEach(dentist => {
    dentist.certificates?.forEach(cert => {
      if (cert.frontImage) existingUrls.add(cert.frontImage);
      if (cert.backImage) existingUrls.add(cert.backImage);
    });
  });

  // Generate URLs for new images to check for duplicates
  for (const imageFile of imageFiles) {
    if (!imageFile || !imageFile.buffer) continue;
    
    // Generate the same URL that would be created by uploadToS3
    const { v4: uuidv4 } = require('uuid');
    const key = `avatars/${uuidv4()}-${imageFile.originalname}`;
    const potentialUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    
    // Check if this exact image content already exists (by comparing buffer hash)
    const crypto = require('crypto');
    const imageHash = crypto.createHash('md5').update(imageFile.buffer).digest('hex');
    
    // Check against existing certificates for same image content
    for (const dentist of allDentists) {
      for (const cert of dentist.certificates || []) {
        // This is a simplified check - in production you might want to store image hashes
        // For now, we'll check file name similarity as a basic duplicate detection
        if (cert.frontImage?.includes(imageFile.originalname) || 
            cert.backImage?.includes(imageFile.originalname)) {
          throw new Error(`Ảnh chứng chỉ "${imageFile.originalname}" có thể đã tồn tại trong hệ thống. Vui lòng sử dụng ảnh khác.`);
        }
      }
    }
  }
}

// 🆕 BATCH-ONLY Certificate Management Methods

// 🆕 BATCH Operations for Certificates

exports.batchCreateCertificates = async (currentUser, userId, { names, frontImages, backImages, certificateNotes }) => {
  // Permission check - CHỈ admin/manager mới được tạo
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Chỉ admin và manager mới có quyền tạo chứng chỉ');
  }

  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  if (user.role !== 'dentist') {
    throw new Error('Chỉ nha sĩ mới có thể có chứng chỉ');
  }

  // Validate names data
  if (names.length !== frontImages.length) {
    throw new Error('Số lượng tên chứng chỉ phải bằng số lượng ảnh mặt trước');
  }

  // Check for duplicate names in request
  const requestNames = names.map(name => name?.toLowerCase().trim()).filter(Boolean);
  if (new Set(requestNames).size !== requestNames.length) {
    throw new Error('Không được trùng tên chứng chỉ trong cùng một request');
  }

  // Check for duplicate names with existing certificates
  const existingCertNames = user.certificates?.map(cert => cert.name?.toLowerCase().trim()).filter(Boolean) || [];
  for (const name of requestNames) {
    if (existingCertNames.includes(name.toLowerCase().trim())) {
      throw new Error(`Chứng chỉ "${name}" đã tồn tại`);
    }
  }

  // 🆕 Kiểm tra trùng URL ảnh với tất cả dentist khác
  await checkDuplicateImageUrls(frontImages.concat(backImages.filter(Boolean)));

  // Upload images and create certificates
  const { uploadToS3 } = require('./s3.service');
  const { v4: uuidv4 } = require('uuid');
  
  // ⭐ Get currentUserId for verifiedBy field
  const currentUserId = currentUser.userId || currentUser._id || currentUser.id;
  
  const newCertificates = [];
  
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const frontImage = frontImages[i];
    const backImage = backImages[i] || null;
    
    const certificateId = `cert_${userId}_${Date.now()}_${uuidv4().slice(0, 8)}_${i}`;
    
    const frontImageUrl = await uploadToS3(frontImage.buffer, frontImage.originalname, frontImage.mimetype, 'avatars');
    const backImageUrl = backImage ? await uploadToS3(backImage.buffer, backImage.originalname, backImage.mimetype, 'avatars') : null;
    
    // ⭐ QUAN TRỌNG: Admin/Manager tạo chứng chỉ → tự động verified
    newCertificates.push({
      certificateId,
      name: name.trim(),
      frontImage: frontImageUrl,
      backImage: backImageUrl,
      isVerified: true, // ✅ Auto-verify khi admin/manager tạo
      verifiedBy: currentUserId,
      verifiedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  const updatedUser = await userRepo.addMultipleCertificatesAndUpdateNotes(userId, newCertificates, certificateNotes);
  if (!updatedUser) {
    throw new Error('Không thể tạo chứng chỉ mới');
  }

  await refreshUserCache();
  return updatedUser;
};

exports.batchUpdateCertificates = async (currentUser, userId, { certificateIds, names, frontImages, backImages, certificateNotes, isVerified }) => {
  // Permission check - CHỈ admin/manager mới được update
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Chỉ admin và manager mới có quyền cập nhật chứng chỉ');
  }

  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  // 🆕 Kiểm tra user phải là dentist
  if (user.role !== 'dentist') {
    throw new Error('Chỉ có thể cập nhật chứng chỉ của nha sĩ');
  }

  if (!certificateIds || certificateIds.length === 0) {
    throw new Error('Phải có ít nhất 1 certificateId để cập nhật');
  }

  // 🛡️ Verify all certificates belong to this specific dentist
  const existingCertIds = user.certificates?.map(cert => cert.certificateId) || [];
  for (const certId of certificateIds) {
    if (!existingCertIds.includes(certId)) {
      throw new Error(`Chứng chỉ ${certId} không thuộc về nha sĩ ${user.fullName}`);
    }
  }

  // 🆕 Kiểm tra trùng URL ảnh với tất cả dentist khác (chỉ khi có ảnh mới)
  const newImages = [];
  if (frontImages) newImages.push(...frontImages);
  if (backImages) newImages.push(...backImages.filter(Boolean));
  if (newImages.length > 0) {
    await checkDuplicateImageUrls(newImages);
  }

  // Process each certificate update
  for (let i = 0; i < certificateIds.length; i++) {
    const certificateId = certificateIds[i];
    const name = names?.[i];
    const frontImage = frontImages?.[i];
    const backImage = backImages?.[i];
    
    // Find existing certificate
    const existingCert = user.certificates?.find(cert => cert.certificateId === certificateId);
    if (!existingCert) {
      throw new Error(`Không tìm thấy chứng chỉ ${certificateId} để cập nhật`);
    }

    // Kiểm tra trùng tên chứng chỉ (nếu cập nhật tên)
    if (name !== undefined) {
      const newCertName = name.trim().toLowerCase();
      const otherCertNames = user.certificates
        ?.filter(cert => cert.certificateId !== certificateId)
        ?.map(cert => cert.name?.toLowerCase().trim())
        ?.filter(Boolean) || [];
      
      if (otherCertNames.includes(newCertName)) {
        throw new Error(`Chứng chỉ "${name}" đã tồn tại. Vui lòng chọn tên khác.`);
      }
    }

    // Prepare certificate update object
    const certificateUpdateData = {
      updatedAt: new Date()
    };

    // Upload new images if provided
    if (frontImage || backImage) {
      const { uploadToS3 } = require('./s3.service');
      
      if (frontImage) {
        certificateUpdateData.frontImage = await uploadToS3(frontImage.buffer, frontImage.originalname, frontImage.mimetype, 'avatars');
      }
      
      if (backImage) {
        certificateUpdateData.backImage = await uploadToS3(backImage.buffer, backImage.originalname, backImage.mimetype, 'avatars');
      }
    }

    // Update certificate name if provided
    if (name !== undefined) {
      certificateUpdateData.name = name.trim();
    }

    // ⭐ QUAN TRỌNG: Admin/Manager update certificates → tự động verified
    // Không cho phép set isVerified = false từ request
    if (['admin', 'manager'].includes(currentUser.role)) {
      certificateUpdateData.isVerified = true; // ✅ Luôn luôn true khi admin/manager update
      certificateUpdateData.verifiedBy = currentUser.userId;
      certificateUpdateData.verifiedAt = new Date();
    }

    await userRepo.updateCertificateAndNotes(userId, certificateId, certificateUpdateData, i === 0 ? certificateNotes : undefined);
  }

  // Return updated user
  const updatedUser = await userRepo.findById(userId);
  await refreshUserCache();
  return updatedUser;
};

exports.batchDeleteCertificates = async (currentUser, userId, { certificateIds }) => {
  // Permission check - CHỈ admin/manager mới được xóa
  if (!['admin', 'manager'].includes(currentUser.role)) {
    throw new Error('Chỉ admin và manager mới có quyền xóa chứng chỉ');
  }

  const user = await userRepo.findById(userId);
  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  // 🆕 Kiểm tra user phải là dentist
  if (user.role !== 'dentist') {
    throw new Error('Chỉ có thể xóa chứng chỉ của nha sĩ');
  }

  if (!certificateIds || certificateIds.length === 0) {
    throw new Error('Phải có ít nhất 1 certificateId để xóa');
  }

  // 🛡️ Verify all certificates exist and belong to this specific dentist
  const existingCertIds = user.certificates?.map(cert => cert.certificateId) || [];
  for (const certId of certificateIds) {
    if (!existingCertIds.includes(certId)) {
      throw new Error(`Không tìm thấy chứng chỉ ${certId} trong danh sách chứng chỉ của nha sĩ ${user.fullName}`);
    }
  }

  // 🔍 Double-check: Verify certificate ownership before deletion
  const certificatesToDelete = user.certificates?.filter(cert => certificateIds.includes(cert.certificateId)) || [];
  if (certificatesToDelete.length !== certificateIds.length) {
    throw new Error('Một số chứng chỉ không thuộc về nha sĩ này');
  }

  // Delete each certificate
  for (const certificateId of certificateIds) {
    await userRepo.deleteCertificate(userId, certificateId);
  }

  // Return updated user
  const updatedUser = await userRepo.findById(userId);
  await refreshUserCache();
  return updatedUser;
};

// Note: deleteCertificate method already exists above, no need to recreate

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

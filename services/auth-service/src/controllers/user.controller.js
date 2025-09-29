const userService = require('../services/user.service');

// 🔹 ĐẢM BẢO CÁC METHOD NÀY TỒN TẠI VÀ ĐƯỢC EXPORT
exports.deleteUser = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;

    const result = await userService.deleteUser(currentUser, userId);
    
    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

exports.toggleUserStatus = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;

    const result = await userService.toggleUserStatus(currentUser, userId);
    
    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(400).json({ 
      success: false,
      message: error.message 
    });
  }
};

// 🔹 CERTIFICATE METHODS
exports.uploadCertificate = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;
    const file = req.file;
    const { notes } = req.body;

    // Debug logging
    console.log('🔍 Upload Certificate Debug:', {
      hasCurrentUser: !!currentUser,
      currentUserId: currentUser?._id || currentUser?.id || currentUser?.userId,
      currentUserRole: currentUser?.role,
      targetUserId: userId,
      hasFile: !!file,
      allUserFields: Object.keys(currentUser || {})
    });

    const result = await userService.uploadCertificate(currentUser, userId, file, notes);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Upload Certificate Error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.uploadMultipleCertificates = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;
    const files = req.files;
    const { notes } = req.body;

    console.log('🔍 Upload Multiple Certificates Debug:', {
      hasCurrentUser: !!currentUser,
      currentUserRole: currentUser?.role,
      targetUserId: userId,
      filesCount: files?.length || 0
    });

    const result = await userService.uploadMultipleCertificates(currentUser, userId, files, notes);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('❌ Upload Multiple Certificates Error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.deleteCertificate = async (req, res) => {
  try {
    const currentUser = req.user;
    const { userId, certificateId } = req.params;

    const updatedUser = await userService.deleteCertificate(currentUser, userId, certificateId);
    
    res.status(200).json({
      success: true,
      message: 'Xóa chứng chỉ thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.verifyCertificate = async (req, res) => {
  try {
    const currentUser = req.user;
    const { userId, certificateId } = req.params;
    const { isVerified = true } = req.body;

    const updatedUser = await userService.verifyCertificate(currentUser, userId, certificateId, isVerified);
    
    res.status(200).json({
      success: true,
      message: isVerified ? 'Xác thực chứng chỉ thành công' : 'Hủy xác thực chứng chỉ thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.updateCertificateNotes = async (req, res) => {
  try {
    const currentUser = req.user;
    const { userId, certificateId } = req.params;
    const { notes } = req.body;

    const updatedUser = await userService.updateCertificateNotes(currentUser, userId, certificateId, notes);
    
    res.status(200).json({
      success: true,
      message: 'Cập nhật ghi chú thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getDentistsForPatients = async (req, res) => {
  try {
    const dentists = await userService.getDentistsForPatients();

    res.status(200).json({
      success: true,
      dentists: dentists
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: 'Lỗi khi lấy danh sách nha sĩ' 
    });
  }
};

// 🔹 EXISTING METHODS

// 🆕 New updateUser method với role-based permissions
exports.updateUser = async (req, res) => {
  try {
    const currentUser = req.user;
    let targetUserId = req.params.id;
    
    // Nếu id = 'me' hoặc 'profile' thì update chính mình
    if (targetUserId === 'me' || targetUserId === 'profile') {
      targetUserId = req.user.userId; // ✅ Sử dụng userId từ JWT payload
    }
    // Nếu không có id thì cũng update chính mình (fallback)
    if (!targetUserId) {
      targetUserId = req.user.userId;
    }
    
    const updateData = req.body;
    const updatedUser = await userService.updateUserWithPermissions(currentUser, targetUserId, updateData);
    
    res.status(200).json({
      success: true,
      message: 'Cập nhật thông tin thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


// 🔄 Updated getAllStaff với role filter option và enhanced query params
exports.getAllStaff = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      role,
      sortBy = 'name', 
      sortOrder = 'asc' 
    } = req.query;

    const result = await userService.getAllStaff({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      role,
      sortBy,
      sortOrder
    });
    
    res.status(200).json({
      success: true,
      message: 'Lấy danh sách nhân viên thành công',
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// 🆕 New getAllPatients method
exports.getAllPatients = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      sortBy = 'name', 
      sortOrder = 'asc' 
    } = req.query;

    const result = await userService.getAllPatients({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      sortBy,
      sortOrder
    });
    
    res.status(200).json({
      success: true,
      message: 'Lấy danh sách bệnh nhân thành công',
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// 🔄 Keep searchStaff for backward compatibility (deprecated)
exports.searchStaff = async (req, res) => {
  try {
    const { page = 1, limit = 10, ...criteria } = req.query;

    const result = await userService.searchStaff(criteria, page, limit);
    
    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// 🆕 New searchPatients method
exports.searchPatients = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '',
      sortBy = 'name', 
      sortOrder = 'asc',
      ...criteria 
    } = req.query;

    // Use getAllPatients service with search criteria
    const result = await userService.getAllPatients({
      page: parseInt(page),
      limit: parseInt(limit),
      search,
      sortBy,
      sortOrder
    });
    
    res.status(200).json({
      success: true,
      message: 'Tìm kiếm bệnh nhân thành công',
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// 🔄 Enhanced getUserById - handles both profile and user by ID
exports.getUserById = async (req, res) => {
  try {
    const currentUser = req.user;
    let userId = req.params.id;
    
    // Nếu id = 'me' hoặc 'profile' thì lấy profile của mình
    if (userId === 'me' || userId === 'profile') {
      userId = currentUser.userId; // ✅ Sử dụng userId từ JWT payload
    }
    
    const user = await userService.getUserById(currentUser, userId);
    
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};





exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.params.id;
    const file = req.file;

    const updatedUser = await userService.updateUserAvatar(userId, file);
    
    res.status(200).json({
      success: true,
      message: 'Cập nhật avatar thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


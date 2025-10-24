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

// 🔹 DEPRECATED CERTIFICATE METHODS (replaced by manageCertificate)
/*
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
*/

// 🆕 Unified certificate management API
exports.manageCertificate = async (req, res) => {
  try {
    const currentUser = req.user;
    const { id: userId } = req.params;
    const { certificateId, name, certificateNotes, action = 'create', isVerified, certificates } = req.body;
    
    // Debug logging
    console.log('🔍 Certificate Action Debug:', {
      action,
      body: req.body,
      hasName: !!name,
      hasCertificateId: !!certificateId,
      filesArray: req.files || [],
      filesCount: (req.files || []).length
    });
    
    // Get uploaded files from array format (multer.any())
    const frontImages = (req.files || []).filter(file => file.fieldname === 'frontImages');
    const backImages = (req.files || []).filter(file => file.fieldname === 'backImages');

    let result;
    
    switch (action) {
      case 'batch-create':
        // Create multiple certificates - Parse from key-value pairs
        const certNames = [];
        let i = 0;
        while (req.body[`name${i}`] !== undefined) {
          const certName = req.body[`name${i}`];
          if (certName) certNames.push(certName);
          i++;
        }
        
        if (certNames.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Phải có ít nhất 1 tên chứng chỉ (name0, name1, ...)'
          });
        }
        
        if (frontImages.length === 0 || frontImages.length !== certNames.length) {
          return res.status(400).json({
            success: false,
            message: `Số lượng ảnh mặt trước (${frontImages.length}) phải bằng số lượng tên chứng chỉ (${certNames.length})`
          });
        }
        
        result = await userService.batchCreateCertificates(currentUser, userId, {
          names: certNames,
          frontImages,
          backImages,
          certificateNotes
        });
        break;
        
      case 'batch-update':
        // Update multiple certificates - Parse from key-value pairs
        const certIds = [];
        const certNames_update = [];
        let j = 0;
        while (req.body[`certificateId${j}`] !== undefined) {
          const certId = req.body[`certificateId${j}`];
          const certName = req.body[`name${j}`]; // optional
          
          if (certId) {
            certIds.push(certId);
            certNames_update.push(certName || undefined);
          }
          j++;
        }
        
        if (certIds.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Phải có ít nhất 1 certificateId để cập nhật (certificateId0, certificateId1, ...)'
          });
        }
        
        result = await userService.batchUpdateCertificates(currentUser, userId, {
          certificateIds: certIds,
          names: certNames_update,
          frontImages,
          backImages,
          certificateNotes,
          isVerified
        });
        break;

      case 'batch-delete':
        // Delete multiple certificates - Parse from key-value pairs
        const deleteIds = [];
        let k = 0;
        while (req.body[`certificateId${k}`] !== undefined) {
          const certId = req.body[`certificateId${k}`];
          if (certId) deleteIds.push(certId);
          k++;
        }
        
        if (deleteIds.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Phải có ít nhất 1 certificateId để xóa (certificateId0, certificateId1, ...)'
          });
        }
        
        result = await userService.batchDeleteCertificates(currentUser, userId, {
          certificateIds: deleteIds
        });
        break;
        
      default:
        return res.status(400).json({
          success: false,
          message: 'action phải là batch-create, batch-update hoặc batch-delete'
        });
    }

    const actionMessages = {
      'batch-create': 'Tạo nhiều chứng chỉ thành công',
      'batch-update': 'Cập nhật nhiều chứng chỉ thành công',
      'batch-delete': 'Xóa nhiều chứng chỉ thành công'
    };

    res.status(200).json({
      success: true,
      message: actionMessages[action] || `${action} chứng chỉ thành công`,
      data: result
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
    const currentUser = req.user; // Có thể undefined nếu không có authentication
    let userId = req.params.id;
    
    // Nếu id = 'me' hoặc 'profile' thì lấy profile của mình
    if (userId === 'me' || userId === 'profile') {
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          message: 'Phải đăng nhập để truy cập profile của bạn'
        });
      }
      userId = currentUser.userId; // ✅ Sử dụng userId từ JWT payload
    }
    
    // 🔥 Pass currentUser (có thể null) để service xử lý
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

// 🆕 Nhiệm vụ 1.2: Create staff without OTP
exports.createStaff = async (req, res) => {
  try {
    const currentUser = req.user; // From auth middleware
    const result = await userService.createStaff(req.body, currentUser);
    
    res.status(201).json({
      success: true,
      message: 'Tạo nhân viên thành công',
      ...result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};


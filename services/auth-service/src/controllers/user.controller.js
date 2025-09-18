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

// 🔹 CERTIFICATE METHODS
exports.uploadCertificate = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;
    const file = req.file;
    const { notes } = req.body;

    const result = await userService.uploadCertificate(currentUser, userId, file, notes);
    
    res.status(200).json(result);
  } catch (error) {
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

// 🔹 EXISTING METHODS - đảm bảo chúng tồn tại
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await userService.getProfile(userId);
    
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

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const updateData = req.body;
    
    const updatedUser = await userService.updateUser(userId, updateData, userId);
    
    res.status(200).json({
      success: true,
      message: 'Cập nhật profile thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getUsersByRole = async (req, res) => {
  try {
    const { role } = req.query;
    const { page = 1, limit = 10 } = req.query;

    const result = await userService.getUsersByRole(role, page, limit);
    
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

exports.getAllStaff = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const result = await userService.getAllStaff(page, limit);
    
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

exports.getUserById = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;

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

exports.updateProfileByAdmin = async (req, res) => {
  try {
    const currentUser = req.user;
    const userId = req.params.id;
    const updateData = req.body;

    const updatedUser = await userService.updateProfileByAdmin(currentUser, userId, updateData);
    
    res.status(200).json({
      success: true,
      message: 'Cập nhật thông tin nhân viên thành công',
      user: updatedUser
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

exports.getStaffByIds = async (req, res) => {
  try {
    const { ids } = req.body;
    
    const result = await userService.getStaffByIds(ids);
    
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


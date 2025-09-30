// user.repository.js
const User = require('../models/user.model');

// 🔹 BASIC QUERIES
exports.findByEmail = (email) => User.findOne({ email, deletedAt: null });

exports.findByLogin = (login) => {
  return User.findOne({
    $and: [
      { deletedAt: null },
      {
        $or: [
          { email: login },
          { employeeCode: login }
        ]
      }
    ]
  });
};

exports.findByPhone = (phone) => User.findOne({ phone, deletedAt: null });

exports.findById = async (id) => {
  return await User.findOne({ _id: id, deletedAt: null }); 
};

exports.saveUser = (user) => user.save();

// 🔹 UPDATE OPERATIONS
exports.updateById = async (id, data, updatedBy = null) => {
  const { password, email, role, ...allowedData } = data;
  
  if (updatedBy) allowedData.updatedBy = updatedBy;

  return await User.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: allowedData },
    { new: true, runValidators: true }
  ).select('-password');
};

exports.updateRefreshTokens = async (user, refreshTokens) => {
  user.refreshTokens = refreshTokens;
  user.lastLoginAt = new Date();
  return await user.save();
};

// 🔹 LIST OPERATIONS
exports.listUsers = async () => {
  return await User.find({ 
    role: { $ne: 'patient' }, 
    deletedAt: null 
  }).select('-password');
};



exports.countByRole = async (role) => {
  return await User.countDocuments({ role, deletedAt: null });
};

exports.getAllStaff = async (skip = 0, limit = 10) => {
  return await User.find({ 
    role: { $ne: 'patient' }, 
    deletedAt: null 
  })
    .select('-password')
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
};

exports.countAllStaff = async () => {
  return await User.countDocuments({ 
    role: { $ne: 'patient' }, 
    deletedAt: null 
  });
};

// 🆕 Enhanced staff queries with criteria and sorting
exports.getAllStaffWithCriteria = async (criteria = {}, skip = 0, limit = 10, sortBy = 'name', sortOrder = 'asc') => {
  const query = { 
    role: { $ne: 'patient' }, 
    deletedAt: null,
    ...criteria
  };
  
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
  
  return await User.find(query)
    .select('-password')
    .skip(skip)
    .limit(limit)
    .sort(sortOptions);
};

exports.countStaffWithCriteria = async (criteria = {}) => {
  const query = { 
    role: { $ne: 'patient' }, 
    deletedAt: null,
    ...criteria
  };
  
  return await User.countDocuments(query);
};

// 🆕 Patient-specific queries
exports.getAllPatientsWithCriteria = async (criteria = {}, skip = 0, limit = 10, sortBy = 'name', sortOrder = 'asc') => {
  const query = { 
    role: 'patient', 
    deletedAt: null,
    ...criteria
  };
  
  const sortOptions = {};
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
  
  return await User.find(query)
    .select('-password')
    .skip(skip)
    .limit(limit)
    .sort(sortOptions);
};

exports.countPatientsWithCriteria = async (criteria = {}) => {
  const query = { 
    role: 'patient', 
    deletedAt: null,
    ...criteria
  };
  
  return await User.countDocuments(query);
};

// 🔹 SEARCH OPERATIONS
exports.searchStaff = async (criteria, skip = 0, limit = 10) => {
  const query = { 
    role: { $ne: 'patient' }, 
    deletedAt: null 
  };

  if (criteria.fullName) query.fullName = { $regex: criteria.fullName, $options: 'i' };
  if (criteria.email) query.email = { $regex: criteria.email, $options: 'i' };
  if (criteria.phone) query.phone = { $regex: criteria.phone, $options: 'i' };
  if (criteria.role) query.role = criteria.role;
  if (criteria.gender) query.gender = criteria.gender;
  if (criteria.specialization) query.specializations = { $in: [criteria.specialization] };

  return await User.find(query)
    .select('-password')
    .skip(skip)
    .limit(limit)
    .sort({ createdAt: -1 });
};

exports.countStaff = async (criteria) => {
  const query = { 
    role: { $ne: 'patient' }, 
    deletedAt: null 
  };

  if (criteria.fullName) query.fullName = { $regex: criteria.fullName, $options: 'i' };
  if (criteria.email) query.email = { $regex: criteria.email, $options: 'i' };
  if (criteria.phone) query.phone = { $regex: criteria.phone, $options: 'i' };
  if (criteria.role) query.role = criteria.role;
  if (criteria.gender) query.gender = criteria.gender;
  if (criteria.specialization) query.specializations = { $in: [criteria.specialization] };

  return await User.countDocuments(query);
};



// 🔹 PROFILE OPERATIONS
exports.updateAvatar = async (userId, avatarUrl) => {
  return User.findOneAndUpdate(
    { _id: userId, deletedAt: null },
    { avatar: avatarUrl },
    { new: true }
  ).select('-password').lean();
};

// 🆕 DELETE OPERATIONS (SOFT DELETE)
exports.softDeleteUser = async (userId, deletedBy) => {
  return await User.findOneAndUpdate(
    { _id: userId, deletedAt: null },
    { 
      deletedAt: new Date(),
      deletedBy,
      isActive: false
    },
    { new: true }
  ).select('-password');
};

exports.hardDeleteUser = async (userId) => {
  return await User.findByIdAndDelete(userId);
};

// 🆕 REACTIVATE USER
exports.reactivateUser = async (userId) => {
  return await User.findOneAndUpdate(
    { _id: userId },
    { 
      deletedAt: null,
      deletedBy: null,
      isActive: true
    },
    { new: true }
  ).select('-password');
};

// 🆕 CHECK USAGE IN APPOINTMENTS/SCHEDULES
exports.checkUserUsageInSystem = async (userId) => {
  // Sẽ call đến các service khác để check
  // Hiện tại return mock data
  return {
    hasAppointments: false,
    hasSchedules: false,
    appointmentCount: 0,
    scheduleCount: 0
  };
};

// 🆕 CERTIFICATE OPERATIONS với data đầy đủ
exports.addCertificateImage = async (userId, certificateData) => {
  const user = await User.findOne({ _id: userId, role: 'dentist', deletedAt: null });
  if (!user) throw new Error('Không tìm thấy nha sĩ để thêm chứng chỉ');

  user.certificates.push(certificateData);
  return await user.save();
};

exports.deleteCertificate = async (userId, certificateId) => {
  return await User.findOneAndUpdate(
    { _id: userId, role: 'dentist' },
    { $pull: { certificates: { certificateId: certificateId } } },
    { new: true }
  ).select('-password');
};

// 🔄 Cập nhật method verify để track người xác thực
exports.verifyCertificate = async (userId, certificateId, isVerified = true, verifiedBy = null) => {
  const updateData = {
    'certificates.$.isVerified': isVerified
  };
  
  if (isVerified) {
    updateData['certificates.$.verifiedBy'] = verifiedBy;
    updateData['certificates.$.verifiedAt'] = new Date();
  } else {
    updateData['certificates.$.verifiedBy'] = null;
    updateData['certificates.$.verifiedAt'] = null;
  }

  return await User.findOneAndUpdate(
    { 
      _id: userId, 
      role: 'dentist',
      'certificates._id': certificateId
    },
    { $set: updateData },
    { new: true }
  ).select('-password');
};

exports.updateCertificateNotes = async (userId, certificateId, notes) => {
  return await User.findOneAndUpdate(
    { 
      _id: userId, 
      role: 'dentist',
      'certificates._id': certificateId
    },
    { 
      $set: {
        'certificates.$.notes': notes
      }
    },
    { new: true }
  ).select('-password');
};

// 🆕 Add certificate and update certificateNotes
exports.addCertificateAndUpdateNotes = async (userId, certificateData, certificateNotes) => {
  const updateFields = {
    $push: { certificates: certificateData }
  };
  
  if (certificateNotes !== undefined) {
    updateFields.$set = { certificateNotes: certificateNotes };
  }

  return await User.findByIdAndUpdate(
    userId,
    updateFields,
    { new: true }
  ).select('-password');
};

// 🆕 Add multiple certificates and update certificateNotes
exports.addMultipleCertificatesAndUpdateNotes = async (userId, certificatesArray, certificateNotes) => {
  const updateFields = {
    $push: { certificates: { $each: certificatesArray } }
  };
  
  if (certificateNotes !== undefined) {
    updateFields.$set = { certificateNotes: certificateNotes };
  }

  return await User.findByIdAndUpdate(
    userId,
    updateFields,
    { new: true }
  ).select('-password');
};

// 🆕 Update specific certificate by certificateId and certificateNotes
exports.updateCertificateAndNotes = async (userId, certificateId, certificateUpdateData, certificateNotes) => {
  const setFields = {};
  
  // Update certificate fields
  Object.keys(certificateUpdateData).forEach(key => {
    setFields[`certificates.$.${key}`] = certificateUpdateData[key];
  });
  
  // Update certificateNotes if provided
  if (certificateNotes !== undefined) {
    setFields.certificateNotes = certificateNotes;
  }

  return await User.findOneAndUpdate(
    { 
      _id: userId,
      'certificates.certificateId': certificateId
    },
    { 
      $set: setFields
    },
    { new: true }
  ).select('-password');
};

// Legacy method for backward compatibility
exports.addCertificate = exports.addCertificateImage;

// 🆕 GET DENTISTS WITH CERTIFICATES (for patient booking)
exports.getDentistsWithCertificates = async () => {
  return await User.find({
    role: 'dentist',
    isActive: true,
    deletedAt: null
  })
    .select('fullName avatar description certificates')
    .populate('certificates.verifiedBy', 'fullName role')
    .sort({ createdAt: -1 })
    .lean();
};

// 🆕 Compatibility alias (some code calls getDentistsWithDescription)
exports.getDentistsWithDescription = exports.getDentistsWithCertificates;

// 🔄 Update hasBeenUsed when user is assigned to slot
exports.markUserAsUsed = async (userId) => {
  return await User.findByIdAndUpdate(
    userId,
    { hasBeenUsed: true },
    { new: true }
  );
};


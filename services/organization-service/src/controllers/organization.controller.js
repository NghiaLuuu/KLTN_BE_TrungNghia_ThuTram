const orgService = require('../services/organization.service');

// INIT ONCE
exports.initOrganization = async (req, res) => {
  try {
    const organization = await orgService.initOrganization(req.user, req.body);
    res.status(201).json({ success: true, message: 'Khởi tạo Organization thành công', organization });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET/UPDATE SINGLETON
exports.getOrganization = async (req, res) => {
  try {
    const organization = await orgService.getOrganization();
    res.status(200).json({ success: true, organization });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

exports.updateOrganization = async (req, res) => {
  try {
    const organization = await orgService.updateOrganization(req.user, req.body);
    res.status(200).json({ success: true, message: 'Cập nhật thành công', organization });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Upload logo using S3 (multipart/form-data)
exports.uploadLogo = async (req, res) => {
  try {
    const file = req.file; // populated by multer
    const result = await orgService.uploadLogo(req.user, file);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// READ CONFIG
exports.getWorkConfiguration = async (req, res) => {
  try {
    const workConfig = await orgService.getWorkConfiguration();
    res.status(200).json({ success: true, workConfiguration: workConfig });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getFinancialConfiguration = async (req, res) => {
  try {
    const financialConfig = await orgService.getFinancialConfiguration();
    res.status(200).json({ success: true, financialConfiguration: financialConfig });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getCancellationPolicy = async (req, res) => {
  try {
    const policy = await orgService.getCancellationPolicy();
    res.status(200).json({ success: true, cancellationPolicy: policy });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getStaffAllocationRules = async (req, res) => {
  try {
    const rules = await orgService.getStaffAllocationRules();
    res.status(200).json({ success: true, staffAllocationRules: rules });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// UPDATE CONFIG
exports.updateWorkConfiguration = async (req, res) => {
  try {
    const result = await orgService.updateWorkConfiguration(req.user, req.body);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.toggleIsActive = async (req, res) => {
  const currentUser = req.user;

  try {
    const result = await orgService.toggleIsActive(currentUser);
    res.json(result);
  } catch (err) {
    console.error('toggleIsActive error', err);
    res.status(403).json({ message: err.message || 'Không thể cập nhật isActive' });
  }
};


exports.updateFinancialConfiguration = async (req, res) => {
  try {
    const payload =
      req.body.financialConfig ||
      req.body.financialConfiguration ||
      req.body.financial ||
      req.body;
    const result = await orgService.updateFinancialConfiguration(req.user, payload);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateCancellationPolicy = async (req, res) => {
  try {
    const payload = req.body.cancellationPolicy || req.body.cancellation || req.body;
    const result = await orgService.updateCancellationPolicy(req.user, payload);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateStaffAllocationRules = async (req, res) => {
  try {
    const payload = req.body.staffAllocationRules || req.body.staffAllocation || req.body;
    const result = await orgService.updateStaffAllocationRules(req.user, payload);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// HOLIDAYS
exports.addHoliday = async (req, res) => {
  try {
    const result = await orgService.addHoliday(req.user, req.body);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateHoliday = async (req, res) => {
  try {
    const result = await orgService.updateHoliday(req.user, req.params.holidayId, req.body);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.removeHoliday = async (req, res) => {
  try {
    const result = await orgService.removeHoliday(req.user, req.params.holidayId);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// SHIFTS
exports.updateWorkShift = async (req, res) => {
  try {
    const result = await orgService.updateWorkShift(req.user, req.params.shiftName, req.body);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.toggleWorkShift = async (req, res) => {
  try {
    const result = await orgService.toggleWorkShift(req.user, req.params.shiftName, req.body.isActive);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// VALIDATIONS & PUBLIC
exports.validateBookingDate = async (req, res) => {
  try {
    await orgService.validateBookingDate(req.body.date);
    res.status(200).json({ success: true, message: 'Ngày đặt lịch hợp lệ', date: req.body.date });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getScheduleAnalytics = async (req, res) => {
  try {
    const analytics = await orgService.getScheduleAnalytics();
    res.status(200).json({ success: true, analytics });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getPublicOrganizationInfo = async (req, res) => {
  try {
    const publicInfo = await orgService.getPublicOrganizationInfo();
    res.status(200).json({ success: true, organization: publicInfo });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi lấy thông tin phòng khám' });
  }
};

const clinicService = require('../services/clinic.service');

// Init once
exports.initClinic = async (req, res) => {
  try {
    const clinic = await clinicService.initClinic(req.user, req.body);
    res.status(201).json({ success: true, message: 'Khởi tạo Clinic thành công', clinic });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get singleton
exports.getClinic = async (req, res) => {
  try {
    const clinic = await clinicService.getClinic();
    res.status(200).json({ success: true, clinic });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
};

// Update singleton
exports.updateClinic = async (req, res) => {
  try {
    const clinic = await clinicService.updateClinic(req.user, req.body);
    res.status(200).json({ success: true, message: 'Cập nhật thành công', clinic });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Toggle isActive
exports.toggleIsActive = async (req, res) => {
  try {
    const result = await clinicService.toggleIsActive(req.user);
    res.json(result);
  } catch (err) {
    res.status(403).json({ message: err.message || 'Không thể cập nhật isActive' });
  }
};

// Public info
exports.getPublicClinicInfo = async (req, res) => {
  try {
    const publicInfo = await clinicService.getPublicClinicInfo();
    res.status(200).json({ success: true, clinic: publicInfo });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Lỗi lấy thông tin phòng khám' });
  }
};

// WORK SHIFT MANAGEMENT
// Get all work shifts
exports.getWorkShifts = async (req, res) => {
  try {
    const workShifts = await clinicService.getWorkShifts();
    res.status(200).json({ success: true, workShifts });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Create single work shift
exports.createWorkShift = async (req, res) => {
  try {
    const result = await clinicService.createWorkShift(req.user, req.body);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Create multiple work shifts
exports.createMultipleWorkShifts = async (req, res) => {
  try {
    const result = await clinicService.createMultipleWorkShifts(req.user, req.body.shifts);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update work shift by name
// clinic.controller.js
exports.updateWorkShifts = async (req, res) => {
  try {
    const clinic = await clinicService.updateWorkShifts(req.user, req.body.shifts);
    res.status(200).json({ success: true, message: 'Cập nhật ca làm việc thành công', clinic });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};


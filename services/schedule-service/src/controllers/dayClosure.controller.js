const dayClosureService = require('../services/dayClosure.service');

/**
 * @route GET /api/day-closure
 * @desc Get all day closure records with filters
 * @access Private (Admin/Manager)
 */
exports.getDayClosures = async (req, res) => {
  try {
    const { startDate, endDate, status, roomId, page, limit } = req.query;

    const filters = {
      startDate,
      endDate,
      status,
      roomId,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20
    };

    const result = await dayClosureService.getDayClosures(filters);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in getDayClosures controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy danh sách ngày đóng cửa',
      error: error.message
    });
  }
};

/**
 * @route GET /api/day-closure/:id
 * @desc Get day closure details by ID
 * @access Private (Admin/Manager)
 */
exports.getDayClosureById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await dayClosureService.getDayClosureById(id);
    
    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in getDayClosureById controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy chi tiết ngày đóng cửa',
      error: error.message
    });
  }
};

/**
 * @route GET /api/day-closure/stats
 * @desc Get statistics for day closures
 * @access Private (Admin/Manager)
 */
exports.getDayClosureStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const result = await dayClosureService.getDayClosureStats(startDate, endDate);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in getDayClosureStats controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy thống kê ngày đóng cửa',
      error: error.message
    });
  }
};

/**
 * @route GET /api/day-closure/:id/patients
 * @desc Get cancelled patients for a specific closure
 * @access Private (Admin/Manager)
 */
exports.getCancelledPatients = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await dayClosureService.getCancelledPatients(id);
    
    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in getCancelledPatients controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy danh sách bệnh nhân bị hủy',
      error: error.message
    });
  }
};

/**
 * @route GET /api/day-closure/patients/all
 * @desc Get all cancelled patients with filters
 * @access Private (Admin/Manager/Dentist/Nurse)
 * @query startDate, endDate, roomId, dentistId, patientName, page, limit
 */
exports.getAllCancelledPatients = async (req, res) => {
  try {
    const { startDate, endDate, roomId, dentistId, patientName, page, limit } = req.query;

    const filters = {
      startDate,
      endDate,
      roomId,
      dentistId,
      patientName,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50
    };

    const result = await dayClosureService.getAllCancelledPatients(filters);
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in getAllCancelledPatients controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi khi lấy danh sách bệnh nhân bị hủy',
      error: error.message
    });
  }
};

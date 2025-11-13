const { body, query, validationResult } = require('express-validator');

// Validation middleware để check kết quả validation
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu không hợp lệ',
      errors: errors.array()
    });
  }
  next();
};

// Validation cho thống kê theo khoảng thời gian
const dateRangeValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate phải là ngày hợp lệ (ISO 8601)'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate phải là ngày hợp lệ (ISO 8601)'),
  query('period')
    .optional()
    .isIn(['day', 'week', 'month', 'quarter', 'year'])
    .withMessage('period phải là: day, week, month, quarter, year'),
];

// Validation cho thống kê dashboard
const dashboardValidation = [
  query('timeframe')
    .optional()
    .isIn(['today', 'week', 'month', 'quarter', 'year'])
    .withMessage('timeframe phải là: today, week, month, quarter, year'),
];

// Validation cho thống kê nha sĩ
const dentistStatsValidation = [
  query('dentistId')
    .optional()
    .isMongoId()
    .withMessage('dentistId phải là ObjectId hợp lệ'),
  ...dateRangeValidation
];

// Validation cho thống kê dịch vụ
const serviceStatsValidation = [
  query('serviceType')
    .optional()
    .isIn(['all', 'treatment', 'consultation', 'surgery', 'cleaning'])
    .withMessage('serviceType không hợp lệ'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit phải là số nguyên từ 1 đến 100'),
  ...dateRangeValidation
];

// Validation cho thống kê doanh thu
const revenueStatsValidation = [
  query('groupBy')
    .optional()
    .isIn(['day', 'week', 'month', 'quarter', 'year'])
    .withMessage('groupBy phải là: day, week, month, quarter, year'),
  query('compareWithPrevious')
    .optional()
    .isBoolean()
    .withMessage('compareWithPrevious phải là boolean'),
  query('dentistId')
    .optional()
    .isMongoId()
    .withMessage('dentistId phải là ObjectId hợp lệ'),
  query('serviceId')
    .optional()
    .isMongoId()
    .withMessage('serviceId phải là ObjectId hợp lệ'),
  ...dateRangeValidation
];

// Validation cho thống kê bệnh nhân
const patientStatsValidation = [
  query('ageGroup')
    .optional()
    .isIn(['all', 'child', 'teen', 'adult', 'senior'])
    .withMessage('ageGroup phải là: all, child, teen, adult, senior'),
  query('gender')
    .optional()
    .isIn(['all', 'male', 'female', 'other'])
    .withMessage('gender phải là: all, male, female, other'),
  ...dateRangeValidation
];

// Validation cho thống kê nhân viên
const staffStatsValidation = [
  query('role')
    .optional()
    .isIn(['all', 'dentist', 'nurse', 'receptionist'])
    .withMessage('role phải là: all, dentist, nurse, receptionist'),
  query('includeInactive')
    .optional()
    .isBoolean()
    .withMessage('includeInactive phải là boolean'),
  ...dateRangeValidation
];

// Validation cho thống kê hiệu suất phòng khám
const clinicUtilizationValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate phải là ngày hợp lệ (ISO 8601)'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate phải là ngày hợp lệ (ISO 8601)'),
  query('roomIds')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') return true;
      if (Array.isArray(value)) return true;
      throw new Error('roomIds phải là string hoặc array');
    }),
  query('timeRange')
    .optional()
    .isIn(['day', 'month', 'quarter', 'year'])
    .withMessage('timeRange phải là: day, month, quarter, year'),
  query('shiftName')
    .optional()
    .isIn(['Ca Sáng', 'Ca Chiều', 'Ca Tối'])
    .withMessage('shiftName không hợp lệ')
];

module.exports = {
  validate,
  dateRangeValidation,
  dashboardValidation,
  dentistStatsValidation,
  serviceStatsValidation,
  revenueStatsValidation,
  patientStatsValidation,
  staffStatsValidation,
  clinicUtilizationValidation
};
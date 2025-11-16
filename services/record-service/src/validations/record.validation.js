const { body, param, query } = require('express-validator');

const createRecordValidation = [
  body('serviceId')
    .notEmpty()
    .withMessage('Service ID là bắt buộc')
    .isMongoId()
    .withMessage('Service ID không hợp lệ'),
  
  body('serviceName')
    .notEmpty()
    .withMessage('Tên dịch vụ là bắt buộc')
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên dịch vụ phải từ 2 đến 200 ký tự')
    .trim(),
  
  body('dentistId')
    .notEmpty()
    .withMessage('Dentist ID là bắt buộc')
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  body('dentistName')
    .notEmpty()
    .withMessage('Tên nha sĩ là bắt buộc')
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên nha sĩ phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('type')
    .notEmpty()
    .withMessage('Loại hồ sơ là bắt buộc')
    .isIn(['exam', 'treatment'])
    .withMessage('Loại hồ sơ phải là exam hoặc treatment'),
  
  // Patient validation - either patientId or patientInfo is required
  body('patientId')
    .optional()
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  body('patientInfo.name')
    .if(body('patientId').not().exists())
    .notEmpty()
    .withMessage('Tên bệnh nhân là bắt buộc khi không có Patient ID')
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên bệnh nhân phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('patientInfo.phone')
    .if(body('patientId').not().exists())
    .notEmpty()
    .withMessage('Số điện thoại là bắt buộc khi không có Patient ID')
    .matches(/^[0-9]{10,11}$/)
    .withMessage('Số điện thoại không hợp lệ (10-11 số)'),
  
  body('patientInfo.birthYear')
    .if(body('patientId').not().exists())
    .notEmpty()
    .withMessage('Năm sinh là bắt buộc khi không có Patient ID')
    .isInt({ min: 1900, max: new Date().getFullYear() })
    .withMessage('Năm sinh không hợp lệ'),
  
  body('patientInfo.gender')
    .optional()
    .isIn(['male', 'female', 'other'])
    .withMessage('Giới tính không hợp lệ'),
  
  body('patientInfo.address')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Địa chỉ không được quá 200 ký tự')
    .trim(),
  
  // Optional fields
  body('appointmentId')
    .optional()
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('roomId')
    .optional()
    .isMongoId()
    .withMessage('Room ID không hợp lệ'),
  
  body('roomName')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Tên phòng không được quá 100 ký tự')
    .trim(),
  
  body('diagnosis')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Chẩn đoán không được quá 1000 ký tự')
    .trim(),
  
  body('indications')
    .optional()
    .isArray()
    .withMessage('Indications phải là mảng'),
  
  body('indications.*')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Mỗi indication không được quá 200 ký tự')
    .trim(),
  
  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Ghi chú không được quá 1000 ký tự')
    .trim(),
  
  body('priority')
    .optional()
    .isIn(['low', 'normal', 'high', 'urgent'])
    .withMessage('Mức độ ưu tiên không hợp lệ'),
  
  body('totalCost')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Tổng chi phí phải là số không âm')
];

const updateRecordValidation = [
  param('id')
    .isMongoId()
    .withMessage('Record ID không hợp lệ')
  // ✅ No field validation - accept any data
];

const recordIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('Record ID không hợp lệ')
];

// Validation for queue operations that use :recordId parameter
const queueRecordIdValidation = [
  param('recordId')
    .isMongoId()
    .withMessage('Record ID không hợp lệ')
];

const recordCodeValidation = [
  param('code')
    .notEmpty()
    .withMessage('Record code là bắt buộc')
    .matches(/^(EX|TR)\d{8}\d{3}$/)
    .withMessage('Record code không đúng định dạng')
];

const updateStatusValidation = [
  param('id')
    .isMongoId()
    .withMessage('Record ID không hợp lệ'),
  
  body('status')
    .notEmpty()
    .withMessage('Trạng thái là bắt buộc')
    .isIn(['pending', 'in-progress', 'completed', 'cancelled'])
    .withMessage('Trạng thái không hợp lệ')
];

const addPrescriptionValidation = [
  param('id')
    .isMongoId()
    .withMessage('Record ID không hợp lệ')
  // ✅ No validation - accept empty or incomplete prescription data
];

const updateTreatmentIndicationValidation = [
  param('id')
    .isMongoId()
    .withMessage('Record ID không hợp lệ'),
  
  param('indicationId')
    .isMongoId()
    .withMessage('Indication ID không hợp lệ'),
  
  body('used')
    .isBoolean()
    .withMessage('Used phải là boolean'),
  
  body('notes')
    .optional()
    .isLength({ max: 300 })
    .withMessage('Ghi chú không được quá 300 ký tự')
    .trim()
];

const listRecordsValidation = [
  query('patientId')
    .optional()
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  query('dentistId')
    .optional()
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  query('status')
    .optional()
    .isIn(['pending', 'in-progress', 'completed', 'cancelled'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('type')
    .optional()
    .isIn(['exam', 'treatment'])
    .withMessage('Loại hồ sơ không hợp lệ'),
  
  query('dateFrom')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('dateTo')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ'),
  
  query('search')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Từ khóa tìm kiếm phải từ 1 đến 100 ký tự')
    .trim()
];

const searchRecordsValidation = [
  query('q')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Từ khóa tìm kiếm phải từ 1 đến 100 ký tự')
    .trim()
];

const patientIdValidation = [
  param('patientId')
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit phải là số nguyên từ 1 đến 100')
];

const dentistIdValidation = [
  param('dentistId')
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ')
];

const statisticsValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ')
];

module.exports = {
  createRecordValidation,
  updateRecordValidation,
  recordIdValidation,
  queueRecordIdValidation,
  recordCodeValidation,
  updateStatusValidation,
  addPrescriptionValidation,
  updateTreatmentIndicationValidation,
  listRecordsValidation,
  searchRecordsValidation,
  patientIdValidation,
  dentistIdValidation,
  statisticsValidation
};
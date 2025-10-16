const { body, param, query } = require('express-validator');

/**
 * Validation for Reserve Appointment (Online Booking)
 * và Create Offline Appointment
 * 
 * Payload đơn giản với single service (không phải array)
 */
const reserveAppointmentValidation = [
  // Service fields (single service, not array)
  body('serviceId')
    .notEmpty()
    .withMessage('Service ID là bắt buộc')
    .isMongoId()
    .withMessage('Service ID không hợp lệ'),
  
  // serviceAddOnId is OPTIONAL - some services don't have addons
  body('serviceAddOnId')
    .optional({ nullable: true, checkFalsy: true })
    .isMongoId()
    .withMessage('Service Add-On ID không hợp lệ'),
  
  // Dentist
  body('dentistId')
    .notEmpty()
    .withMessage('Dentist ID là bắt buộc')
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  // Slot IDs array
  body('slotIds')
    .isArray({ min: 1 })
    .withMessage('Cần chọn ít nhất một slot'),
  
  body('slotIds.*')
    .isMongoId()
    .withMessage('Slot ID không hợp lệ'),
  
  // Appointment date
  body('date')
    .notEmpty()
    .withMessage('Ngày hẹn là bắt buộc')
    .isISO8601()
    .withMessage('Ngày không hợp lệ (YYYY-MM-DD)')
    .custom((value) => {
      const appointmentDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (appointmentDate < today) {
        throw new Error('Ngày hẹn không thể là quá khứ');
      }
      return true;
    }),
  
  // Patient info - OPTIONAL for logged-in users (will auto-fill from auth)
  // REQUIRED for guest users
  body('patientInfo')
    .optional({ nullable: true })
    .isObject()
    .withMessage('Thông tin bệnh nhân phải là object'),
  
  body('patientInfo.name')
    .optional({ nullable: true })
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên bệnh nhân phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('patientInfo.phone')
    .optional({ nullable: true })
    .matches(/^[0-9]{10,11}$/)
    .withMessage('Số điện thoại không hợp lệ (10-11 số)'),
  
  body('patientInfo.birthYear')
    .optional({ nullable: true })
    .isInt({ min: 1900, max: new Date().getFullYear() })
    .withMessage('Năm sinh không hợp lệ'),
  
  body('patientInfo.email')
    .optional()
    .isEmail()
    .withMessage('Email không hợp lệ')
    .normalizeEmail(),
  
  // Optional fields
  body('patientId')
    .optional()
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Ghi chú không được quá 500 ký tự')
    .trim()
];

/**
 * Validation for Cancel Appointment
 */
const cancelAppointmentValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('reason')
    .notEmpty()
    .withMessage('Lý do hủy là bắt buộc')
    .isLength({ min: 5, max: 300 })
    .withMessage('Lý do hủy phải từ 5 đến 300 ký tự')
    .trim()
];

/**
 * Validation for Complete Appointment
 */
const completeAppointmentValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('actualDuration')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Thời gian thực tế phải là số nguyên dương'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Ghi chú không được quá 500 ký tự')
    .trim()
];

/**
 * Validation for Check-in Appointment
 */
const checkInAppointmentValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ')
];

/**
 * Validation for Get Appointment by Code
 */
const appointmentCodeValidation = [
  param('appointmentCode')
    .notEmpty()
    .withMessage('Appointment code là bắt buộc')
    .matches(/^AP\d{6}-\d{8}$/)
    .withMessage('Appointment code không đúng định dạng (AP000001-03102025)')
];

/**
 * Validation for Get Appointments by Patient
 */
const patientAppointmentsValidation = [
  param('patientId')
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  query('status')
    .optional()
    .isIn(['confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('dateFrom')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('dateTo')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ')
];

/**
 * Validation for Get Appointments by Dentist
 */
const dentistAppointmentsValidation = [
  param('dentistId')
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  query('status')
    .optional()
    .isIn(['confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('date')
    .optional()
    .isISO8601()
    .withMessage('Ngày không hợp lệ')
];

/**
 * Validation for Get Available Slots
 */
const availableSlotsValidation = [
  query('dentistId')
    .notEmpty()
    .withMessage('Dentist ID là bắt buộc')
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  query('date')
    .notEmpty()
    .withMessage('Ngày là bắt buộc')
    .isISO8601()
    .withMessage('Ngày không hợp lệ (YYYY-MM-DD)'),
  
  query('serviceDuration')
    .notEmpty()
    .withMessage('Thời gian dịch vụ là bắt buộc')
    .isInt({ min: 15, max: 480 })
    .withMessage('Thời gian dịch vụ phải từ 15 đến 480 phút')
];

module.exports = {
  reserveAppointmentValidation,
  cancelAppointmentValidation,
  completeAppointmentValidation,
  checkInAppointmentValidation,
  appointmentCodeValidation,
  patientAppointmentsValidation,
  dentistAppointmentsValidation,
  availableSlotsValidation
};

const { body, param, query } = require('express-validator');

const createAppointmentValidation = [
  // Services validation
  body('services')
    .isArray({ min: 1 })
    .withMessage('Cần chọn ít nhất một dịch vụ'),
  
  body('services.*.serviceId')
    .isMongoId()
    .withMessage('Service ID không hợp lệ'),
  
  body('services.*.serviceName')
    .notEmpty()
    .withMessage('Tên dịch vụ là bắt buộc')
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên dịch vụ phải từ 2 đến 200 ký tự')
    .trim(),
  
  body('services.*.estimatedDuration')
    .optional()
    .isInt({ min: 15, max: 480 })
    .withMessage('Thời gian dự kiến phải từ 15 đến 480 phút'),
  
  body('services.*.price')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Giá dịch vụ phải là số không âm'),

  // Slots validation
  body('slots')
    .isArray({ min: 1 })
    .withMessage('Cần chọn ít nhất một khung thời gian'),
  
  body('slots.*.slotId')
    .isMongoId()
    .withMessage('Slot ID không hợp lệ'),
  
  body('slots.*.date')
    .isISO8601()
    .withMessage('Ngày không hợp lệ')
    .custom((value) => {
      const appointmentDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (appointmentDate < today) {
        throw new Error('Ngày hẹn không thể là quá khứ');
      }
      return true;
    }),
  
  body('slots.*.startTime')
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Giờ bắt đầu không hợp lệ (HH:MM)'),
  
  body('slots.*.endTime')
    .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Giờ kết thúc không hợp lệ (HH:MM)'),
  
  body('slots.*.roomId')
    .optional()
    .isMongoId()
    .withMessage('Room ID không hợp lệ'),

  // Patient info validation
  body('patientInfo.name')
    .notEmpty()
    .withMessage('Tên bệnh nhân là bắt buộc')
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên bệnh nhân phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('patientInfo.phone')
    .notEmpty()
    .withMessage('Số điện thoại là bắt buộc')
    .matches(/^[0-9]{10,11}$/)
    .withMessage('Số điện thoại không hợp lệ (10-11 số)'),
  
  body('patientInfo.birthYear')
    .notEmpty()
    .withMessage('Năm sinh là bắt buộc')
    .isInt({ min: 1900, max: new Date().getFullYear() })
    .withMessage('Năm sinh không hợp lệ'),
  
  body('patientInfo.gender')
    .optional()
    .isIn(['male', 'female', 'other'])
    .withMessage('Giới tính không hợp lệ'),
  
  body('patientInfo.email')
    .optional()
    .isEmail()
    .withMessage('Email không hợp lệ')
    .normalizeEmail(),
  
  body('patientInfo.address')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Địa chỉ không được quá 200 ký tự')
    .trim(),

  // Appointment details
  body('type')
    .notEmpty()
    .withMessage('Loại cuộc hẹn là bắt buộc')
    .isIn(['exam', 'treatment', 'consultation', 'followup'])
    .withMessage('Loại cuộc hẹn không hợp lệ'),
  
  body('priority')
    .optional()
    .isIn(['low', 'normal', 'high', 'urgent'])
    .withMessage('Mức độ ưu tiên không hợp lệ'),
  
  body('bookingChannel')
    .optional()
    .isIn(['online', 'offline'])
    .withMessage('Kênh đặt lịch không hợp lệ'),

  // Optional fields
  body('patientId')
    .optional()
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  body('assignedDentistId')
    .optional()
    .isMongoId()
    .withMessage('Assigned Dentist ID không hợp lệ'),
  
  body('assignedDentistName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên nha sĩ phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('preferredDentistId')
    .optional()
    .isMongoId()
    .withMessage('Preferred Dentist ID không hợp lệ'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Ghi chú không được quá 500 ký tự')
    .trim(),
  
  body('specialRequirements')
    .optional()
    .isLength({ max: 300 })
    .withMessage('Yêu cầu đặc biệt không được quá 300 ký tự')
    .trim(),
  
  body('reasonForVisit')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Lý do khám không được quá 200 ký tự')
    .trim()
];

const updateAppointmentValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('services')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Danh sách dịch vụ phải có ít nhất một phần tử'),
  
  body('services.*.serviceId')
    .optional()
    .isMongoId()
    .withMessage('Service ID không hợp lệ'),
  
  body('services.*.serviceName')
    .optional()
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên dịch vụ phải từ 2 đến 200 ký tự')
    .trim(),
  
  body('slots')
    .optional()
    .isArray({ min: 1 })
    .withMessage('Danh sách slot phải có ít nhất một phần tử'),
  
  body('assignedDentistId')
    .optional()
    .isMongoId()
    .withMessage('Assigned Dentist ID không hợp lệ'),
  
  body('assignedDentistName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên nha sĩ phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('priority')
    .optional()
    .isIn(['low', 'normal', 'high', 'urgent'])
    .withMessage('Mức độ ưu tiên không hợp lệ'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Ghi chú không được quá 500 ký tự')
    .trim(),
  
  body('specialRequirements')
    .optional()
    .isLength({ max: 300 })
    .withMessage('Yêu cầu đặc biệt không được quá 300 ký tự')
    .trim()
];

const appointmentIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ')
];

const appointmentCodeValidation = [
  param('code')
    .notEmpty()
    .withMessage('Appointment code là bắt buộc')
    .matches(/^AP\d{6}\d{4}$/)
    .withMessage('Appointment code không đúng định dạng')
];

const updateStatusValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('status')
    .notEmpty()
    .withMessage('Trạng thái là bắt buộc')
    .isIn(['pending', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  body('cancellationReason')
    .if(body('status').equals('cancelled'))
    .notEmpty()
    .withMessage('Lý do hủy là bắt buộc khi hủy lịch hẹn')
    .isLength({ max: 200 })
    .withMessage('Lý do hủy không được quá 200 ký tự')
    .trim(),
  
  body('actualDuration')
    .if(body('status').equals('completed'))
    .optional()
    .isInt({ min: 1 })
    .withMessage('Thời gian thực tế phải là số nguyên dương')
];

const assignDentistValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
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
    .trim()
];

const cancelAppointmentValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('reason')
    .notEmpty()
    .withMessage('Lý do hủy là bắt buộc')
    .isLength({ min: 5, max: 200 })
    .withMessage('Lý do hủy phải từ 5 đến 200 ký tự')
    .trim()
];

const rejectCancellationValidation = [
  param('appointmentId')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('reason')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Lý do từ chối không được quá 200 ký tự')
    .trim()
];

const listAppointmentsValidation = [
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('type')
    .optional()
    .isIn(['exam', 'treatment', 'consultation', 'followup'])
    .withMessage('Loại cuộc hẹn không hợp lệ'),
  
  query('dentistId')
    .optional()
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  query('patientId')
    .optional()
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  query('priority')
    .optional()
    .isIn(['low', 'normal', 'high', 'urgent'])
    .withMessage('Mức độ ưu tiên không hợp lệ'),
  
  query('bookingChannel')
    .optional()
    .isIn(['online', 'offline'])
    .withMessage('Kênh đặt lịch không hợp lệ'),
  
  query('dateFrom')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('dateTo')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ'),
  
  query('phone')
    .optional()
    .matches(/^[0-9]{10,11}$/)
    .withMessage('Số điện thoại không hợp lệ'),
  
  query('patientName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên bệnh nhân phải từ 2 đến 100 ký tự')
    .trim(),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Số trang phải là số nguyên dương'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải từ 1 đến 100'),
  
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'slots.date', 'priority'])
    .withMessage('Trường sắp xếp không hợp lệ'),
  
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Thứ tự sắp xếp phải là asc hoặc desc')
];

const searchAppointmentsValidation = [
  query('q')
    .notEmpty()
    .withMessage('Từ khóa tìm kiếm là bắt buộc')
    .isLength({ min: 1, max: 100 })
    .withMessage('Từ khóa tìm kiếm phải từ 1 đến 100 ký tự')
    .trim(),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Số trang phải là số nguyên dương'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải từ 1 đến 100')
];

const patientIdValidation = [
  param('patientId')
    .isMongoId()
    .withMessage('Patient ID không hợp lệ'),
  
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ')
];

const dentistIdValidation = [
  param('dentistId')
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ'),
  
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('date')
    .optional()
    .isISO8601()
    .withMessage('Ngày không hợp lệ')
];

const phoneValidation = [
  param('phone')
    .matches(/^[0-9]{10,11}$/)
    .withMessage('Số điện thoại không hợp lệ (10-11 số)'),
  
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'checked-in', 'in-progress', 'completed', 'cancelled', 'no-show'])
    .withMessage('Trạng thái không hợp lệ'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Giới hạn phải từ 1 đến 50')
];

const statisticsValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),
  
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ'),
  
  query('dentistId')
    .optional()
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ')
];

const dailyScheduleValidation = [
  query('date')
    .optional()
    .isISO8601()
    .withMessage('Ngày không hợp lệ'),
  
  query('dentistId')
    .optional()
    .isMongoId()
    .withMessage('Dentist ID không hợp lệ')
];

const updateDepositValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('amount')
    .notEmpty()
    .withMessage('Số tiền đặt cọc là bắt buộc')
    .isFloat({ min: 0 })
    .withMessage('Số tiền đặt cọc phải là số không âm'),
  
  body('status')
    .notEmpty()
    .withMessage('Trạng thái đặt cọc là bắt buộc')
    .isIn(['none', 'pending', 'paid', 'refunded'])
    .withMessage('Trạng thái đặt cọc không hợp lệ')
];

const addNotesValidation = [
  param('id')
    .isMongoId()
    .withMessage('Appointment ID không hợp lệ'),
  
  body('notes')
    .notEmpty()
    .withMessage('Ghi chú là bắt buộc')
    .isLength({ min: 1, max: 500 })
    .withMessage('Ghi chú phải từ 1 đến 500 ký tự')
    .trim()
];

module.exports = {
  createAppointmentValidation,
  updateAppointmentValidation,
  appointmentIdValidation,
  appointmentCodeValidation,
  updateStatusValidation,
  assignDentistValidation,
  cancelAppointmentValidation,
  rejectCancellationValidation,
  listAppointmentsValidation,
  searchAppointmentsValidation,
  patientIdValidation,
  dentistIdValidation,
  phoneValidation,
  statisticsValidation,
  dailyScheduleValidation,
  updateDepositValidation,
  addNotesValidation
};
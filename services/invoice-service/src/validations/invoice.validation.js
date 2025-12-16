const { body, param, query, validationResult } = require('express-validator');
const { InvoiceStatus, InvoiceType } = require('../models/invoice.model');
const { ServiceType, ServiceCategory } = require('../models/invoiceDetail.model');

// ============ XỬ LÝ LỖI KIỂM TRA ============
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));

    return res.status(400).json({
      success: false,
      message: "Dữ liệu không hợp lệ",
      errors: errorMessages
    });
  }
  next();
};

// ============ CÁC SCHEMA KIỂM TRA HÓA ĐƠN ============
const validateCreateInvoice = [
  body('appointmentId')
    .optional()
    .isMongoId()
    .withMessage('ID cuộc hẹn không hợp lệ'),

  body('patientId')
    .optional()
    .isMongoId()
    .withMessage('ID bệnh nhân không hợp lệ'),

  body('patientInfo')
    .optional()
    .isObject()
    .withMessage('Thông tin bệnh nhân phải là object'),

  body('patientInfo.name')
    .if(body('patientInfo').exists())
    .notEmpty()
    .withMessage('Tên bệnh nhân không được để trống')
    .isLength({ min: 2, max: 100 })
    .withMessage('Tên bệnh nhân phải từ 2-100 ký tự'),

  body('patientInfo.phone')
    .if(body('patientInfo').exists())
    .notEmpty()
    .withMessage('Số điện thoại không được để trống')
    .matches(/^[0-9]{10,11}$/)
    .withMessage('Số điện thoại không hợp lệ'),

  body('patientInfo.email')
    .if(body('patientInfo').exists())
    .optional()
    .isEmail()
    .withMessage('Email không hợp lệ'),

  body('type')
    .optional()
    .isIn(Object.values(InvoiceType))
    .withMessage(`Loại hóa đơn phải là một trong: ${Object.values(InvoiceType).join(', ')}`),

  body('status')
    .optional()
    .isIn(Object.values(InvoiceStatus))
    .withMessage(`Trạng thái hóa đơn phải là một trong: ${Object.values(InvoiceStatus).join(', ')}`),

  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày đến hạn không hợp lệ')
    .custom((value) => {
      const dueDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (dueDate < today) {
        throw new Error('Ngày đến hạn không được nhỏ hơn ngày hiện tại');
      }
      return true;
    }),

  body('taxInfo')
    .optional()
    .isObject()
    .withMessage('Thông tin thuế phải là object'),

  body('taxInfo.taxRate')
    .if(body('taxInfo').exists())
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tỷ lệ thuế phải từ 0-100%'),

  body('taxInfo.taxAmount')
    .if(body('taxInfo').exists())
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Số tiền thuế không được âm'),

  body('discountInfo')
    .optional()
    .isObject()
    .withMessage('Thông tin giảm giá phải là object'),

  body('discountInfo.discountType')
    .if(body('discountInfo').exists())
    .optional()
    .isIn(['percentage', 'fixed'])
    .withMessage('Loại giảm giá phải là percentage hoặc fixed'),

  body('discountInfo.discountValue')
    .if(body('discountInfo').exists())
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Giá trị giảm giá không được âm'),

  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Ghi chú không được quá 1000 ký tự'),

  body('details')
    .optional()
    .isArray()
    .withMessage('Chi tiết hóa đơn phải là mảng'),

  body('details.*.serviceId')
    .if(body('details').exists())
    .optional()
    .isMongoId()
    .withMessage('ID dịch vụ không hợp lệ'),

  body('details.*.serviceType')
    .if(body('details').exists())
    .optional()
    .isIn(Object.values(ServiceType))
    .withMessage(`Loại dịch vụ phải là một trong: ${Object.values(ServiceType).join(', ')}`),

  body('details.*.quantity')
    .if(body('details').exists())
    .isInt({ min: 1 })
    .withMessage('Số lượng phải là số nguyên dương'),

  body('details.*.unitPrice')
    .if(body('details').exists())
    .isFloat({ min: 0 })
    .withMessage('Đơn giá không được âm'),

  handleValidationErrors
];

const validateUpdateInvoice = [
  param('id')
    .isMongoId()
    .withMessage('ID hóa đơn không hợp lệ'),

  body('status')
    .optional()
    .isIn(Object.values(InvoiceStatus))
    .withMessage(`Trạng thái hóa đơn phải là một trong: ${Object.values(InvoiceStatus).join(', ')}`),

  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày đến hạn không hợp lệ'),

  body('taxInfo.taxRate')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tỷ lệ thuế phải từ 0-100%'),

  body('taxInfo.taxAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Số tiền thuế không được âm'),

  body('discountInfo.discountType')
    .optional()
    .isIn(['percentage', 'fixed'])
    .withMessage('Loại giảm giá phải là percentage hoặc fixed'),

  body('discountInfo.discountValue')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Giá trị giảm giá không được âm'),

  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Ghi chú không được quá 1000 ký tự'),

  handleValidationErrors
];

// ============ CÁC SCHEMA KIỂM TRA THANH TOÁN ============
const validatePaymentData = [
  body('invoiceId')
    .notEmpty()
    .withMessage('ID hóa đơn không được để trống')
    .isMongoId()
    .withMessage('ID hóa đơn không hợp lệ'),

  body('paymentId')
    .notEmpty()
    .withMessage('ID thanh toán không được để trống')
    .isMongoId()
    .withMessage('ID thanh toán không hợp lệ'),

  body('amount')
    .notEmpty()
    .withMessage('Số tiền không được để trống')
    .isFloat({ min: 0.01 })
    .withMessage('Số tiền phải lớn hơn 0'),

  body('paymentMethod')
    .optional()
    .isIn(['cash', 'credit_card', 'debit_card', 'momo', 'zalopay', 'vnpay', 'bank_transfer', 'insurance'])
    .withMessage('Phương thức thanh toán không hợp lệ'),

  handleValidationErrors
];

// ============ CÁC SCHEMA KIỂM TRA CHI TIẾT HÓA ĐƠN ============
const validateCreateInvoiceDetail = [
  param('invoiceId')
    .isMongoId()
    .withMessage('ID hóa đơn không hợp lệ'),

  body('serviceId')
    .optional()
    .isMongoId()
    .withMessage('ID dịch vụ không hợp lệ'),

  body('serviceType')
    .optional()
    .isIn(Object.values(ServiceType))
    .withMessage(`Loại dịch vụ phải là một trong: ${Object.values(ServiceType).join(', ')}`),

  body('serviceCategory')
    .optional()
    .isIn(Object.values(ServiceCategory))
    .withMessage(`Danh mục dịch vụ phải là một trong: ${Object.values(ServiceCategory).join(', ')}`),

  body('quantity')
    .notEmpty()
    .withMessage('Số lượng không được để trống')
    .isInt({ min: 1 })
    .withMessage('Số lượng phải là số nguyên dương'),

  body('unitPrice')
    .notEmpty()
    .withMessage('Đơn giá không được để trống')
    .isFloat({ min: 0 })
    .withMessage('Đơn giá không được âm'),

  body('serviceInfo.name')
    .if(body('serviceInfo').exists())
    .notEmpty()
    .withMessage('Tên dịch vụ không được để trống')
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên dịch vụ phải từ 2-200 ký tự'),

  body('toothInfo.toothNumbers')
    .optional()
    .isArray()
    .withMessage('Số răng phải là mảng'),

  body('toothInfo.toothNumbers.*')
    .if(body('toothInfo.toothNumbers').exists())
    .isInt({ min: 1, max: 48 })
    .withMessage('Số răng phải từ 1-48'),

  body('discountInfo.discountType')
    .optional()
    .isIn(['percentage', 'fixed'])
    .withMessage('Loại giảm giá phải là percentage hoặc fixed'),

  body('discountInfo.discountValue')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Giá trị giảm giá không được âm'),

  handleValidationErrors
];

const validateUpdateInvoiceDetail = [
  param('detailId')
    .isMongoId()
    .withMessage('ID chi tiết hóa đơn không hợp lệ'),

  body('quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Số lượng phải là số nguyên dương'),

  body('unitPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Đơn giá không được âm'),

  body('discountInfo.discountValue')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Giá trị giảm giá không được âm'),

  body('treatmentInfo.progressPercentage')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tiến trình điều trị phải từ 0-100%'),

  handleValidationErrors
];

// ============ KIỂM TRA TÌM KIẾM & LỌC ============
const validateSearchParams = [
  query('q')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Từ khóa tìm kiếm phải từ 1-100 ký tự'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Số trang phải là số nguyên dương'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải từ 1-100'),

  query('status')
    .optional()
    .isIn(Object.values(InvoiceStatus))
    .withMessage(`Trạng thái phải là một trong: ${Object.values(InvoiceStatus).join(', ')}`),

  query('dateFrom')
    .optional()
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),

  query('dateTo')
    .optional()
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ'),

  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'dueDate', 'totalAmount', 'invoiceNumber'])
    .withMessage('Trường sắp xếp không hợp lệ'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Thứ tự sắp xếp phải là asc hoặc desc'),

  handleValidationErrors
];

// ============ CÁC SCHEMA KIỂM TRA ĐIỀU TRỊ ============
const validateTreatmentCompletion = [
  param('detailId')
    .isMongoId()
    .withMessage('ID chi tiết không hợp lệ'),

  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Ghi chú không được quá 500 ký tự'),

  body('requiresFollowUp')
    .optional()
    .isBoolean()
    .withMessage('Yêu cầu tái khám phải là boolean'),

  body('followUpDate')
    .if(body('requiresFollowUp').equals(true))
    .notEmpty()
    .withMessage('Ngày tái khám không được để trống khi yêu cầu tái khám')
    .isISO8601()
    .withMessage('Ngày tái khám không hợp lệ')
    .custom((value) => {
      const followUpDate = new Date(value);
      const today = new Date();
      
      if (followUpDate <= today) {
        throw new Error('Ngày tái khám phải sau ngày hiện tại');
      }
      return true;
    }),

  handleValidationErrors
];

const validateTreatmentProgress = [
  param('detailId')
    .isMongoId()
    .withMessage('ID chi tiết không hợp lệ'),

  body('progressPercentage')
    .notEmpty()
    .withMessage('Tiến trình không được để trống')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tiến trình phải từ 0-100%'),

  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Ghi chú không được quá 500 ký tự'),

  body('nextAppointmentDate')
    .optional()
    .isISO8601()
    .withMessage('Ngày hẹn tiếp theo không hợp lệ')
    .custom((value) => {
      const nextDate = new Date(value);
      const today = new Date();
      
      if (nextDate <= today) {
        throw new Error('Ngày hẹn tiếp theo phải sau ngày hiện tại');
      }
      return true;
    }),

  handleValidationErrors
];

// ============ KIỂM TRA THỐNG KÊ ============
const validateStatisticsParams = [
  query('startDate')
    .notEmpty()
    .withMessage('Ngày bắt đầu không được để trống')
    .isISO8601()
    .withMessage('Ngày bắt đầu không hợp lệ'),

  query('endDate')
    .notEmpty()
    .withMessage('Ngày kết thúc không được để trống')
    .isISO8601()
    .withMessage('Ngày kết thúc không hợp lệ')
    .custom((value, { req }) => {
      const endDate = new Date(value);
      const startDate = new Date(req.query.startDate);
      
      if (endDate <= startDate) {
        throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
      }
      
      const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
      if (daysDiff > 365) {
        throw new Error('Khoảng thời gian không được quá 365 ngày');
      }
      
      return true;
    }),

  query('groupBy')
    .optional()
    .isIn(['day', 'week', 'month', 'year', 'status'])
    .withMessage('Nhóm thống kê phải là day, week, month, year hoặc status'),

  handleValidationErrors
];

module.exports = {
  validateCreateInvoice,
  validateUpdateInvoice,
  validatePaymentData,
  validateCreateInvoiceDetail,
  validateUpdateInvoiceDetail,
  validateSearchParams,
  validateTreatmentCompletion,
  validateTreatmentProgress,
  validateStatisticsParams,
  handleValidationErrors
};
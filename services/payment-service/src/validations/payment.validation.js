const { body, param, query } = require('express-validator');
const { PaymentMethod, PaymentStatus, PaymentType } = require('../models/payment.model');

// ============ CREATE PAYMENT VALIDATIONS ============
const createPaymentValidation = [
  body('amount')
    .isFloat({ min: 1000 })
    .withMessage('Số tiền thanh toán phải ít nhất 1,000 VND'),

  body('method')
    .isIn(Object.values(PaymentMethod))
    .withMessage('Phương thức thanh toán không hợp lệ'),

  body('type')
    .optional()
    .isIn(Object.values(PaymentType))
    .withMessage('Loại thanh toán không hợp lệ'),

  body('patientInfo.name')
    .notEmpty()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Tên bệnh nhân phải có ít nhất 2 ký tự'),

  body('patientInfo.phone')
    .matches(/^(\+84|84|0)(3[2-9]|5[6-9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}$/)
    .withMessage('Số điện thoại không hợp lệ'),

  body('patientInfo.email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Email không hợp lệ'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Mô tả không được vượt quá 500 ký tự'),

  body('appointmentId')
    .optional()
    .isMongoId()
    .withMessage('ID cuộc hẹn không hợp lệ'),

  body('invoiceId')
    .optional()
    .isMongoId()
    .withMessage('ID hóa đơn không hợp lệ'),

  body('recordId')
    .optional()
    .isMongoId()
    .withMessage('ID hồ sơ không hợp lệ'),

  // Card payment specific validations
  body('cardInfo.cardNumber')
    .if(body('method').isIn(['credit_card', 'debit_card']))
    .matches(/^[0-9]{13,19}$/)
    .withMessage('Số thẻ phải từ 13-19 chữ số'),

  body('cardInfo.expiryMonth')
    .if(body('method').isIn(['credit_card', 'debit_card']))
    .isInt({ min: 1, max: 12 })
    .withMessage('Tháng hết hạn không hợp lệ (1-12)'),

  body('cardInfo.expiryYear')
    .if(body('method').isIn(['credit_card', 'debit_card']))
    .isInt({ min: new Date().getFullYear() })
    .withMessage('Năm hết hạn không hợp lệ'),

  body('cardInfo.cvv')
    .if(body('method').isIn(['credit_card', 'debit_card']))
    .matches(/^[0-9]{3,4}$/)
    .withMessage('CVV phải là 3-4 chữ số'),

  body('cardInfo.holderName')
    .if(body('method').isIn(['credit_card', 'debit_card']))
    .notEmpty()
    .trim()
    .withMessage('Tên chủ thẻ là bắt buộc'),

  // Digital wallet validations (VNPay only)
  body('digitalWalletInfo.walletType')
    .if(body('method').equals('vnpay'))
    .equals('vnpay')
    .withMessage('Loại ví điện tử phải là VNPay'),

  body('digitalWalletInfo.phoneNumber')
    .if(body('method').equals('vnpay'))
    .matches(/^(\+84|84|0)(3[2-9]|5[6-9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}$/)
    .withMessage('Số điện thoại ví không hợp lệ'),

  // Insurance validations
  body('insuranceInfo.provider')
    .if(body('method').equals('insurance'))
    .notEmpty()
    .trim()
    .withMessage('Nhà cung cấp bảo hiểm là bắt buộc'),

  body('insuranceInfo.policyNumber')
    .if(body('method').equals('insurance'))
    .notEmpty()
    .trim()
    .withMessage('Số hợp đồng bảo hiểm là bắt buộc'),

  body('insuranceInfo.coveragePercentage')
    .if(body('method').equals('insurance'))
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tỷ lệ chi trả bảo hiểm phải từ 0-100%'),

  // Installment validations
  body('installmentInfo.totalInstallments')
    .if(body('method').equals('installment'))
    .isInt({ min: 2, max: 24 })
    .withMessage('Số kỳ trả góp phải từ 2-24 tháng'),

  body('installmentInfo.monthlyAmount')
    .if(body('method').equals('installment'))
    .isFloat({ min: 100000 })
    .withMessage('Số tiền hàng tháng phải ít nhất 100,000 VND'),

  body('installmentInfo.interestRate')
    .if(body('method').equals('installment'))
    .isFloat({ min: 0, max: 30 })
    .withMessage('Lãi suất phải từ 0-30%')
];

const createCashPaymentValidation = [
  body('amount')
    .isFloat({ min: 1000 })
    .withMessage('Số tiền thanh toán phải ít nhất 1,000 VND'),

  body('patientInfo.name')
    .notEmpty()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Tên bệnh nhân phải có ít nhất 2 ký tự'),

  body('patientInfo.phone')
    .matches(/^(\+84|84|0)(3[2-9]|5[6-9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}$/)
    .withMessage('Số điện thoại không hợp lệ'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Mô tả không được vượt quá 500 ký tự'),

  body('receivedAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Số tiền nhận phải lớn hơn hoặc bằng 0'),

  body('appointmentId')
    .optional()
    .isMongoId()
    .withMessage('ID cuộc hẹn không hợp lệ'),

  body('invoiceId')
    .optional()
    .isMongoId()
    .withMessage('ID hóa đơn không hợp lệ')
];

const createRefundValidation = [
  param('originalPaymentId')
    .isMongoId()
    .withMessage('ID thanh toán gốc không hợp lệ'),

  body('amount')
    .isFloat({ min: 1000 })
    .withMessage('Số tiền hoàn phải ít nhất 1,000 VND'),

  body('reason')
    .notEmpty()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Lý do hoàn tiền phải từ 5-500 ký tự'),

  body('refundMethod')
    .optional()
    .isIn(['original', 'cash', 'bank_transfer'])
    .withMessage('Phương thức hoàn tiền không hợp lệ'),

  body('bankInfo.accountNumber')
    .if(body('refundMethod').equals('bank_transfer'))
    .matches(/^[0-9]{6,20}$/)
    .withMessage('Số tài khoản phải từ 6-20 chữ số'),

  body('bankInfo.accountName')
    .if(body('refundMethod').equals('bank_transfer'))
    .notEmpty()
    .trim()
    .withMessage('Tên chủ tài khoản là bắt buộc'),

  body('bankInfo.bankCode')
    .if(body('refundMethod').equals('bank_transfer'))
    .notEmpty()
    .trim()
    .withMessage('Mã ngân hàng là bắt buộc')
];

// ============ UPDATE VALIDATIONS ============
const updatePaymentValidation = [
  param('id')
    .isMongoId()
    .withMessage('ID thanh toán không hợp lệ'),

  body('status')
    .optional()
    .isIn(Object.values(PaymentStatus))
    .withMessage('Trạng thái thanh toán không hợp lệ'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Mô tả không được vượt quá 500 ký tự'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Ghi chú không được vượt quá 1,000 ký tự')
];

const cancelPaymentValidation = [
  param('id')
    .isMongoId()
    .withMessage('ID thanh toán không hợp lệ'),

  body('reason')
    .notEmpty()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Lý do hủy thanh toán phải từ 5-500 ký tự')
];

// ============ QUERY VALIDATIONS ============
const getPaymentByIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('ID thanh toán không hợp lệ')
];

const getPaymentByCodeValidation = [
  param('code')
    .matches(/^PAY[0-9A-Z]{12}$/)
    .withMessage('Mã thanh toán không hợp lệ')
];

const getPatientPaymentsValidation = [
  param('patientId')
    .isMongoId()
    .withMessage('ID bệnh nhân không hợp lệ'),

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
    .isIn(Object.values(PaymentStatus))
    .withMessage('Trạng thái không hợp lệ')
];

const listPaymentsValidation = [
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
    .custom((value) => {
      if (Array.isArray(value)) {
        return value.every(status => Object.values(PaymentStatus).includes(status));
      }
      return Object.values(PaymentStatus).includes(value);
    })
    .withMessage('Trạng thái không hợp lệ'),

  query('method')
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) {
        return value.every(method => Object.values(PaymentMethod).includes(method));
      }
      return Object.values(PaymentMethod).includes(value);
    })
    .withMessage('Phương thức thanh toán không hợp lệ'),

  query('type')
    .optional()
    .isIn(Object.values(PaymentType))
    .withMessage('Loại thanh toán không hợp lệ'),

  query('dateFrom')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('Ngày bắt đầu không hợp lệ'),

  query('dateTo')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('Ngày kết thúc không hợp lệ'),

  query('minAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Số tiền tối thiểu không hợp lệ'),

  query('maxAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Số tiền tối đa không hợp lệ'),

  query('phone')
    .optional()
    .matches(/^(\+84|84|0)(3[2-9]|5[6-9]|7[0|6-9]|8[1-9]|9[0-9])[0-9]{7}$/)
    .withMessage('Số điện thoại không hợp lệ'),

  query('patientName')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Tên bệnh nhân phải có ít nhất 2 ký tự'),

  query('isVerified')
    .optional()
    .isBoolean()
    .withMessage('Trạng thái xác minh phải là true hoặc false'),

  query('sortBy')
    .optional()
    .isIn(['processedAt', 'createdAt', 'amount', 'finalAmount', 'status'])
    .withMessage('Trường sắp xếp không hợp lệ'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Thứ tự sắp xếp phải là asc hoặc desc')
];

const searchPaymentsValidation = [
  query('q')
    .notEmpty()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Từ khóa tìm kiếm phải có ít nhất 2 ký tự'),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Số trang phải là số nguyên dương'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải từ 1-100')
];

// ============ STATISTICS VALIDATIONS ============
const getStatisticsValidation = [
  query('startDate')
    .isISO8601()
    .toDate()
    .withMessage('Ngày bắt đầu không hợp lệ'),

  query('endDate')
    .isISO8601()
    .toDate()
    .withMessage('Ngày kết thúc không hợp lệ'),

  query('groupBy')
    .optional()
    .isIn(['day', 'week', 'month', 'year', 'method', 'status'])
    .withMessage('Loại nhóm không hợp lệ')
];

module.exports = {
  createPaymentValidation,
  createCashPaymentValidation,
  createRefundValidation,
  updatePaymentValidation,
  cancelPaymentValidation,
  getPaymentByIdValidation,
  getPaymentByCodeValidation,
  getPatientPaymentsValidation,
  listPaymentsValidation,
  searchPaymentsValidation,
  getStatisticsValidation
};
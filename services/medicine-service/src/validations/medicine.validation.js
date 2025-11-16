const { body, param, query } = require('express-validator');

const createMedicineValidation = [
  body('name')
    .notEmpty()
    .withMessage('Tên thuốc là bắt buộc')
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên thuốc phải từ 2 đến 200 ký tự')
    .trim(),
  
  body('unit')
    .notEmpty()
    .withMessage('Đơn vị là bắt buộc')
    .isIn(['viên', 'vỉ', 'hộp', 'ống', 'lọ', 'gói', 'tuýp', 'chai', 'kg', 'g'])
    .withMessage('Đơn vị không hợp lệ'),
  
  body('category')
    .optional()
    .isIn(['thuốc giảm đau', 'kháng sinh', 'thuốc bôi', 'thuốc súc miệng', 'vitamin', 'khác'])
    .withMessage('Danh mục không hợp lệ')
];

const updateMedicineValidation = [
  param('id')
    .isMongoId()
    .withMessage('ID thuốc không hợp lệ'),
  
  body('name')
    .optional()
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên thuốc phải từ 2 đến 200 ký tự')
    .trim(),
  
  body('unit')
    .optional()
    .isIn(['viên', 'vỉ', 'hộp', 'ống', 'lọ', 'gói', 'tuýp', 'chai', 'kg', 'g'])
    .withMessage('Đơn vị không hợp lệ'),
  
  body('category')
    .optional()
    .isIn(['thuốc giảm đau', 'kháng sinh', 'thuốc bôi', 'thuốc súc miệng', 'vitamin', 'khác'])
    .withMessage('Danh mục không hợp lệ')
];

const medicineIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('ID thuốc không hợp lệ')
];

const listMedicinesValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Trang phải là số nguyên dương'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải từ 1 đến 100'),
  
  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive phải là boolean'),
  
  query('category')
    .optional()
    .isIn(['thuốc giảm đau', 'kháng sinh', 'thuốc bôi', 'thuốc súc miệng', 'vitamin', 'khác'])
    .withMessage('Danh mục không hợp lệ')
];

const searchMedicineValidation = [
  query('q')
    .notEmpty()
    .withMessage('Từ khóa tìm kiếm là bắt buộc')
    .isLength({ min: 1, max: 100 })
    .withMessage('Từ khóa tìm kiếm phải từ 1 đến 100 ký tự')
    .trim(),
  
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Trang phải là số nguyên dương'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Giới hạn phải từ 1 đến 100')
];

module.exports = {
  createMedicineValidation,
  updateMedicineValidation,
  medicineIdValidation,
  listMedicinesValidation,
  searchMedicineValidation
};
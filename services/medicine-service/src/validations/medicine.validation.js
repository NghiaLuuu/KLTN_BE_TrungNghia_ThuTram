const { body, param, query } = require('express-validator');

const createMedicineValidation = [
  body('name')
    .notEmpty()
    .withMessage('Tên thuốc là bắt buộc')
    .isLength({ min: 2, max: 200 })
    .withMessage('Tên thuốc phải từ 2 đến 200 ký tự')
    .trim(),
  
  body('dosage')
    .notEmpty()
    .withMessage('Liều dùng là bắt buộc')
    .isLength({ min: 2, max: 100 })
    .withMessage('Liều dùng phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('ingredient')
    .optional()
    .isLength({ max: 300 })
    .withMessage('Thành phần không được quá 300 ký tự')
    .trim(),
  
  body('category')
    .optional()
    .isIn(['thuốc giảm đau', 'kháng sinh', 'thuốc bôi', 'thuốc súc miệng', 'vitamin', 'khác'])
    .withMessage('Danh mục không hợp lệ'),
  
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Mô tả không được quá 1000 ký tự')
    .trim(),
  
  body('instructions')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Hướng dẫn sử dụng không được quá 1000 ký tự')
    .trim(),
  
  body('contraindications')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Chống chỉ định không được quá 1000 ký tự')
    .trim(),
  
  body('sideEffects')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Tác dụng phụ không được quá 1000 ký tự')
    .trim()
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
  
  body('dosage')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Liều dùng phải từ 2 đến 100 ký tự')
    .trim(),
  
  body('ingredient')
    .optional()
    .isLength({ max: 300 })
    .withMessage('Thành phần không được quá 300 ký tự')
    .trim(),
  
  body('category')
    .optional()
    .isIn(['thuốc giảm đau', 'kháng sinh', 'thuốc bôi', 'thuốc súc miệng', 'vitamin', 'khác'])
    .withMessage('Danh mục không hợp lệ'),
  
  body('description')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Mô tả không được quá 1000 ký tự')
    .trim(),
  
  body('instructions')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Hướng dẫn sử dụng không được quá 1000 ký tự')
    .trim(),
  
  body('contraindications')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Chống chỉ định không được quá 1000 ký tự')
    .trim(),
  
  body('sideEffects')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Tác dụng phụ không được quá 1000 ký tự')
    .trim()
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
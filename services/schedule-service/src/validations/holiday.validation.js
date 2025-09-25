const { body, param } = require('express-validator');

const createHolidayValidation = [
  body('name')
    .notEmpty()
    .withMessage('Holiday name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Holiday name must be between 2 and 100 characters'),
  
  body('date')
    .notEmpty()
    .withMessage('Holiday date is required')
    .isISO8601()
    .withMessage('Invalid date format. Use YYYY-MM-DD')
];

const updateHolidayValidation = [
  param('holidayId')
    .isMongoId()
    .withMessage('Invalid holiday ID'),
  
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Holiday name must be between 2 and 100 characters'),
  
  body('date')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format. Use YYYY-MM-DD')
];

const holidayIdValidation = [
  param('holidayId')
    .isMongoId()
    .withMessage('Invalid holiday ID')
];

module.exports = {
  createHolidayValidation,
  updateHolidayValidation,
  holidayIdValidation
};
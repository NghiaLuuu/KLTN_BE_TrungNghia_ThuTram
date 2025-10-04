const { body, param } = require('express-validator');

const createHolidayValidation = [
  body('name')
    .notEmpty()
    .withMessage('Holiday name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Holiday name must be between 2 and 100 characters'),
  
  body('startDate')
    .notEmpty()
    .withMessage('Start date is required')
    .isISO8601()
    .withMessage('Invalid start date format. Use YYYY-MM-DD')
    .custom((startDate) => {
      const start = new Date(startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset to start of day for fair comparison
      
      if (start < today) {
        throw new Error('Start date must be today or in the future');
      }
      return true;
    }),
  
  body('endDate')
    .notEmpty()
    .withMessage('End date is required')
    .isISO8601()
    .withMessage('Invalid end date format. Use YYYY-MM-DD')
    .custom((endDate, { req }) => {
      const end = new Date(endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (end < today) {
        throw new Error('End date must be today or in the future');
      }
      
      if (end < new Date(req.body.startDate)) {
        throw new Error('End date must be after or equal to start date');
      }
      return true;
    }),
  
  body('note')
    .optional()
    .trim()
];

const updateHolidayValidation = [
  param('holidayId')
    .isMongoId()
    .withMessage('Invalid holiday ID'),
  
  body('name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Holiday name must be between 2 and 100 characters'),
  
  body('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format. Use YYYY-MM-DD')
    .custom((startDate) => {
      if (!startDate) return true; // Skip if not provided
      
      const start = new Date(startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (start < today) {
        throw new Error('Start date must be today or in the future');
      }
      return true;
    }),
  
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format. Use YYYY-MM-DD')
    .custom((endDate, { req }) => {
      if (!endDate) return true; // Skip if not provided
      
      const end = new Date(endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (end < today) {
        throw new Error('End date must be today or in the future');
      }
      
      // Only validate if both dates are provided
      if (endDate && req.body.startDate && end < new Date(req.body.startDate)) {
        throw new Error('End date must be after or equal to start date');
      }
      return true;
    }),
  
  body('note')
    .optional()
    .trim(),
  
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
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
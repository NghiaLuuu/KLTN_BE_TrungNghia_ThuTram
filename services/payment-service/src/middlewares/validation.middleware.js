const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    return res.status(400).json({
      success: false,
      message: 'Dữ liệu đầu vào không hợp lệ',
      errors: formattedErrors
    });
  }

  next();
};

// Custom validation for date ranges
const validateDateRange = (req, res, next) => {
  const { startDate, endDate } = req.query;
  
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Ngày bắt đầu không thể lớn hơn ngày kết thúc'
      });
    }

    // Check if date range is not too large (max 1 year)
    const oneYear = 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > oneYear) {
      return res.status(400).json({
        success: false,
        message: 'Khoảng thời gian tối đa là 1 năm'
      });
    }
  }
  
  next();
};

// Custom validation for amount ranges
const validateAmountRange = (req, res, next) => {
  const { minAmount, maxAmount } = req.query;
  
  if (minAmount && maxAmount) {
    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);
    
    if (min > max) {
      return res.status(400).json({
        success: false,
        message: 'Số tiền tối thiểu không thể lớn hơn số tiền tối đa'
      });
    }
  }
  
  next();
};

// Sanitize query parameters
const sanitizeQuery = (req, res, next) => {
  // Convert string arrays to arrays
  ['status', 'method'].forEach(field => {
    if (req.query[field] && typeof req.query[field] === 'string' && req.query[field].includes(',')) {
      req.query[field] = req.query[field].split(',').map(item => item.trim());
    }
  });

  // Convert boolean strings
  ['isVerified'].forEach(field => {
    if (req.query[field] !== undefined) {
      req.query[field] = req.query[field] === 'true';
    }
  });

  // Convert numeric strings
  ['page', 'limit', 'minAmount', 'maxAmount'].forEach(field => {
    if (req.query[field] !== undefined) {
      const num = parseFloat(req.query[field]);
      if (!isNaN(num)) {
        req.query[field] = num;
      }
    }
  });

  next();
};

module.exports = {
  validate,
  validateDateRange,
  validateAmountRange,
  sanitizeQuery
};
const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    // ⭐ Debug: Log request body and errors
    console.log('❌ Validation failed for:', req.path);
    console.log('📦 Request body:', JSON.stringify(req.body, null, 2));
    console.log('❌ Validation errors:', JSON.stringify(errors.array(), null, 2));
    
    const errorMessages = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));
    
    return res.status(400).json({
      success: false,
      message: 'Dữ liệu không hợp lệ',
      errors: errorMessages
    });
  }
  
  next();
};

module.exports = { validate };
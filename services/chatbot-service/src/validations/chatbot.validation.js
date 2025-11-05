/**
 * Chatbot Validation
 * Request validation for chatbot endpoints
 */
const Joi = require('joi');

// Chat message validation
const chatValidation = (req, res, next) => {
  const schema = Joi.object({
    message: Joi.string().min(1).max(1000).required()
      .messages({
        'string.empty': 'Message cannot be empty',
        'string.max': 'Message is too long (max 1000 characters)',
        'any.required': 'Message is required'
      }),
    userId: Joi.string().optional()
  });

  const { error } = schema.validate(req.body);
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }

  next();
};

// Image upload validation
const imageValidation = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No image file uploaded'
    });
  }

  // Check file size (already handled by multer, but double-check)
  if (req.file.size > 5 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: 'Image file is too large (max 5MB)'
    });
  }

  next();
};

module.exports = {
  chatValidation,
  imageValidation
};

/**
 * Xác thực Chatbot
 * Xác thực request cho các endpoint chatbot
 */
const Joi = require('joi');

// Xác thực tin nhắn chat
const chatValidation = (req, res, next) => {
  const schema = Joi.object({
    message: Joi.string().min(1).max(1000).required()
      .messages({
        'string.empty': 'Tin nhắn không được trống',
        'string.max': 'Tin nhắn quá dài (tối đa 1000 ký tự)',
        'any.required': 'Tin nhắn là bắt buộc'
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

// Xác thực upload ảnh
const imageValidation = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Không có file ảnh được tải lên'
    });
  }

  // Kiểm tra kích thước file (đã được multer xử lý, nhưng kiểm tra lại)
  if (req.file.size > 5 * 1024 * 1024) {
    return res.status(400).json({
      success: false,
      message: 'File ảnh quá lớn (tối đa 5MB)'
    });
  }

  next();
};

module.exports = {
  chatValidation,
  imageValidation
};

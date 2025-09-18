// ...existing validations...

// 🆕 Certificate validation
const certificateUploadValidation = (req, res, next) => {
  try {
    const { notes } = req.body;
    
    // Validate notes length
    if (notes && notes.length > 200) {
      return res.status(400).json({
        success: false,
        message: 'Ghi chú không được vượt quá 200 ký tự'
      });
    }

    // Check if file exists
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng chọn file ảnh chứng chỉ'
      });
    }

    next();
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Lỗi validation: ' + error.message
    });
  }
};

module.exports = {
  // ...existing exports...
  certificateUploadValidation
};
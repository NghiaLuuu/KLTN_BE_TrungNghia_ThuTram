/**
 * Middleware Upload
 * Xử lý upload file với multer
 */
const multer = require('multer');

// Sử dụng memory storage cho đơn giản
const storage = multer.memoryStorage();

// Bộ lọc file - chỉ cho phép ảnh
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Loại file không hợp lệ. Chỉ chấp nhận JPEG và PNG.'), false);
  }
};

// Tạo instance upload của multer
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // Kích thước file tối đa 5MB
  }
});

// Export các hàm middleware
const uploadSingle = upload.single('image');
const uploadMultiple = upload.array('images', 4); // Tối đa 4 ảnh

module.exports = {
  upload,
  uploadSingle,
  uploadMultiple
};

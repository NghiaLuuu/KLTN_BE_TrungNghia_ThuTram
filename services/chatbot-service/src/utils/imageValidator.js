// Trình xác thực Ảnh - Xác thực các ảnh được tải lên

const sharp = require('sharp');

/**
 * Các loại MIME ảnh được cho phép
 */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Kích thước file tối đa: 5MB
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB tính theo bytes

/**
 * Kích thước tối thiểu (để đảm bảo chất lượng ảnh)
 */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;

/**
 * Kích thước tối đa (để tránh file quá lớn)
 */
const MAX_WIDTH = 4096;
const MAX_HEIGHT = 4096;

/**
 * Xác thực file ảnh
 * @param {Object} file - Object file của Multer
 * @returns {Object} - { valid: boolean, error: string }
 */
async function validateImageFile(file) {
  try {
    // Check if file exists
    if (!file) {
      return { valid: false, error: 'Không có file ảnh được upload.' };
    }

    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return {
        valid: false,
        error: `Định dạng ảnh không hợp lệ. Chỉ chấp nhận: ${ALLOWED_MIME_TYPES.join(', ')}`
      };
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return {
        valid: false,
        error: `Kích thước ảnh quá lớn. Tối đa ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
      };
    }

    // Check if file buffer exists
    if (!file.buffer) {
      return { valid: false, error: 'Dữ liệu ảnh không hợp lệ.' };
    }

    // Validate image using sharp
    const metadata = await sharp(file.buffer).metadata();

    // Check dimensions
    if (metadata.width < MIN_WIDTH || metadata.height < MIN_HEIGHT) {
      return {
        valid: false,
        error: `Ảnh quá nhỏ. Kích thước tối thiểu: ${MIN_WIDTH}x${MIN_HEIGHT}px.`
      };
    }

    if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
      return {
        valid: false,
        error: `Ảnh quá lớn. Kích thước tối đa: ${MAX_WIDTH}x${MAX_HEIGHT}px.`
      };
    }

    // Check image format
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return {
        valid: false,
        error: 'Format ảnh không được hỗ trợ.'
      };
    }

    return { valid: true, error: null };

  } catch (error) {
    console.error('❌ Image validation error:', error);
    return {
      valid: false,
      error: 'Không thể xử lý ảnh. Vui lòng kiểm tra file ảnh.'
    };
  }
}

/**
 * Tối ưu hóa ảnh (nén và thay đổi kích thước nếu quá lớn)
 * @param {Buffer} imageBuffer - Buffer ảnh gốc
 * @param {String} mimeType - Loại MIME ảnh
 * @returns {Promise<Buffer>} - Buffer ảnh đã tối ưu
 */
async function optimizeImage(imageBuffer, mimeType) {
  try {
    const metadata = await sharp(imageBuffer).metadata();

    let pipeline = sharp(imageBuffer);

    // Thay đổi kích thước nếu quá lớn (tối đa 2048px cạnh dài nhất)
    if (metadata.width > 2048 || metadata.height > 2048) {
      pipeline = pipeline.resize(2048, 2048, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Chuyển đổi sang định dạng phù hợp với nén
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      pipeline = pipeline.jpeg({ quality: 85, progressive: true });
    } else if (mimeType === 'image/png') {
      pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
    } else if (mimeType === 'image/webp') {
      pipeline = pipeline.webp({ quality: 85 });
    }

    return await pipeline.toBuffer();

  } catch (error) {
    console.error('❌ Lỗi tối ưu hóa ảnh:', error);
    // Trả về ảnh gốc nếu tối ưu thất bại
    return imageBuffer;
  }
}

/**
 * Trích xuất thông tin ảnh
 * @param {Buffer} imageBuffer - Buffer ảnh
 * @returns {Promise<Object>} - { width, height, format, size }
 */
async function getImageInfo(imageBuffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: imageBuffer.length,
      hasAlpha: metadata.hasAlpha,
      space: metadata.space
    };
  } catch (error) {
    console.error('❌ Lỗi lấy thông tin ảnh:', error);
    return null;
  }
}

/**
 * Kiểm tra xem ảnh có quá tối không (chất lượng kém)
 * @param {Buffer} imageBuffer - Buffer ảnh
 * @returns {Promise<Boolean>}
 */
async function isImageTooDark(imageBuffer) {
  try {
    const { channels } = await sharp(imageBuffer)
      .resize(100, 100, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Tính độ sáng trung bình
    const pixels = channels[0];
    const sum = pixels.reduce((acc, val) => acc + val, 0);
    const avgBrightness = sum / pixels.length;

    // Nếu độ sáng trung bình < 30 (trên 255), thì quá tối
    return avgBrightness < 30;

  } catch (error) {
    console.error('❌ Lỗi kiểm tra độ tối:', error);
    return false; // Không chặn nếu kiểm tra thất bại
  }
}

/**
 * Xác thực nhiều ảnh
 * @param {Array<Object>} files - Mảng các object file multer
 * @returns {Promise<Object>} - { valid: boolean, error: string, validFiles: array }
 */
async function validateMultipleImages(files) {
  if (!files || files.length === 0) {
    return {
      valid: false,
      error: 'Không có ảnh nào được upload.',
      validFiles: []
    };
  }

  if (files.length > 4) {
    return {
      valid: false,
      error: 'Chỉ có thể upload tối đa 4 ảnh cùng lúc.',
      validFiles: []
    };
  }

  const validFiles = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const result = await validateImageFile(files[i]);
    if (result.valid) {
      validFiles.push(files[i]);
    } else {
      errors.push(`Ảnh ${i + 1}: ${result.error}`);
    }
  }

  if (validFiles.length === 0) {
    return {
      valid: false,
      error: errors.join('\n'),
      validFiles: []
    };
  }

  return {
    valid: true,
    error: errors.length > 0 ? errors.join('\n') : null,
    validFiles
  };
}

/**
 * Chuyển đổi ảnh sang định dạng chuẩn (JPEG)
 * @param {Buffer} imageBuffer - Buffer ảnh gốc
 * @returns {Promise<{buffer: Buffer, mimeType: String}>}
 */
async function convertToStandardFormat(imageBuffer) {
  try {
    const buffer = await sharp(imageBuffer)
      .jpeg({ quality: 90 })
      .toBuffer();

    return {
      buffer,
      mimeType: 'image/jpeg'
    };
  } catch (error) {
    console.error('❌ Lỗi chuyển đổi định dạng:', error);
    return {
      buffer: imageBuffer,
      mimeType: 'image/jpeg'
    };
  }
}

module.exports = {
  validateImageFile,
  optimizeImage,
  getImageInfo,
  isImageTooDark,
  validateMultipleImages,
  convertToStandardFormat,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MIN_WIDTH,
  MIN_HEIGHT,
  MAX_WIDTH,
  MAX_HEIGHT
};

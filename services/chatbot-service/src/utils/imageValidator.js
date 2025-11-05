// Image Validator - Validate uploaded images

const sharp = require('sharp');

/**
 * Allowed image MIME types
 */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/**
 * Max file size: 5MB
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes

/**
 * Min dimensions (to ensure image quality)
 */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;

/**
 * Max dimensions (to prevent huge files)
 */
const MAX_WIDTH = 4096;
const MAX_HEIGHT = 4096;

/**
 * Validate image file
 * @param {Object} file - Multer file object
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
 * Optimize image (compress and resize if too large)
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {String} mimeType - Image MIME type
 * @returns {Promise<Buffer>} - Optimized image buffer
 */
async function optimizeImage(imageBuffer, mimeType) {
  try {
    const metadata = await sharp(imageBuffer).metadata();

    let pipeline = sharp(imageBuffer);

    // Resize if too large (max 2048px on longest side)
    if (metadata.width > 2048 || metadata.height > 2048) {
      pipeline = pipeline.resize(2048, 2048, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert to appropriate format with compression
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      pipeline = pipeline.jpeg({ quality: 85, progressive: true });
    } else if (mimeType === 'image/png') {
      pipeline = pipeline.png({ quality: 85, compressionLevel: 8 });
    } else if (mimeType === 'image/webp') {
      pipeline = pipeline.webp({ quality: 85 });
    }

    return await pipeline.toBuffer();

  } catch (error) {
    console.error('❌ Image optimization error:', error);
    // Return original if optimization fails
    return imageBuffer;
  }
}

/**
 * Extract image info
 * @param {Buffer} imageBuffer - Image buffer
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
    console.error('❌ Get image info error:', error);
    return null;
  }
}

/**
 * Check if image is too dark (poor quality)
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Boolean>}
 */
async function isImageTooDark(imageBuffer) {
  try {
    const { channels } = await sharp(imageBuffer)
      .resize(100, 100, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Calculate average brightness
    const pixels = channels[0];
    const sum = pixels.reduce((acc, val) => acc + val, 0);
    const avgBrightness = sum / pixels.length;

    // If average brightness < 30 (out of 255), it's too dark
    return avgBrightness < 30;

  } catch (error) {
    console.error('❌ Check darkness error:', error);
    return false; // Don't block if check fails
  }
}

/**
 * Validate multiple images
 * @param {Array<Object>} files - Array of multer file objects
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
 * Convert image to standard format (JPEG)
 * @param {Buffer} imageBuffer - Original image buffer
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
    console.error('❌ Convert format error:', error);
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

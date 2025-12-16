// S3 Service cho Chatbot - Upload hình ảnh lên AWS S3
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

/**
 * Upload buffer file lên S3
 * @param {Buffer} fileBuffer - Buffer của file
 * @param {string} fileName - Tên file gốc
 * @param {string} mimeType - MIME type (image/jpeg, image/png, v.v.)
 * @param {string} folder - Folder trên S3 (mặc định: 'avatars' cho public access)
 * @returns {Promise<string>} - URL công khai của file đã upload
 */
const uploadToS3 = async (fileBuffer, fileName, mimeType, folder = 'avatars') => {
  const key = `${folder}/${uuidv4()}-${fileName}`;
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType
  };

  try {
    const data = await s3.upload(params).promise();
    console.log(`✅ Đã upload ảnh lên S3: ${data.Location}`);
    return data.Location; // URL công khai
  } catch (error) {
    console.error('❌ Lỗi upload S3:', error.message);
    throw new Error('Không thể upload ảnh lên S3');
  }
};

/**
 * Xóa file từ S3
 * @param {string} fileUrl - URL file trên S3
 * @returns {Promise<boolean>} - Trạng thái thành công
 */
const deleteFromS3 = async (fileUrl) => {
  try {
    // Trích xuất key từ URL
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1); // Bỏ dấu '/' ở đầu

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    };

    await s3.deleteObject(params).promise();
    console.log(`✅ Đã xóa ảnh từ S3: ${key}`);
    return true;
  } catch (error) {
    console.error('❌ Lỗi xóa S3:', error.message);
    return false;
  }
};

module.exports = { 
  uploadToS3, 
  deleteFromS3 
};

// services/s3.service.js
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

/**
 * Upload file buffer lên S3
 * @param {Buffer} fileBuffer 
 * @param {string} fileName 
 * @param {string} mimeType
 * @param {string} folder - folder trên S3 (ví dụ: 'avatars')
 * @returns {string} - URL public
 */
const uploadToS3 = async (fileBuffer, fileName, mimeType, folder = 'avatars') => {
  const key = `${folder}/${uuidv4()}-${fileName}`;
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType
  };

  const data = await s3.upload(params).promise();
  return data.Location; // link public
};

/**
 * Delete file từ S3
 * @param {string} fileUrl - URL đầy đủ của file
 * @returns {boolean}
 */
const deleteFromS3 = async (fileUrl) => {
  if (!fileUrl) return false;
  
  try {
    // Extract key from URL
    // Example: https://bucket-name.s3.region.amazonaws.com/avatars/uuid-filename.jpg
    const urlParts = fileUrl.split('.com/');
    if (urlParts.length < 2) return false;
    
    const key = urlParts[1];
    
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    };
    
    await s3.deleteObject(params).promise();
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    return false;
  }
};

module.exports = { uploadToS3, deleteFromS3 };

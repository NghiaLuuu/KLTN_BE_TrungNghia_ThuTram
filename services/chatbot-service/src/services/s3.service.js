// S3 Service for Chatbot - Upload images to AWS S3
const AWS = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

/**
 * Upload file buffer to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original filename
 * @param {string} mimeType - MIME type (image/jpeg, image/png, etc.)
 * @param {string} folder - S3 folder (default: 'chatbot-images')
 * @returns {Promise<string>} - Public URL of uploaded file
 */
const uploadToS3 = async (fileBuffer, fileName, mimeType, folder = 'chatbot-images') => {
  const key = `${folder}/${uuidv4()}-${fileName}`;
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType
  };

  try {
    const data = await s3.upload(params).promise();
    console.log(`✅ Image uploaded to S3: ${data.Location}`);
    return data.Location; // Public URL
  } catch (error) {
    console.error('❌ S3 Upload Error:', error.message);
    throw new Error('Failed to upload image to S3');
  }
};

/**
 * Delete file from S3
 * @param {string} fileUrl - S3 file URL
 * @returns {Promise<boolean>} - Success status
 */
const deleteFromS3 = async (fileUrl) => {
  try {
    // Extract key from URL
    const url = new URL(fileUrl);
    const key = url.pathname.substring(1); // Remove leading '/'

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key
    };

    await s3.deleteObject(params).promise();
    console.log(`✅ Image deleted from S3: ${key}`);
    return true;
  } catch (error) {
    console.error('❌ S3 Delete Error:', error.message);
    return false;
  }
};

module.exports = { 
  uploadToS3, 
  deleteFromS3 
};

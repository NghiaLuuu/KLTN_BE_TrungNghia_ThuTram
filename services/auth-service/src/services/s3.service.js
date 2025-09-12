// services/s3-service.js
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
    ContentType: mimeType,
  };

  const data = await s3.upload(params).promise();
  return data.Location; // link public
};

module.exports = { uploadToS3 };

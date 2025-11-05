// Image Analysis Service - GPT-4 Vision for teeth image analysis

const { openai, config } = require('../config/openai.config');
const { IMAGE_ANALYSIS_PROMPT } = require('../config/systemPrompts');
const { uploadToS3 } = require('./s3.service');

class ImageAnalysisService {
  /**
   * Analyze teeth image using GPT-4 Vision
   * @param {Buffer} imageBuffer - Image buffer
   * @param {String} mimeType - Image MIME type (image/jpeg, image/png)
   * @param {String} userMessage - Optional user message/question about the image
   * @param {String} originalFileName - Original filename for S3 upload
   * @returns {Promise<Object>} - { analysis: string, isTeethImage: boolean, suggestions: array, imageUrl: string }
   */
  async analyzeTeethImage(imageBuffer, mimeType, userMessage = '', originalFileName = 'teeth-image.jpg') {
    try {
      // Upload image to S3 first
      console.log('📤 Uploading image to S3...');
      const s3ImageUrl = await uploadToS3(imageBuffer, originalFileName, mimeType, 'chatbot-images');
      
      // Convert buffer to base64 for GPT-4 Vision
      const base64Image = imageBuffer.toString('base64');
      const imageUrl = `data:${mimeType};base64,${base64Image}`;

      // Prepare messages for GPT-4 Vision
      const messages = [
        {
          role: 'system',
          content: IMAGE_ANALYSIS_PROMPT
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: userMessage || 'Hãy phân tích hình ảnh này và cho tôi biết tình trạng răng miệng của tôi.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageUrl,
                detail: 'high' // high, low, auto
              }
            }
          ]
        }
      ];

      // Call GPT-4 Vision API
      console.log('🔍 Analyzing image with GPT-4 Vision...');
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: messages,
        max_tokens: config.maxTokens,
        temperature: 0.7
      });

      const analysisText = response.choices[0].message.content;

      // Check if it's a teeth image (based on GPT response)
      const isTeethImage = this.checkIfTeethImage(analysisText);

      // Extract suggestions if it's a teeth image
      const suggestions = isTeethImage ? this.extractSuggestions(analysisText) : [];

      return {
        success: true,
        analysis: analysisText,
        isTeethImage,
        suggestions,
        imageUrl: s3ImageUrl, // S3 URL for storing in database
        tokensUsed: response.usage?.total_tokens || 0
      };

    } catch (error) {
      console.error('❌ Image Analysis Error:', error);
      
      if (error.code === 'invalid_image_format') {
        throw new Error('Định dạng ảnh không hợp lệ. Vui lòng gửi ảnh JPEG hoặc PNG.');
      }
      
      throw new Error('Không thể phân tích ảnh. Vui lòng thử lại sau.');
    }
  }

  /**
   * Check if GPT identified the image as teeth/mouth
   * @param {String} analysisText - GPT analysis text
   * @returns {Boolean}
   */
  checkIfTeethImage(analysisText) {
    const lowerText = analysisText.toLowerCase();
    
    // Keywords indicating rejection (not teeth image)
    const rejectKeywords = [
      'không phải là hình răng',
      'không phải răng',
      'không phải là ảnh răng',
      'không thể xác định',
      'không rõ ràng',
      'vui lòng gửi lại',
      'not teeth',
      'not a dental',
      'not a tooth'
    ];

    // If any reject keyword found, it's not a teeth image
    if (rejectKeywords.some(keyword => lowerText.includes(keyword))) {
      return false;
    }

    // Keywords indicating teeth image
    const teethKeywords = [
      'răng',
      'nướu',
      'miệng',
      'khớp cắn',
      'mảng bám',
      'sâu răng',
      'viêm',
      'ố vàng',
      'teeth',
      'dental',
      'gum',
      'oral'
    ];

    // If found teeth keywords, likely a teeth image
    return teethKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Extract service suggestions from analysis
   * @param {String} analysisText - GPT analysis text
   * @returns {Array<String>} - Suggested services
   */
  extractSuggestions(analysisText) {
    const suggestions = [];
    const lowerText = analysisText.toLowerCase();

    // Map symptoms/issues to services
    const serviceMapping = {
      'tẩy trắng': ['tẩy trắng', 'ố vàng', 'xỉn màu', 'whitening'],
      'lấy cao răng': ['cao răng', 'mảng bám', 'vôi răng', 'scaling', 'tartar'],
      'điều trị nha chu': ['viêm nướu', 'chảy máu nướu', 'nha chu', 'gum disease', 'gingivitis'],
      'trám răng': ['sâu răng', 'lỗ đen', 'cavity', 'decay'],
      'nhổ răng': ['răng khôn', 'wisdom tooth', 'tooth extraction'],
      'niềng răng': ['răng lệch', 'khớp cắn', 'răng thưa', 'orthodontic', 'braces'],
      'bọc răng sứ': ['răng mẻ', 'răng gãy', 'răng hư', 'crown', 'veneer']
    };

    // Check each service mapping
    for (const [service, keywords] of Object.entries(serviceMapping)) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        suggestions.push(service);
      }
    }

    // Remove duplicates
    return [...new Set(suggestions)];
  }

  /**
   * Analyze multiple images (for comparison)
   * @param {Array<{buffer: Buffer, mimeType: String}>} images - Array of images
   * @param {String} userMessage - User message
   * @returns {Promise<Object>}
   */
  async analyzeMultipleImages(images, userMessage = '') {
    try {
      if (images.length > 4) {
        throw new Error('Chỉ có thể phân tích tối đa 4 ảnh cùng lúc.');
      }

      // Prepare content array with text and multiple images
      const contentArray = [
        {
          type: 'text',
          text: userMessage || 'Hãy phân tích và so sánh các hình ảnh răng này.'
        }
      ];

      // Add all images
      images.forEach(({ buffer, mimeType }) => {
        const base64Image = buffer.toString('base64');
        contentArray.push({
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`,
            detail: 'high'
          }
        });
      });

      // Call GPT-4 Vision
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: IMAGE_ANALYSIS_PROMPT
          },
          {
            role: 'user',
            content: contentArray
          }
        ],
        max_tokens: config.maxTokens * 1.5, // More tokens for multiple images
        temperature: 0.7
      });

      const analysisText = response.choices[0].message.content;

      return {
        success: true,
        analysis: analysisText,
        imagesCount: images.length,
        tokensUsed: response.usage?.total_tokens || 0
      };

    } catch (error) {
      console.error('❌ Multiple Images Analysis Error:', error);
      throw new Error('Không thể phân tích nhiều ảnh. Vui lòng thử lại.');
    }
  }

  /**
   * Quick validation: Check if image looks like teeth (using vision)
   * @param {Buffer} imageBuffer - Image buffer
   * @param {String} mimeType - Image MIME type
   * @returns {Promise<Boolean>}
   */
  async quickValidateTeethImage(imageBuffer, mimeType) {
    try {
      const base64Image = imageBuffer.toString('base64');
      const imageUrl = `data:${mimeType};base64,${base64Image}`;

      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'Bạn là hệ thống xác định ảnh. Chỉ trả lời "YES" nếu ảnh là răng/miệng người, "NO" nếu không phải.'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Ảnh này có phải là răng/miệng người không? Chỉ trả lời YES hoặc NO.'
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl, detail: 'low' }
              }
            ]
          }
        ],
        max_tokens: 10,
        temperature: 0
      });

      const answer = response.choices[0].message.content.trim().toUpperCase();
      return answer.includes('YES');

    } catch (error) {
      console.error('❌ Quick Validation Error:', error);
      // If validation fails, allow the image (don't block)
      return true;
    }
  }

  /**
   * Generate follow-up questions based on analysis
   * @param {String} analysisText - Analysis text
   * @param {Array<String>} suggestions - Service suggestions
   * @returns {Array<String>}
   */
  generateFollowUpQuestions(analysisText, suggestions) {
    const questions = [];

    // If has suggestions, ask about booking
    if (suggestions.length > 0) {
      questions.push(`Bạn có muốn đặt lịch khám dịch vụ ${suggestions[0]} không?`);
    }

    // Ask about symptoms
    if (analysisText.toLowerCase().includes('đau')) {
      questions.push('Bạn có bị đau răng không? Đau mức độ nào?');
    }

    // Ask about duration
    questions.push('Tình trạng này đã kéo dài bao lâu rồi?');

    // Ask about previous treatment
    questions.push('Bạn đã từng điều trị răng này chưa?');

    return questions.slice(0, 2); // Return max 2 questions
  }
}

module.exports = new ImageAnalysisService();

// Image Analysis Service - GPT-4 Vision để phân tích hình ảnh răng

const { openai, config } = require('../config/openai.config');
const { IMAGE_ANALYSIS_PROMPT } = require('../config/systemPrompts');
const { uploadToS3 } = require('./s3.service');

class ImageAnalysisService {
  /**
   * Phân tích hình ảnh răng sử dụng GPT-4 Vision
   * @param {Buffer} imageBuffer - Buffer của hình ảnh
   * @param {String} mimeType - MIME type của ảnh (image/jpeg, image/png)
   * @param {String} userMessage - Tin nhắn/câu hỏi tùy chọn của user về hình ảnh
   * @param {String} originalFileName - Tên file gốc để upload lên S3
   * @returns {Promise<Object>} - { analysis: string, isTeethImage: boolean, suggestions: array, imageUrl: string }
   */
  async analyzeTeethImage(imageBuffer, mimeType, userMessage = '', originalFileName = 'teeth-image.jpg') {
    try {
      // Upload ảnh lên S3 trước (sử dụng folder 'avatars' để public access)
      console.log('📤 Đang upload ảnh lên S3...');
      const s3ImageUrl = await uploadToS3(imageBuffer, originalFileName, mimeType, 'avatars');
      
      // Chuyển buffer thành base64 cho GPT-4 Vision
      const base64Image = imageBuffer.toString('base64');
      const imageUrl = `data:${mimeType};base64,${base64Image}`;

      // Chuẩn bị messages cho GPT-4 Vision
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

      // Gọi GPT-4 Vision API
      console.log('🔍 Đang phân tích ảnh với GPT-4 Vision...');
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-4o',
        messages: messages,
        max_tokens: config.maxTokens,
        temperature: 0.7
      });

      const analysisText = response.choices[0].message.content;

      // Kiểm tra có phải ảnh răng không (dựa trên phản hồi GPT)
      const isTeethImage = this.checkIfTeethImage(analysisText);

      // Trích xuất gợi ý nếu là ảnh răng
      const suggestions = isTeethImage ? this.extractSuggestions(analysisText) : [];

      return {
        success: true,
        analysis: analysisText,
        isTeethImage,
        suggestions,
        imageUrl: s3ImageUrl, // URL S3 để lưu trong database
        tokensUsed: response.usage?.total_tokens || 0
      };

    } catch (error) {
      console.error('❌ Lỗi phân tích ảnh:', error);
      
      if (error.code === 'invalid_image_format') {
        throw new Error('Định dạng ảnh không hợp lệ. Vui lòng gửi ảnh JPEG hoặc PNG.');
      }
      
      throw new Error('Không thể phân tích ảnh. Vui lòng thử lại sau.');
    }
  }

  /**
   * Kiểm tra GPT có xác định ảnh là răng/miệng không
   * @param {String} analysisText - Văn bản phân tích của GPT
   * @returns {Boolean}
   */
  checkIfTeethImage(analysisText) {
    const lowerText = analysisText.toLowerCase();
    
    // Từ khóa chỉ ra từ chối (không phải ảnh răng)
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

    // Nếu tìm thấy từ khóa từ chối, đó không phải ảnh răng
    if (rejectKeywords.some(keyword => lowerText.includes(keyword))) {
      return false;
    }

    // Từ khóa chỉ ra ảnh răng
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

    // Nếu tìm thấy từ khóa răng, có thể là ảnh răng
    return teethKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Trích xuất gợi ý dịch vụ từ phân tích
   * @param {String} analysisText - Văn bản phân tích của GPT
   * @returns {Array<String>} - Các dịch vụ được gợi ý
   */
  extractSuggestions(analysisText) {
    const suggestions = [];
    const lowerText = analysisText.toLowerCase();

    // Ánh xạ triệu chứng/vấn đề với dịch vụ
    const serviceMapping = {
      'tẩy trắng': ['tẩy trắng', 'ố vàng', 'xỉn màu', 'whitening'],
      'lấy cao răng': ['cao răng', 'mảng bám', 'vôi răng', 'scaling', 'tartar'],
      'điều trị nha chu': ['viêm nướu', 'chảy máu nướu', 'nha chu', 'gum disease', 'gingivitis'],
      'trám răng': ['sâu răng', 'lỗ đen', 'cavity', 'decay'],
      'nhổ răng': ['răng khôn', 'wisdom tooth', 'tooth extraction'],
      'niềng răng': ['răng lệch', 'khớp cắn', 'răng thưa', 'orthodontic', 'braces'],
      'bọc răng sứ': ['răng mẻ', 'răng gãy', 'răng hư', 'crown', 'veneer']
    };

    // Kiểm tra từng ánh xạ dịch vụ
    for (const [service, keywords] of Object.entries(serviceMapping)) {
      if (keywords.some(keyword => lowerText.includes(keyword))) {
        suggestions.push(service);
      }
    }

    // Loại bỏ trùng lặp
    return [...new Set(suggestions)];
  }

  /**
   * Phân tích nhiều ảnh (cho so sánh)
   * @param {Array<{buffer: Buffer, mimeType: String}>} images - Mảng các ảnh
   * @param {String} userMessage - Tin nhắn của user
   * @returns {Promise<Object>}
   */
  async analyzeMultipleImages(images, userMessage = '') {
    try {
      if (images.length > 4) {
        throw new Error('Chỉ có thể phân tích tối đa 4 ảnh cùng lúc.');
      }

      // Chuẩn bị mảng content với text và nhiều ảnh
      const contentArray = [
        {
          type: 'text',
          text: userMessage || 'Hãy phân tích và so sánh các hình ảnh răng này.'
        }
      ];

      // Thêm tất cả ảnh
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

      // Gọi GPT-4 Vision
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
        max_tokens: config.maxTokens * 1.5, // Nhiều token hơn cho nhiều ảnh
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
      console.error('❌ Lỗi phân tích nhiều ảnh:', error);
      throw new Error('Không thể phân tích nhiều ảnh. Vui lòng thử lại.');
    }
  }

  /**
   * Kiểm tra nhanh: Xem ảnh có giống ảnh răng không (sử dụng vision)
   * @param {Buffer} imageBuffer - Buffer của ảnh
   * @param {String} mimeType - MIME type của ảnh
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
      console.error('❌ Lỗi kiểm tra nhanh:', error);
      // Nếu validation lỗi, cho phép ảnh (đừng chặn)
      return true;
    }
  }

  /**
   * Tạo câu hỏi theo dõi dựa trên phân tích
   * @param {String} analysisText - Văn bản phân tích
   * @param {Array<String>} suggestions - Các dịch vụ được gợi ý
   * @returns {Array<String>}
   */
  generateFollowUpQuestions(analysisText, suggestions) {
    const questions = [];

    // Nếu có gợi ý, hỏi về đặt lịch
    if (suggestions.length > 0) {
      questions.push(`Bạn có muốn đặt lịch khám dịch vụ ${suggestions[0]} không?`);
    }

    // Hỏi về triệu chứng
    if (analysisText.toLowerCase().includes('đau')) {
      questions.push('Bạn có bị đau răng không? Đau mức độ nào?');
    }

    // Hỏi về thời gian
    questions.push('Tình trạng này đã kéo dài bao lâu rồi?');

    // Hỏi về điều trị trước đó
    questions.push('Bạn đã từng điều trị răng này chưa?');

    return questions.slice(0, 2); // Trả về tối đa 2 câu hỏi
  }
}

module.exports = new ImageAnalysisService();

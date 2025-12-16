const { openai, config } = require('../config/openai.config');
const { DENTAL_ASSISTANT_PROMPT } = require('../config/systemPrompts');
const { processApiIntegration } = require('./apiIntegration.service');
const { handleQuery } = require('./queryEngine.service');

class AIService {
  /**
   * Gửi tin nhắn đến GPT và nhận phản hồi (tích hợp Query Engine)
   * @param {Array} messages - Mảng tin nhắn theo định dạng OpenAI
   * @param {String} systemPrompt - System prompt (tùy chọn, dùng mặc định nếu không cung cấp)
   * @param {String} authToken - JWT token cho các API call có xác thực (tùy chọn)
   * @returns {Promise<Object>} - { response: string, queryData: any }
   */
  async sendMessageToGPT(messages, systemPrompt = DENTAL_ASSISTANT_PROMPT, authToken = null) {
    try {
      // Bước 1: Lấy phản hồi ban đầu từ GPT
      const response = await openai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens
      });

      const gptResponse = response.choices[0].message.content;
      console.log('🤖 Phản hồi GPT:', gptResponse);

      // Bước 2: Kiểm tra GPT có muốn sử dụng chức năng đặt lịch không
      if (this.hasBookingRequest(gptResponse)) {
        console.log('📅 Phát hiện yêu cầu đặt lịch');
        return {
          response: gptResponse,
          bookingAction: this.extractBookingAction(gptResponse),
          usedBooking: true
        };
      }

      // Bước 3: Kiểm tra GPT có muốn truy vấn database không
      if (this.hasQueryRequest(gptResponse)) {
        console.log('🔍 Phát hiện yêu cầu query, thực thi Query Engine...');
        
        // Trích xuất query prompt từ tag [QUERY]...[/QUERY]
        const queryPrompt = this.extractQueryPrompt(gptResponse);
        console.log('📝 Query Prompt:', queryPrompt);

        // Thực thi Query Engine
        const queryResult = await handleQuery(queryPrompt);

        if (queryResult.success) {
          console.log(`✅ Query thực thi thành công: ${queryResult.count} kết quả`);
          
          // Bước 4: Gửi kết quả query về GPT để tạo phản hồi ngôn ngữ tự nhiên
          const resultsContext = this.formatQueryResultsForGPT(queryResult);
          
          const finalResponse = await openai.chat.completions.create({
            model: config.model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages,
              { 
                role: 'system', 
                content: `KẾT QUẢ TRUY VẤN:\n${resultsContext}\n\nHãy tổng hợp thông tin trên và trả lời người dùng một cách tự nhiên, thân thiện. Đừng nói về query hay database.` 
              }
            ],
            temperature: config.temperature,
            max_tokens: config.maxTokens
          });

          return {
            response: finalResponse.choices[0].message.content,
            queryData: queryResult.data,
            queryCount: queryResult.count,
            usedQuery: true,
            query: queryResult.query
          };
        } else {
          console.error('❌ Thực thi query thất bại:', queryResult.error);
          // Fallback trả về phản hồi GPT không có dữ liệu query
          return {
            response: gptResponse.replace(/\[QUERY\].*?\[\/QUERY\]/g, '').trim() || 'Xin lỗi, tôi không tìm thấy thông tin phù hợp. Vui lòng liên hệ hotline để được hỗ trợ! 📞',
            queryData: null,
            usedQuery: false,
            error: queryResult.error
          };
        }
      } else {
        // Không cần query, trả về phản hồi GPT trực tiếp
        console.log('ℹ️  Không cần query, trả về phản hồi GPT');
        return {
          response: gptResponse,
          queryData: null,
          usedQuery: false
        };
      }

    } catch (error) {
      console.error('❌ Lỗi OpenAI API:', error);
      throw new Error('Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.');
    }
  }

  /**
   * Kiểm tra phản hồi GPT có chứa yêu cầu đặt lịch không
   * @param {String} response - Phản hồi GPT
   * @returns {Boolean}
   */
  hasBookingRequest(response) {
    return response.includes('[BOOKING_') && response.includes(']');
  }

  /**
   * Trích xuất hành động đặt lịch từ phản hồi
   * @param {String} response - Phản hồi GPT
   * @returns {Object|null}
   */
  extractBookingAction(response) {
    // Khớp các pattern như [BOOKING_CHECK_SERVICES], [BOOKING_GET_DENTISTS serviceId], v.v.
    const match = response.match(/\[BOOKING_(\w+)(?:\s+([^\]]+))?\]/);
    
    if (!match) return null;
    
    const action = match[1]; // e.g., "CHECK_SERVICES", "GET_DENTISTS"
    const params = match[2] ? match[2].trim().split(/\s+/) : [];
    
    return {
      action,
      params,
      fullMatch: match[0]
    };
  }

  /**
   * Kiểm tra phản hồi GPT có chứa yêu cầu query database không
   * @param {String} response - Phản hồi GPT
   * @returns {Boolean}
   */
  hasQueryRequest(response) {
    return response.includes('[QUERY]') && response.includes('[/QUERY]');
  }

  /**
   * Trích xuất query prompt từ tag [QUERY]...[/QUERY]
   * @param {String} response - Phản hồi GPT
   * @returns {String}
   */
  extractQueryPrompt(response) {
    const match = response.match(/\[QUERY\](.*?)\[\/QUERY\]/s);
    return match ? match[1].trim() : '';
  }

  /**
   * Định dạng kết quả query để GPT tạo phản hồi ngôn ngữ tự nhiên
   * @param {Object} queryResult - Kết quả từ Query Engine
   * @returns {String}
   */
  formatQueryResultsForGPT(queryResult) {
    if (!queryResult.success || !queryResult.data || queryResult.data.length === 0) {
      return 'Không tìm thấy kết quả nào trong database.';
    }

    let formatted = `Tìm thấy ${queryResult.count} kết quả từ collection "${queryResult.query.collection}":\n\n`;
    
    // Giới hạn 5 kết quả đầu tiên cho ngữ cảnh
    const limitedData = queryResult.data.slice(0, 5);
    
    limitedData.forEach((item, index) => {
      formatted += `${index + 1}. ${JSON.stringify(item, null, 2)}\n\n`;
    });

    if (queryResult.count > 5) {
      formatted += `... và ${queryResult.count - 5} kết quả khác.`;
    }

    return formatted;
  }

  /**
   * Gửi tin nhắn đến GPT (phiên bản đơn giản không tích hợp API)
   * @param {Array} messages - Mảng tin nhắn
   * @param {String} systemPrompt - System prompt
   * @returns {Promise<String>} - Chỉ trả về nội dung phản hồi GPT
   */
  async sendSimpleMessage(messages, systemPrompt = DENTAL_ASSISTANT_PROMPT) {
    try {
      const response = await openai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('❌ Lỗi OpenAI API:', error);
      throw new Error('Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.');
    }
  }

  /**
   * Định dạng lịch sử hội thoại cho OpenAI
   * @param {Array} messages - Các tin nhắn từ database
   * @returns {Array} - Tin nhắn đã định dạng cho OpenAI
   */
  formatMessagesForGPT(messages) {
    return messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role,
        content: msg.content
      }));
  }

  /**
   * Kiểm tra tin nhắn có liên quan đến nha khoa không
   * @param {String} message - Tin nhắn của user
   * @returns {Boolean}
   */
  isDentalRelated(message) {
    const dentalKeywords = [
      // Tiếng Việt - Từ khóa cơ bản
      'răng', 'nha khoa', 'khám', 'Nha sĩ', 'nha sĩ', 'dịch vụ', 
      'đặt lịch', 'đặt hẹn', 'giá', 'chi phí', 'phí', 'tiền',
      
      // Dịch vụ nha khoa
      'tẩy trắng', 'niềng', 'chỉnh nha', 'bọc răng', 'cấy ghép',
      'nhổ', 'trám', 'implant', 'sứ', 'veneer', 'lấy cao',
      
      // Triệu chứng & Bệnh lý răng miệng
      'nướu', 'viêm', 'đau', 'nhức', 'sâu', 'mất', 'hỏng', 
      'chảy máu', 'sưng', 'mủ', 'ố vàng', 'mảng bám', 'khớp cắn',
      'thưa', 'móm', 'hô', 'lệch', 'lung lay', 'yếu',
      
      // Phòng khám & Thương hiệu
      'phòng khám', 'smilecare', 'smile care', 'nha khoa smile',
      
      // Từ khóa tiếng Anh
      'appointment', 'teeth', 'tooth', 'dental', 'dentist', 
      'orthodontic', 'braces', 'whitening', 'cavity', 'gum'
    ];

    const lowerMessage = message.toLowerCase();
    return dentalKeywords.some(keyword => lowerMessage.includes(keyword));
  }
}

module.exports = new AIService();
